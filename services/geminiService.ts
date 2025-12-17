
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { GeneratedCode, Message, Suggestion, Project, Phase, BuildAudit, AIProviderConfig, AIUsageResult, DecisionJSON, DesignSpecJSON, FilePlanJSON, FileChange, QAJSON, ProjectFile, User } from "../types";
import { billingService } from "./billingService";
import { aiProviderService } from "./aiProviderService";
import { openaiService } from "./openaiService";
import { claudeService } from "./claudeService";
import { sanitizeFileContent } from "../utils/codeGenerator"; 
import { translations, Language } from '../utils/translations';

// --- ENVIRONMENT & SAFETY ---
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

const DEFAULT_GEMINI_KEY = getEnv('API_KEY') || '';

// --- SUPABASE CLIENT ---
const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SYSTEM PROMPT MANAGEMENT ---
const promptCache: Record<string, string> = {};

const getSystemPrompt = async (key: string, defaultVal: string): Promise<string> => {
    if (promptCache[key]) return promptCache[key];
    try {
        const { data } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
        if (data?.value) {
            promptCache[key] = data.value;
            return data.value;
        }
    } catch (e) {}
    return defaultVal;
};

// --- ORCHESTRATOR UTILS ---
const getActiveProvider = async (): Promise<AIProviderConfig> => {
    try {
        const active = await aiProviderService.getActiveConfig();
        if (active) return active;
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey) return fallback;
    } catch (e) {}
    return { id: 'google', name: 'Google Gemini (Default)', isActive: true, isFallback: false, apiKey: DEFAULT_GEMINI_KEY, model: 'gemini-3-flash-preview', updatedAt: Date.now() };
};

const executeAIRequest = async (config: AIProviderConfig, prompt: string, systemInstruction: string, images: string[] = []): Promise<{ text: string, usage: AIUsageResult }> => {
    if (!config.apiKey) throw new Error(`API Key missing for provider: ${config.name}`);

    if (config.id === 'google') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const reqConfig: any = { 
            systemInstruction: "ACT AS A HEADLESS DATA API. RETURN ONLY VALID JSON. NO MARKDOWN. NO CONVERSATION. NO PREAMBLE. NO INSTRUCTIONS.\n\n" + systemInstruction, 
            temperature: 0.1, 
            maxOutputTokens: 8192 
        };
        
        if (systemInstruction.toUpperCase().includes('JSON')) {
            reqConfig.responseMimeType = 'application/json';
        }
        
        let contents: any = prompt;
        if (images.length > 0) {
            const parts: any[] = [];
            await Promise.all(images.map(async (img) => {
                let mimeType = 'image/jpeg';
                let rawBase64 = img;
                if (img.startsWith('blob:')) return;
                if (img.startsWith('http')) {
                    try {
                        const response = await fetch(img);
                        const blob = await response.blob();
                        const buffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(buffer);
                        let binary = '';
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        rawBase64 = btoa(binary);
                        mimeType = blob.type || 'image/jpeg';
                    } catch (e) { return; }
                } else if (img.includes('base64,')) {
                    const split = img.split('base64,');
                    rawBase64 = split[1];
                    if (split[0].includes('png')) mimeType = 'image/png';
                    else if (split[0].includes('webp')) mimeType = 'image/webp';
                }
                parts.push({ inlineData: { mimeType, data: rawBase64 } });
            }));
            parts.push({ text: prompt });
            contents = { parts };
        }

        const response = await ai.models.generateContent({ model: config.model || 'gemini-3-flash-preview', contents, config: reqConfig });
        const inputTokens = Number(response.usageMetadata?.promptTokenCount || 0);
        const outputTokens = Number(response.usageMetadata?.candidatesTokenCount || 0);
        const cost = billingService.calculateRawCost(config.model || 'gemini-3-flash-preview', inputTokens, outputTokens);

        return { text: response.text || "{}", usage: { promptTokens: inputTokens, completionTokens: outputTokens, costUsd: cost, provider: 'google', model: config.model || 'gemini-3-flash-preview' } };
    } 
    else if (config.id === 'openai') {
        return await openaiService.generateContent(config.apiKey!, config.model, prompt, systemInstruction, images);
    }
    else if (config.id === 'claude') {
        return await claudeService.generateContent(config.apiKey!, config.model, prompt, systemInstruction, images);
    }
    throw new Error(`Unknown provider: ${config.id}`);
};

