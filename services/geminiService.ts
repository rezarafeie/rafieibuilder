
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { GeneratedCode, Message, Project, Phase, BuildAudit, AIProviderConfig, AIUsageResult, ProjectFile, User, AIDebugLog } from "../types";
import { billingService } from "./billingService";
import { aiProviderService } from "./aiProviderService";
import { openaiService } from "./openaiService";
import { claudeService } from "./claudeService";
import { sanitizeFileContent } from "../utils/codeGenerator"; 
import { translations, Language } from '../utils/translations';

// --- ENVIRONMENT ---
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

// --- SUPABASE ---
const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- SYSTEM PROMPT MANAGEMENT ---
const promptCache: Record<string, string> = {};

export const PROMPT_KEYS = {
    'CLASSIFIER': 'sys_prompt_classifier_v12',
    'DESIGN': 'sys_prompt_design_v12',
    'PHASE_PLANNER': 'sys_prompt_phase_planner_v12', 
    'PLANNER': 'sys_prompt_planner_v12', 
    'BUILDER': 'sys_prompt_builder_v12', 
    'REPAIR_PLANNER': 'sys_prompt_repair_planner_v12',
    'TITLE': 'sys_prompt_title_v12'
};

export const DEFAULTS: Record<string, string> = {
    'CLASSIFIER': `You are a strategic router. Analyze user intent.
Output ONLY raw JSON:
{
  "intent": "chat" | "build" | "repair",
  "direct_response": "Message for chat intent only"
}`,
    'DESIGN': `Architect the UI/UX and page structure.
Output ONLY raw JSON:
{
  "design_language": { "theme": "modern", "colors": ["#4f46e5"] },
  "pages": [ { "route": "/", "name": "Home", "sections": ["hero", "features"] } ]
}`,
    'PHASE_PLANNER': `Break the project into 2-4 high-level milestones.
Output ONLY raw JSON:
{
  "phases": [ { "title": "Milestone Name", "goal": "Description", "type": "ui" } ]
}`,
    'PLANNER': `Create a list of specific file implementation steps for the CURRENT phase.
Output ONLY raw JSON:
{
  "steps": [ { "title": "Step Name", "path": "src/App.tsx", "description": "Details", "is_entry": true } ]
}`,
    'BUILDER': `Write the full source code for a specific file. 
Output ONLY raw JSON:
{
  "file_changes": [ { "path": "string", "content": "Full React/Tailwind Code", "action": "create" } ]
}`,
    'REPAIR_PLANNER': `Analyze the error and provide a fix.
Output ONLY raw JSON:
{
  "patches": [ { "path": "string", "content": "Fixed code", "action": "update" } ],
  "explanation": "Summary"
}`,
    'TITLE': `Generate a creative 2-word app name.
Output ONLY raw JSON:
{ "title": "App Name" }`
};

const getSystemPrompt = async (key: string): Promise<string> => {
    const dbKey = (PROMPT_KEYS as any)[key] || key;
    if (promptCache[dbKey]) return promptCache[dbKey];
    try {
        const { data } = await supabase.from('system_settings').select('value').eq('key', dbKey).maybeSingle();
        if (data?.value) {
            promptCache[dbKey] = data.value;
            return data.value;
        }
    } catch (e) {
        console.warn(`Prompt DB fetch failed for ${key}, using default.`);
    }
    return (DEFAULTS as any)[key] || "You are a helpful coding assistant.";
};

// --- ROBUST JSON EXTRACTION ---
const extractJson = (text: string | undefined): any => {
    if (!text) throw new Error("AI returned empty response");

    // 1. Remove XML/Thinking tags if model is Gemini 3
    let cleaned = text.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();
    
    // 2. Remove basic markdown wrappers
    cleaned = cleaned.replace(/```json/gi, "").replace(/```/g, "").trim();

    const tryParse = (str: string) => {
        try { return JSON.parse(str); } catch (e) { return null; }
    };

    let res = tryParse(cleaned);
    if (res) return res;

    // 3. Regex extraction for first { to last }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        res = tryParse(cleaned.substring(firstBrace, lastBrace + 1));
        if (res) return res;
    }

    throw new Error("Invalid AI Response Format: Could not find parseable JSON.");
};

