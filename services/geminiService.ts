
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { GeneratedCode, Message, Project, Phase, BuildAudit, AIProviderConfig, AIUsageResult, ProjectFile, User, AIDebugLog } from "../types";
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

// Internal map for logical keys to DB keys
export const PROMPT_KEYS = {
    'CLASSIFIER': 'sys_prompt_classifier_v12',
    'DECISION': 'sys_prompt_decision_v12', 
    'REQUIREMENTS': 'sys_prompt_requirements_v12',
    'DESIGN': 'sys_prompt_design_v12',
    'PHASE_PLANNER': 'sys_prompt_phase_planner_v12', 
    'PLANNER': 'sys_prompt_planner_v12', 
    'BUILDER': 'sys_prompt_builder_v12', 
    'REPAIR_PLANNER': 'sys_prompt_repair_planner_v12',
    'TITLE': 'sys_prompt_title_v12'
};

/**
 * STRICT DB FETCH: This method FORCES a query to Supabase.
 * If the prompt key is missing from the database, the system will throw a critical error.
 * No hardcoded fallbacks are allowed.
 */
const getSystemPrompt = async (key: string): Promise<string> => {
    // Map logical key to DB key if needed
    const dbKey = (PROMPT_KEYS as any)[key] || key;
    
    if (promptCache[dbKey]) return promptCache[dbKey];
    
    try {
        const { data, error } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', dbKey)
            .maybeSingle();
            
        if (error) throw error;
        
        if (data?.value) {
            promptCache[dbKey] = data.value;
            return data.value;
        }
    } catch (e) {
        console.error(`CRITICAL: Prompt Fetch Error for [${dbKey}]:`, e);
    }
    
    throw new Error(`CRITICAL CONFIG ERROR: System prompt [${dbKey}] is missing from the database. The builder cannot proceed without database instructions.`);
};