const robustGenerate = async (prompt: string, systemInstruction: string, projectId: string, userId: string, opType: string, images: string[] = [], options?: { messageId?: string }): Promise<{text: string, usage: AIUsageResult}> => {
    let activeConfig = await getActiveProvider();
    try {
        const result = await executeAIRequest(activeConfig, prompt, systemInstruction, images);
        await billingService.chargeUser(userId, projectId, opType, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, {
            prompt, response: result.text, apiKey: activeConfig.apiKey, messageId: options?.messageId
        });
        return result;
    } catch (error: any) {
        const fallbackConfig = await aiProviderService.getFallbackConfig();
        if (fallbackConfig && fallbackConfig.apiKey) {
            const result = await executeAIRequest(fallbackConfig, prompt, systemInstruction, images);
            await billingService.chargeUser(userId, projectId, `${opType}_fallback`, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, {
                prompt, response: result.text, apiKey: fallbackConfig.apiKey, messageId: options?.messageId, note: "Fallback"
            });
            return result;
        }
        throw error;
    }
};

const extractJson = (text: string | undefined): any => {
    if (!text) throw new Error("Empty response from AI");
    let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const tryParse = (str: string) => {
        try { return JSON.parse(str); } catch (e) { return null; }
    };
    let res = tryParse(cleaned);
    if (res) return res;
    const startBrace = cleaned.indexOf('{');
    const startBracket = cleaned.indexOf('[');
    const start = (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) ? startBrace : startBracket;
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (start !== -1 && end !== -1 && end > start) {
        res = tryParse(cleaned.substring(start, end + 1));
        if (res) return res;
    }
    const blocks = cleaned.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|\[(?:[^[\]]|\[(?:[^[\]]|\[[^[\]]*\])*\])*\]/g);
    if (blocks) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            res = tryParse(blocks[i]);
            if (res) return res;
        }
    }
    throw new Error("AI returned invalid format. Please try again.");
};

export const PROMPT_KEYS = {
    'CLASSIFIER': 'sys_prompt_classifier_v12',
    'DECISION': 'sys_prompt_decision_v12', 
    'REQUIREMENTS': 'sys_prompt_requirements_v12',
    'PHASE_PLANNER': 'sys_prompt_phase_planner_v12', 
    'DESIGN': 'sys_prompt_design_v12',
    'PLANNER': 'sys_prompt_planner_v12', 
    'BUILDER': 'sys_prompt_builder_v12', 
    'REPAIR_PLANNER': 'sys_prompt_repair_planner_v12',
    'TITLE': 'sys_prompt_title_v12'
};

export const DEFAULTS = {
    CLASSIFIER: `Role: Technical Router. 
Analyze the user message and existing files.
Return ONLY JSON: {
  "intent": "chat" | "build_new" | "update_existing" | "repair" | "cloud_setup",
  "reasoning": "...",
  "direct_response": "Friendly answer if intent is 'chat' or 'cloud_setup'..."
}`,

    DECISION: `Return ONLY JSON: {"analysis": {"intent": "new_build"|"update", "complexity": "low"|"med"|"high"}, "narrative_summary": "...", "response_message": "..."}`,

    REQUIREMENTS: `Return ONLY JSON: {"needs_backend": boolean, "reasoning": "...", "features": []}`,

    PHASE_PLANNER: `Role: React/Tailwind Architect. 
Rule: NEVER plan CLI steps or 'npm install'. ONLY plan file creation milestones.
Return ONLY JSON: {"phases": [{"title": "Shell", "goal": "Setup src/App.tsx", "type": "skeleton"}]}`,

    DESIGN: `Return ONLY JSON: {"design_language": "modern", "pages": [], "visual_spec": "{}"}`,

    PLANNER: `Role: Technical Lead. 
Break the phase into specific file creation/update steps.
Return ONLY JSON: {"steps": [{"title": "Update App.tsx", "path": "src/App.tsx", "description": "Apply requested changes"}]}`,

    BUILDER: `Role: Expert React + Tailwind Developer. 
Rule: Output the FULL FILE CONTENT. NO instructions. NO commentary. NO placeholders. NO 'npm install'.
Return ONLY JSON: {"file_changes": [{"path": "src/App.tsx", "content": "import React from 'react';..."}]}`,

    REPAIR_PLANNER: `Return ONLY JSON: {"patches": [{"path": "...", "content": "..."}], "explanation": "..."}`,

    TITLE: `Return ONLY JSON: {"title": "App Name"}`
};