// --- ORCHESTRATOR UTILS ---
const getActiveProvider = async (): Promise<AIProviderConfig> => {
    try {
        const active = await aiProviderService.getActiveConfig();
        if (active && active.apiKey) return active;
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey) return fallback;
    } catch (e) {}
    return { id: 'google', name: 'Google Gemini', isActive: true, isFallback: false, apiKey: process.env.API_KEY || '', model: 'gemini-3-flash-preview', updatedAt: Date.now() };
};

const executeAIRequest = async (config: AIProviderConfig, prompt: string, systemInstruction: string, images: string[] = []): Promise<{ text: string, usage: AIUsageResult }> => {
    if (!config.apiKey) throw new Error(`API Key missing for ${config.name}`);

    if (config.id === 'google') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        const reqConfig: any = { 
            systemInstruction, 
            temperature: 0.1, 
            maxOutputTokens: 8192 
        };
        
        if (systemInstruction.toUpperCase().includes('JSON')) {
            reqConfig.responseMimeType = 'application/json';
        }
        
        let contents: any = prompt;
        if (images.length > 0) {
            // @fix: Explicitly type parts to allow mixing text and inlineData parts as per GenAI SDK requirements.
            const parts: any[] = images.map(img => {
                let data = img;
                let mimeType = 'image/jpeg';
                if (img.startsWith('data:')) {
                    const split = img.split('base64,');
                    data = split[1];
                    mimeType = split[0].split(':')[1].split(';')[0];
                }
                return { inlineData: { mimeType, data } };
            });
            parts.push({ text: prompt });
            contents = { parts };
        }

        const response = await ai.models.generateContent({ model: config.model || 'gemini-3-flash-preview', contents, config: reqConfig });
        const input = Number(response.usageMetadata?.promptTokenCount || 0);
        const output = Number(response.usageMetadata?.candidatesTokenCount || 0);
        const cost = billingService.calculateRawCost(config.model || 'gemini-3-flash-preview', input, output);

        return { text: response.text || "{}", usage: { promptTokens: input, completionTokens: output, costUsd: cost, provider: 'google', model: config.model || 'gemini-3-flash-preview' } };
    } 
    else if (config.id === 'openai') return await openaiService.generateContent(config.apiKey, config.model, prompt, systemInstruction, images);
    else if (config.id === 'claude') return await claudeService.generateContent(config.apiKey, config.model, prompt, systemInstruction, images);
    
    throw new Error(`Unknown provider: ${config.id}`);
};

const robustGenerate = async (prompt: string, systemInstruction: string, projectId: string, userId: string, opType: string, images: string[] = [], options?: { messageId?: string }): Promise<{text: string, usage: AIUsageResult}> => {
    let activeConfig = await getActiveProvider();
    try {
        const result = await executeAIRequest(activeConfig, prompt, systemInstruction, images);
        billingService.chargeUser(userId, projectId, opType, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { messageId: options?.messageId }).catch(console.error);
        return result;
    } catch (error: any) {
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey) {
            const result = await executeAIRequest(fallback, prompt, systemInstruction, images);
            billingService.chargeUser(userId, projectId, `${opType}_fallback`, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { messageId: options?.messageId, note: "Fallback" }).catch(console.error);
            return result;
        }
        throw error;
    }
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
    onAIDebugLog?: (log: AIDebugLog, messageId?: string) => void;
}

export class GenerationSupervisor {
    private project: Project;
    private userPrompt: string;
    private images: string[];
    private callbacks: SupervisorCallbacks;
    private signal?: AbortSignal;
    private lang: Language;
    private accumulatedFiles: ProjectFile[] = [];
    private entryPath: string | null = null;

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