// Fix: Exporting DEFAULTS required for reference in AdminPanel components
export const DEFAULTS: Record<string, string> = {
    'CLASSIFIER': 'Categorize request: chat|build|repair|cloud_setup. Return JSON.',
    'DECISION': 'Summarize architecture approach. Return JSON.',
    'REQUIREMENTS': 'Check if DB is needed. Return JSON.',
    'DESIGN': 'Define pages, routes, and UI components. Return JSON: {"pages": [], "theme": {}}',
    'PHASE_PLANNER': 'Define milestones based on Design Spec. Return JSON.',
    'PLANNER': 'Map current phase to file paths. Return JSON.',
    'BUILDER': 'Write FULL React/Tailwind code. NO instructions. Return JSON.',
    'REPAIR_PLANNER': 'Analyze error and patches. Return JSON.',
    'TITLE': '2-3 word title. Return JSON.'
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
            systemInstruction: systemInstruction, 
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
                let data = img;
                if (img.startsWith('blob:')) return;
                if (img.startsWith('data:')) {
                    const split = img.split('base64,');
                    data = split[1];
                    mimeType = split[0].split(':')[1].split(';')[0];
                }
                parts.push({ inlineData: { mimeType, data } });
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
    
    const blocks = cleaned.match(/\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}|\[(?:[^[\]]|\[(?:[^[\]]|\[[^[\]]*\])*\])*\]/g);
    if (blocks) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            res = tryParse(blocks[i]);
            if (res) return res;
        }
    }
    throw new Error("AI returned invalid JSON format. Prompt tuning required.");
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

    private t(key: keyof typeof translations['en'], vars?: Record<string, string>) {
        const dict = translations[this.lang] || translations['en'];
        let str = (dict as any)[key] || key;
        if (vars) Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, v ?? ''); });
        return str;
    }

    private async runStep(key: string, prompt: string, logicalMessageKey: string): Promise<any> {
        this.checkAbort();
        let sys = await getSystemPrompt(key);
        
        const effectiveIsFarsi = this.lang === 'fa' || /[\u0600-\u06FF]/.test(this.userPrompt);
        if (effectiveIsFarsi) sys = "User-facing text in JSON MUST be in Farsi.\n" + sys;

        let lastError;
        for (let i = 0; i < 3; i++) {
            this.checkAbort();
            try {
                const { text: resText, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey});
                
                // Realtime AI Debug Logging
                if (this.callbacks.onAIDebugLog) {
                    this.callbacks.onAIDebugLog({
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        stepKey: key,
                        model: usage.model,
                        systemInstruction: sys,
                        prompt: prompt,
                        response: resText
                    }, logicalMessageKey);
                }

                const json = extractJson(resText);
                return json;
            } catch (e: any) {
                lastError = e;
                await this.callbacks.onError(e.message || "AI Busy", 2 - i);
                await new Promise(r => setTimeout(r, 1500));
            }
        }
        throw lastError;
    }

    public async repair(error: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Strategizing repair...", status: 'working', icon: 'wrench' })).id;
        try {
            const res = await this.runStep('REPAIR_PLANNER', JSON.stringify({ error, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 1000)})) }), msgId);
            if (res.patches) {
                for (const patch of res.patches) {
                    const idx = this.accumulatedFiles.findIndex(f => f.path === patch.path);
                    const content = sanitizeFileContent(patch.content, patch.path);
                    if (idx !== -1) this.accumulatedFiles[idx].content = content;
                    else this.accumulatedFiles.push({ path: patch.path, content, type: 'file' });
                }
                await this.callbacks.onChunkComplete({ html: '', javascript: '', css: '', explanation: res.explanation || "Fixed issues" }, "Applied fix", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, status: 'completed', icon: 'check' });
            await this.validateRuntime();
            await this.callbacks.onSuccess(this.project.code, "Self-healing complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            await this.callbacks.onFinalError("Repair failed: " + e.message);
        }
    }

    private async validateRuntime() {
        const buildStatusId = (await this.callbacks.onBuildMessage('validation', { type: 'build_status', content: "Verifying runtime stability...", status: 'working', icon: 'shield' })).id;
        const hasEntry = this.entryPath && this.accumulatedFiles.some(f => f.path === this.entryPath);
        const hasStandardEntry = this.accumulatedFiles.some(f => f.path.includes('App.tsx') || f.path.includes('main.tsx'));
        
        if (!hasEntry && !hasStandardEntry) {
            await this.callbacks.onBuildMessage('validation', { id: buildStatusId, status: 'failed' });
            return this.repair("Critical Error: No runtime entry point found. App cannot mount.");
        }

        if (this.callbacks.waitForPreview) {
            const check = await this.callbacks.waitForPreview(4000); 
            if (!check.success) {
                await this.callbacks.onBuildMessage('validation', { id: buildStatusId, status: 'failed' });
                return this.repair(`Runtime Error: ${check.error || "Preview rendered blank."}`);
            }
        }
        await this.callbacks.onBuildMessage('validation', { id: buildStatusId, content: "Runtime validated.", status: 'completed', icon: 'check-circle' });
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            
            // 1. CLASSIFIER (Priority 1 Router)
            const classMsgId = (await this.callbacks.onBuildMessage('classifier', { type: 'build_status', content: "Classifying intent...", status: 'working', icon: 'loader' })).id;
            const classification = await this.runStep('CLASSIFIER', `USER: ${this.userPrompt}\nFILES: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, classMsgId);

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
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, type: 'action_required', content: classification.direct_response || "Database setup requested.", requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'cloud' });
                await this.callbacks.onSuccess(this.project.code, "Cloud process pending.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            await this.callbacks.onBuildMessage('classifier', { id: classMsgId, content: "Intent classified as: " + classification.intent, status: 'completed', icon: 'check' });

            // 2. DESIGN & ARCHITECTURE
            await this.callbacks.onBuildMessage('design', { type: 'build_status', content: this.t('analyzingRequest'), status: 'working', icon: 'loader' });
            const designSpec = await this.runStep('DESIGN', `REQUEST: ${this.userPrompt}\nFILES: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, 'design');
            await this.callbacks.onBuildMessage('design', { content: "Architecture defined.", status: 'completed', icon: 'check' });

            const reqRes = await this.runStep('REQUIREMENTS', JSON.stringify({ request: this.userPrompt, design: designSpec }), 'reqs');
            if (reqRes.needs_backend && (!this.project.rafieiCloudProject || this.project.rafieiCloudProject.status !== 'ACTIVE')) {
                await this.callbacks.onBuildMessage('reqs', { type: 'action_required', content: this.t('backendActionRequired'), requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'warning' });
                return;
            }

            // 3. PHASE PLANNING
            const phasePlan = await this.runStep('PHASE_PLANNER', JSON.stringify({ request: this.userPrompt, design: designSpec }), 'plan');
            const phases: Phase[] = phasePlan.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);

            // 4. EXECUTION LOOP
            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                this.checkAbort();
                if (isResume && phase.status === 'completed') continue;

                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${i}`, { type: 'build_phase', content: this.t('startingPhase', {phaseTitle: phase.title}), status: 'working', icon: 'loader' })).id;
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                
                const stepsRes = await this.runStep('PLANNER', JSON.stringify({ phase, design: designSpec }), phaseMsgId);
                const steps = stepsRes.steps || [];

                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    this.checkAbort();
                    
                    if (step.depends_on && Array.isArray(step.depends_on)) {
                        for (const dep of step.depends_on) {
                            if (!this.accumulatedFiles.some(f => f.path === dep)) throw new Error(`Missing dependency: ${dep}`);
                        }
                    }

                    const stepMsgId = (await this.callbacks.onBuildMessage(`step_${i}_${j}`, { type: 'build_phase', content: this.t('buildingPhase', {phaseTitle: phase.title, filePath: step.path}), status: 'working', currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } })).id;
                    
                    const builderRes = await this.runStep('BUILDER', JSON.stringify({ task: step.description, path: step.path, design: designSpec, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 500)})) }), stepMsgId);
                    
                    if (builderRes.file_changes) {
                        for (const change of builderRes.file_changes) {
                            const existingIdx = this.accumulatedFiles.findIndex(f => f.path === change.path);
                            if (change.action === 'create' && existingIdx !== -1) continue;
                            
                            const content = sanitizeFileContent(change.content, change.path);
                            if (change.is_entry || step.is_entry) this.entryPath = change.path;

                            if (existingIdx !== -1) this.accumulatedFiles[existingIdx].content = content;
                            else this.accumulatedFiles.push({ path: change.path, content, type: 'file' });
                        }
                    }
                    await this.callbacks.onChunkComplete(this.project.code, `Updated ${step.path}`, { files: this.accumulatedFiles });
                    await this.callbacks.onBuildMessage(`step_${i}_${j}`, { id: stepMsgId, status: 'completed' });
                }
                phase.status = 'completed';
                await this.callbacks.onPhaseComplete(i);
            }

            await this.validateRuntime();
            await this.callbacks.onSuccess(this.project.code, "Build complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });

        } catch (e: any) {
            await this.callbacks.onFinalError(e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const sys = await getSystemPrompt('TITLE');
        const { text } = await robustGenerate(`Request: ${prompt}`, sys, project.id, user.id, 'TITLE');
        const json = extractJson(text);
        return json.title || "My AI App";
    } catch (e) { return "New Project"; }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