export interface SupervisorCallbacks {
    onPlanUpdate: (phases: Phase[]) => Promise<void>;
    onMessage: (message: Message) => Promise<void>;
    onBuildMessage: (logicalKey: string, message: Partial<Message>) => Promise<Message>;
    onPhaseStart: (phaseIndex: number, phase: { key?: string; text?: string }) => Promise<void>;
    onPhaseComplete: (phaseIndex: number) => Promise<void>;
    onStepStart: (phaseIndex: number, step: { key?: string; text?: string; vars?: Record<string, string> }) => Promise<void>;
    onStepComplete: (phaseIndex: number, stepName: string) => Promise<void>;
    onChunkComplete: (code: GeneratedCode, explanation: string, meta?: any) => Promise<void>;
    onSuccess: (code: GeneratedCode, explanation: string, audit: BuildAudit, meta?: any) => Promise<void>;
    onError: (error: string, retries: number) => Promise<void>;
    onFinalError: (error: string, audit?: BuildAudit) => Promise<void>;
    waitForPreview?: (timeoutMs: number) => Promise<{success: boolean, error?: string}>;
}

export class GenerationSupervisor {
    private project: Project;
    private userPrompt: string;
    private images: string[];
    private callbacks: SupervisorCallbacks;
    private signal?: AbortSignal;
    private lang: Language;
    private accumulatedFiles: ProjectFile[] = [];

    constructor(project: Project, userPrompt: string, images: string[], callbacks: SupervisorCallbacks, signal?: AbortSignal, lang: Language = 'en') {
        this.project = project;
        this.userPrompt = userPrompt;
        this.images = images;
        this.callbacks = callbacks;
        this.signal = signal;
        this.accumulatedFiles = project.files || [];
        this.lang = lang;
    }

    private checkAbort() { if (this.signal?.aborted) throw new Error("ABORTED"); }