    private async runStep(key: string, prompt: string, logicalMessageKey: string): Promise<any> {
        this.checkAbort();
        let sys = await getSystemPrompt(key);
        if (this.lang === 'fa' || /[\u0600-\u06FF]/.test(this.userPrompt)) {
            sys = "IMPORTANT: User-facing text in JSON MUST be in Farsi.\n" + sys;
        }

        let lastError;
        for (let i = 0; i < 3; i++) {
            this.checkAbort();
            try {
                const { text, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey});
                
                if (this.callbacks.onAIDebugLog) {
                    this.callbacks.onAIDebugLog({
                        id: crypto.randomUUID(), timestamp: Date.now(), stepKey: key, model: usage.model,
                        systemInstruction: sys, prompt, response: text
                    }, logicalMessageKey);
                }

                return extractJson(text);
            } catch (e: any) {
                lastError = e;
                await this.callbacks.onError(e.message, 2 - i);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        throw lastError;
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            
            // 1. CLASSIFIER
            const classMsgId = (await this.callbacks.onBuildMessage('classifier', { type: 'build_status', content: "Strategizing approach...", status: 'working', icon: 'loader' })).id;
            const classification = await this.runStep('CLASSIFIER', `User Prompt: ${this.userPrompt}`, classMsgId);

            if (classification.intent === 'chat') {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, type: 'assistant_response', content: classification.direct_response, status: 'completed' });
                await this.callbacks.onSuccess(this.project.code, "Chat complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            // 2. DESIGN & ARCHITECTURE
            await this.callbacks.onBuildMessage('design', { type: 'build_status', content: "Designing architecture...", status: 'working', icon: 'loader' });
            const designSpec = await this.runStep('DESIGN', `Request: ${this.userPrompt}\nFiles: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, 'design');

            // 3. PHASE PLANNING
            const phaseRes = await this.runStep('PHASE_PLANNER', JSON.stringify({ request: this.userPrompt, design: designSpec }), 'phases');
            const phases: Phase[] = phaseRes.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);

            // 4. EXECUTION
            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                if (isResume && phase.status === 'completed') continue;
                
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${i}`, { type: 'build_phase', content: `Building Milestone: ${phase.title}`, status: 'working' })).id;
                
                const stepsRes = await this.runStep('PLANNER', JSON.stringify({ phase, design: designSpec }), phaseMsgId);
                const steps = stepsRes.steps || [];

                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } });
                    
                    const builderRes = await this.runStep('BUILDER', JSON.stringify({ task: step.description, path: step.path, design: designSpec, files: this.accumulatedFiles.map(f=>({path:f.path, content: f.content.substring(0, 500)})) }), phaseMsgId);
                    
                    if (builderRes.file_changes) {
                        for (const change of builderRes.file_changes) {
                            const cleanPath = change.path.replace(/^\//, '');
                            const idx = this.accumulatedFiles.findIndex(f => f.path === cleanPath);
                            const content = sanitizeFileContent(change.content, cleanPath);
                            if (idx !== -1) this.accumulatedFiles[idx].content = content;
                            else this.accumulatedFiles.push({ path: cleanPath, content, type: 'file' });
                        }
                    }
                    await this.callbacks.onChunkComplete(this.project.code, `Updated ${step.path}`, { files: this.accumulatedFiles });
                }
                phase.status = 'completed';
                await this.callbacks.onPhaseComplete(i);
                await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, status: 'completed' });
            }

            await this.callbacks.onSuccess(this.project.code, "Build complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });

        } catch (e: any) {
            await this.callbacks.onFinalError(e.message || "An unexpected error occurred during build.");
        }
    }

    public async repair(error: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Analyzing runtime error...", status: 'working', icon: 'wrench' })).id;
        try {
            const res = await this.runStep('REPAIR_PLANNER', JSON.stringify({ error, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 1000)})) }), msgId);
            if (res.patches) {
                for (const patch of res.patches) {
                    const cleanPath = patch.path.replace(/^\//, '');
                    const idx = this.accumulatedFiles.findIndex(f => f.path === cleanPath);
                    if (idx !== -1) this.accumulatedFiles[idx].content = sanitizeFileContent(patch.content, cleanPath);
                    else this.accumulatedFiles.push({ path: cleanPath, content: sanitizeFileContent(patch.content, cleanPath), type: 'file' });
                }
                await this.callbacks.onChunkComplete(this.project.code, "Applied fix", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, status: 'completed' });
            await this.callbacks.onSuccess(this.project.code, "Healed.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            await this.callbacks.onFinalError("Repair failed: " + e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const sys = await getSystemPrompt('TITLE');
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
        const res = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: `Prompt: ${prompt}`,
            config: { systemInstruction: sys, responseMimeType: 'application/json' }
        });
        const json = extractJson(res.text);
        return json.title || "My AI App";
    } catch (e) { return "New Project"; }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
