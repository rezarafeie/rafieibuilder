
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
            systemInstruction, 
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

const remedyJson = (s: string): string => {
    return s
        .replace(/(?<=[:[,])\s*"(?:[^"\\]|\\.)*"/g, (match) => {
            return match.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
        })
        .replace(/,\s*([\]}])/g, '$1')
        .replace(/\\'/g, "'");
};

const extractJson = (text: string | undefined): any => {
    if (!text) throw new Error("Empty response from AI");
    
    let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    const tryParse = (str: string) => {
        try { return JSON.parse(str); } catch (e) {
            try { return JSON.parse(remedyJson(str)); } catch (e2) { return null; }
        }
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

    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    const start = (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) ? firstBrace : firstBracket;
    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    const end = (lastBrace !== -1 && (lastBracket === -1 || lastBrace > lastBracket)) ? lastBrace : lastBracket;

    if (start !== -1 && end !== -1 && end > start) {
        res = tryParse(cleaned.substring(start, end + 1));
        if (res) return res;
    }

    throw new Error("Failed to parse JSON response from AI. The raw output was: " + text.substring(0, 100));
};

export const PROMPT_KEYS = {
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
    DECISION: `You are a Senior Software Architect. Analyze the user request.
Possible Intents:
- "chat": Simple questions or conversation.
- "config": Database/Backend configuration request.
- "repair": Fixing specific bugs reported.
- "update": Incremental feature addition to existing files.
- "new_build": Starting a project from scratch.

Return ONLY raw JSON:
{
  "analysis": {
    "intent": "chat" | "config" | "repair" | "update" | "new_build",
    "complexity": "low" | "medium" | "high"
  },
  "narrative_summary": "Brief summary of what you will do",
  "response_message": "Friendly greeting to user"
}`,

    REQUIREMENTS: `You are a Technical Analyst. Determine if the project requires a Supabase backend (database, auth, storage).
Return ONLY raw JSON:
{
  "needs_backend": boolean,
  "reasoning": "Explanation of why backend is or is not needed"
}`,

    PHASE_PLANNER: `You are a Project Manager. Break the build into 2-5 high-level milestones.
Return ONLY raw JSON:
{
  "phases": [
    { "id": "uuid", "title": "Milestone Title", "goal": "What this phase achieves", "type": "ui" | "logic" | "backend" }
  ]
}`,

    DESIGN: `You are a Lead UI/UX Designer. Generate a Design Specification for the app.
Return ONLY raw JSON:
{
  "design_language": { "theme": "modern", "colors": ["#hex"], "font": "Inter" },
  "pages": [ { "route": "/", "name": "Home", "sections": ["Hero", "Features"] } ]
}`,

    PLANNER: `You are a Tech Lead. Create a list of specific file-level steps for the CURRENT PHASE.
Return ONLY raw JSON:
{
  "steps": [
    { "id": "step_1", "title": "Create Dashboard", "path": "src/components/Dashboard.tsx", "description": "Implement the main UI" }
  ]
}`,

    BUILDER: `You are an Expert React/Tailwind Developer.
Generate the FULL content for the requested file. 
- Use functional React components.
- Use Tailwind CSS for styling.
- Assume 'lucide-react' is available for icons.
- If existing content is provided, you MUST merge the new logic while preserving functional existing sections.

Return ONLY raw JSON:
{
  "file_changes": [
    { "path": "src/App.tsx", "content": "Full code string here...", "action": "update" }
  ]
}`,

    REPAIR_PLANNER: `You are a Senior Debugger. Analyze the error and provide patches.
Return ONLY raw JSON:
{
  "patches": [
    { "path": "src/App.tsx", "content": "Fixed code string...", "action": "update" }
  ],
  "explanation": "What was fixed"
}`,
    TITLE: `Generate a short (2-3 words) creative name for this app based on the user prompt.
Return ONLY raw JSON:
{ "title": "My App Name" }`
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

    private getFileSummary() {
        return this.accumulatedFiles.map(f => `File: ${f.path}, Length: ${f.content.length}`).join('\n');
    }

    private async runStep(key: string, prompt: string, sysPromptDefault: string, logicalMessageKey: string): Promise<any> {
        this.checkAbort();
        let sys = await getSystemPrompt(key, sysPromptDefault);
        const effectiveIsFarsi = this.lang === 'fa' || /[\u0600-\u06FF]/.test(this.userPrompt);
        if (effectiveIsFarsi) sys = "Response JSON keys must be in English, but user-facing string values MUST be in Farsi.\n" + sys;

        let lastError;
        for (let i = 0; i < 3; i++) {
            this.checkAbort();
            try {
                const { text: resText, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey});
                const json = extractJson(resText);
                return { json, usage, raw: resText };
            } catch (e: any) {
                lastError = e;
                await this.callbacks.onError(e.message || "Model Busy", 2 - i);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        throw lastError;
    }

    public async repair(initialError: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Self-healing in progress...", status: 'working', icon: 'wrench' })).id;
        try {
            const repairResult = await this.runStep(PROMPT_KEYS['REPAIR_PLANNER'], JSON.stringify({ error: initialError, files: this.accumulatedFiles.map(f => ({ path: f.path, content: f.content.substring(0, 1000) })) }), DEFAULTS.REPAIR_PLANNER, msgId);
            const { patches } = repairResult.json;
            if (patches && patches.length > 0) {
                for (const patch of patches) {
                    const idx = this.accumulatedFiles.findIndex(f => f.path === patch.path.replace(/^\//, ''));
                    const content = sanitizeFileContent(patch.content, patch.path);
                    if (idx !== -1) this.accumulatedFiles[idx].content = content;
                    else this.accumulatedFiles.push({ path: patch.path.replace(/^\//, ''), content, type: 'file' });
                }
                await this.callbacks.onChunkComplete(this.project.code, "Applied fix", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, status: 'completed', icon: 'check' });
            await this.callbacks.onSuccess(this.project.code, "Healed.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            await this.callbacks.onFinalError("Heal failed: " + e.message);
        }
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            
            // 1. DECISION
            const decisionMsgId = (await this.callbacks.onBuildMessage('decision', { type: 'build_status', content: this.t('analyzingRequest'), status: 'working', icon: 'loader' })).id;
            const fileSummary = this.getFileSummary();
            const decisionRes = await this.runStep(PROMPT_KEYS['DECISION'], `REQUEST: ${this.userPrompt}\nIS_RESUME: ${isResume}\nSUMMARY: ${fileSummary}`, DEFAULTS.DECISION, decisionMsgId);
            const decision = decisionRes.json;
            const intent = decision.analysis.intent;

            if (intent === 'chat') {
                await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, type: 'assistant_response', content: decision.response_message || decision.narrative_summary, status: 'completed', icon: 'message-square' });
                await this.callbacks.onSuccess(this.project.code, "Done.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            if (intent === 'repair') {
                await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, status: 'completed' });
                await this.repair(this.userPrompt);
                return;
            }

            await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, content: decision.narrative_summary, status: 'completed', icon: 'check' });

            // 2. REQUIREMENTS
            const reqMsgId = (await this.callbacks.onBuildMessage('reqs', { type: 'build_status', content: "Checking dependencies...", status: 'working', icon: 'loader' })).id;
            const reqRes = await this.runStep(PROMPT_KEYS['REQUIREMENTS'], JSON.stringify({ request: this.userPrompt, decision }), DEFAULTS.REQUIREMENTS, reqMsgId);
            if (reqRes.json.needs_backend && (!this.project.rafieiCloudProject || this.project.rafieiCloudProject.status !== 'ACTIVE')) {
                await this.callbacks.onBuildMessage('reqs', { id: reqMsgId, type: 'action_required', content: this.t('backendActionRequired'), requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'warning' });
                return;
            }
            await this.callbacks.onBuildMessage('reqs', { id: reqMsgId, status: 'completed' });

            // 3. PHASE PLANNING
            const planMsgId = (await this.callbacks.onBuildMessage('phases', { type: 'build_plan', content: "Architecting build flow...", status: 'working', icon: 'loader' })).id;
            const phasePlanRes = await this.runStep(PROMPT_KEYS['PHASE_PLANNER'], JSON.stringify({ request: this.userPrompt, decision, summary: fileSummary }), DEFAULTS.PHASE_PLANNER, planMsgId);
            const phases: Phase[] = phasePlanRes.json.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);
            await this.callbacks.onBuildMessage('phases', { id: planMsgId, planData: phases.map(p => ({ title: p.title, status: 'pending' })), status: 'completed', icon: 'check' });

            // 4. EXECUTION
            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                this.checkAbort();
                if (isResume && phase.status === 'completed') continue;

                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${i}`, { type: 'build_phase', content: `Executing: ${phase.title}`, status: 'working', icon: 'loader' })).id;
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                
                const plannerRes = await this.runStep(PROMPT_KEYS['PLANNER'], JSON.stringify({ phase, request: this.userPrompt, files: this.accumulatedFiles.map(f => f.path) }), DEFAULTS.PLANNER, phaseMsgId);
                const steps = plannerRes.json.steps || [];

                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    this.checkAbort();
                    await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } });
                    
                    const targetFile = this.accumulatedFiles.find(f => f.path === step.path.replace(/^\//, ''));
                    const builderRes = await this.runStep(PROMPT_KEYS['BUILDER'], JSON.stringify({ task: step.description, path: step.path, existing: targetFile?.content || "", context: fileSummary }), DEFAULTS.BUILDER, phaseMsgId);
                    
                    if (builderRes.json.file_changes) {
                        for (const change of builderRes.json.file_changes) {
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

            await this.callbacks.onSuccess(this.project.code, "Built successfully.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });

        } catch (e: any) {
            await this.callbacks.onFinalError(e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const sys = DEFAULTS.TITLE;
        const ai = new GoogleGenAI({ apiKey: DEFAULT_GEMINI_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-lite-preview',
            contents: `Prompt: ${prompt}`,
            config: { systemInstruction: sys, responseMimeType: 'application/json' }
        });
        const json = extractJson(response.text);
        return json.title || "My App";
    } catch (e) {
        return "New App";
    }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