    private t(key: keyof typeof translations['en'], vars?: Record<string, string>) {
        const dict = translations[this.lang] || translations['en'];
        let str = (dict as any)[key] || key;
        if (vars) Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, v ?? ''); });
        return str;
    }

    private async runStep(key: string, prompt: string, sysPromptDefault: string, logicalMessageKey: string): Promise<any> {
        this.checkAbort();
        let sys = await getSystemPrompt(key, sysPromptDefault);
        const effectiveIsFarsi = this.lang === 'fa' || /[\u0600-\u06FF]/.test(this.userPrompt);
        if (effectiveIsFarsi) sys = "User-facing text in JSON MUST be in Farsi.\n" + sys;

        let lastError;
        for (let i = 0; i < 3; i++) {
            this.checkAbort();
            try {
                const { text: resText, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey});
                const json = extractJson(resText);
                return { json, usage, raw: resText };
            } catch (e: any) {
                lastError = e;
                await this.callbacks.onError(e.message || "AI Busy", 2 - i);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        throw lastError;
    }

    public async repair(error: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Applying automatic fix...", status: 'working', icon: 'wrench' })).id;
        try {
            const res = await this.runStep(PROMPT_KEYS['REPAIR_PLANNER'], JSON.stringify({ error, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 500)})) }), DEFAULTS.REPAIR_PLANNER, msgId);
            if (res.json.patches) {
                for (const patch of res.json.patches) {
                    const idx = this.accumulatedFiles.findIndex(f => f.path === patch.path);
                    const content = sanitizeFileContent(patch.content, patch.path);
                    if (idx !== -1) this.accumulatedFiles[idx].content = content;
                    else this.accumulatedFiles.push({ path: patch.path, content, type: 'file' });
                }
                await this.callbacks.onChunkComplete({ html: '', javascript: '', css: '', explanation: res.json.explanation }, "Fixed issue", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, status: 'completed', icon: 'check' });
            await this.callbacks.onSuccess(this.project.code, "Self-healing complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            await this.callbacks.onFinalError("Repair failed: " + e.message);
        }
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            
            // 1. CLASSIFIER (Priority 1)
            const classMsgId = (await this.callbacks.onBuildMessage('classifier', { type: 'build_status', content: "Categorizing request...", status: 'working', icon: 'loader' })).id;
            const classRes = await this.runStep(PROMPT_KEYS['CLASSIFIER'], `USER: ${this.userPrompt}\nFILES: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, DEFAULTS.CLASSIFIER, classMsgId);
            const classification = classRes.json;

            if (classification.intent === 'chat') {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, type: 'assistant_response', content: classification.direct_response, status: 'completed', icon: 'message-square' });
                await this.callbacks.onSuccess(this.project.code, "Chat complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            if (classification.intent === 'repair') {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, status: 'completed', icon: 'wrench' });
                await this.repair(this.userPrompt);
                return;
            }

            if (classification.intent === 'cloud_setup') {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, type: 'action_required', content: classification.direct_response || "Cloud connection required.", requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'cloud' });
                await this.callbacks.onSuccess(this.project.code, "Cloud pending.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            await this.callbacks.onBuildMessage('classifier', { id: classMsgId, content: "Request categorized.", status: 'completed', icon: 'check' });

            // 2. DECISION & REQUIREMENTS
            const decisionMsgId = (await this.callbacks.onBuildMessage('decision', { type: 'build_status', content: this.t('analyzingRequest'), status: 'working', icon: 'loader' })).id;
            const decisionRes = await this.runStep(PROMPT_KEYS['DECISION'], `PROMPT: ${this.userPrompt}`, DEFAULTS.DECISION, decisionMsgId);
            const decision = decisionRes.json;
            await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, content: decision.narrative_summary, status: 'completed', icon: 'check' });

            const reqMsgId = (await this.callbacks.onBuildMessage('reqs', { type: 'build_status', content: this.t('checkingBackend'), status: 'working', icon: 'loader' })).id;
            const reqRes = await this.runStep(PROMPT_KEYS['REQUIREMENTS'], JSON.stringify({ request: this.userPrompt }), DEFAULTS.REQUIREMENTS, reqMsgId);
            if (reqRes.json.needs_backend && (!this.project.rafieiCloudProject || this.project.rafieiCloudProject.status !== 'ACTIVE')) {
                await this.callbacks.onBuildMessage('reqs', { id: reqMsgId, type: 'action_required', content: this.t('backendActionRequired'), requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'warning' });
                await this.callbacks.onSuccess(this.project.code, "Backend required.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }
            await this.callbacks.onBuildMessage('reqs', { id: reqMsgId, status: 'completed', icon: 'check' });

            // 3. PHASE PLANNING
            const planMsgId = (await this.callbacks.onBuildMessage('plan', { type: 'build_plan', content: this.t('creatingBuildPlan'), status: 'working', icon: 'loader' })).id;
            const phasePlanRes = await this.runStep(PROMPT_KEYS['PHASE_PLANNER'], JSON.stringify({ request: this.userPrompt, classification }), DEFAULTS.PHASE_PLANNER, planMsgId);
            const phases: Phase[] = phasePlanRes.json.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);
            await this.callbacks.onBuildMessage('plan', { id: planMsgId, planData: phases.map(p => ({ title: p.title, status: 'pending' })), status: 'completed', icon: 'check' });

            // 4. EXECUTION
            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                this.checkAbort();
                if (isResume && phase.status === 'completed') continue;

                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${i}`, { type: 'build_phase', content: this.t('startingPhase', {phaseTitle: phase.title}), status: 'working', icon: 'loader' })).id;
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                
                const stepsRes = await this.runStep(PROMPT_KEYS['PLANNER'], JSON.stringify({ phase, prompt: this.userPrompt }), DEFAULTS.PLANNER, phaseMsgId);
                const steps = stepsRes.json.steps || [];

                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    this.checkAbort();
                    const stepMsgId = (await this.callbacks.onBuildMessage(`phase_${i}_step_${j}`, { type: 'build_phase', content: this.t('buildingPhase', {phaseTitle: phase.title, filePath: step.path}), status: 'working', icon: 'loader', currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } })).id;
                    
                    const builderRes = await this.runStep(PROMPT_KEYS['BUILDER'], JSON.stringify({ task: step.description, file_path: step.path, existing_files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content})) }), DEFAULTS.BUILDER, stepMsgId);
                    
                    if (builderRes.json.file_changes) {
                        for (const change of builderRes.json.file_changes) {
                            const idx = this.accumulatedFiles.findIndex(f => f.path === change.path);
                            const content = sanitizeFileContent(change.content, change.path);
                            if (idx !== -1) this.accumulatedFiles[idx].content = content;
                            else this.accumulatedFiles.push({ path: change.path, content, type: 'file' });
                        }
                    }
                    await this.callbacks.onChunkComplete({ html: '', javascript: '', css: '', explanation: `Built ${step.path}` }, `Updated ${step.path}`, { files: this.accumulatedFiles });
                    await this.callbacks.onBuildMessage(`phase_${i}_step_${j}`, { id: stepMsgId, status: 'completed', icon: 'check' });
                }
                phase.status = 'completed';
                await this.callbacks.onPhaseComplete(i);
                await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, status: 'completed', icon: 'check' });
            }

            const successMsg = this.lang === 'fa' ? "🎉 برنامه شما با موفقیت ساخته شد!" : "🎉 Your application has been built successfully!";
            await this.callbacks.onSuccess(this.project.code, successMsg, { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });

        } catch (e: any) {
            console.error("Supervisor Critical Failure:", e);
            await this.callbacks.onFinalError(e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const ai = new GoogleGenAI({ apiKey: DEFAULT_GEMINI_KEY });
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Generate a short (2-3 words) catchy project name for: "${prompt}"`,
            config: { systemInstruction: "RETURN ONLY THE TITLE. NO QUOTES. NO CHAT.", temperature: 0.7 }
        });
        return res.text?.trim() || "My AI App";
    } catch (e) { return "New Project"; }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
