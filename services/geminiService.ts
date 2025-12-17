
import { GoogleGenAI } from "@google/genai";
import { createClient } from '@supabase/supabase-js';
import { GeneratedCode, Message, Suggestion, Project, Phase, BuildAudit, AIProviderConfig, AIUsageResult, DecisionJSON, DesignSpecJSON, FilePlanJSON, FileChange, QAJSON, ProjectFile, User } from "../types";
import { billingService } from "./billingService";
import { aiProviderService } from "./aiProviderService";
import { openaiService } from "./openaiService";
import { claudeService } from "./claudeService";
import { sanitizeFileContent } from "../utils/codeGenerator"; // Import Sanitizer
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

// --- SUPABASE CLIENT (Local instance to avoid circular dependency) ---
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
            temperature: 0.2,
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
    let currentCandidate = text.trim();
    const MAX_PARSE_ATTEMPTS = 5; 
    let parsedData: any = null;

    for (let attempts = 0; attempts < MAX_PARSE_ATTEMPTS; attempts++) {
        try {
            parsedData = JSON.parse(currentCandidate);
            if (typeof parsedData === 'object' && parsedData !== null) break; 
            if (typeof parsedData === 'string') {
                currentCandidate = parsedData.trim(); 
                const markdownMatch = currentCandidate.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/i);
                if (markdownMatch) currentCandidate = markdownMatch[1].trim();
                continue; 
            }
            break;
        } catch (e) {
            const firstBrace = currentCandidate.indexOf('{');
            const lastBrace = currentCandidate.lastIndexOf('}');
            const firstBracket = currentCandidate.indexOf('[');
            const lastBracket = currentCandidate.lastIndexOf(']');
            let foundJsonFragment = '';
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) foundJsonFragment = currentCandidate.substring(firstBrace, lastBrace + 1);
            else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) foundJsonFragment = currentCandidate.substring(firstBracket, lastBracket + 1);
            if (foundJsonFragment) {
                currentCandidate = foundJsonFragment;
                parsedData = null;
                continue; 
            }
            parsedData = null; 
            break;
        }
    }

    if (typeof parsedData !== 'object' || parsedData === null) throw new Error("Failed to parse JSON response.");

    const processObject = (obj: any): any => {
        if (typeof obj !== 'object' || obj === null) return obj;
        if (Array.isArray(obj)) return obj.map(item => processObject(item));
        const newObj: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (['content', 'sql', 'description', 'message', 'outputs'].includes(key) && typeof obj[key] === 'string') {
                    newObj[key] = sanitizeFileContent(obj[key], ""); 
                } else {
                    newObj[key] = processObject(obj[key]);
                }
            }
        }
        return newObj;
    };
    return processObject(parsedData);
};

export const PROMPT_KEYS = {
    'DECISION': 'sys_prompt_decision_v5', // Iteration for intent classification
    'REQUIREMENTS': 'sys_prompt_requirements_v3',
    'PHASE_PLANNER': 'sys_prompt_phase_planner_v4', 
    'DESIGN': 'sys_prompt_design_v3',
    'PLANNER': 'sys_prompt_planner_v3', 
    'BUILDER': 'sys_prompt_builder_v3', 
    'REPAIR': 'sys_prompt_repair_v3',
    'REPAIR_PLANNER': 'sys_prompt_repair_planner_v3',
    'QA': 'sys_prompt_qa_v3',
    'SQL': 'sys_prompt_sql_v3',
    'NARRATOR': 'sys_prompt_narrator_v3',
    'FILE_PLAN': 'sys_prompt_file_plan_v3',
    'CODE': 'sys_prompt_code_v3',
};

export const DEFAULTS = {
    DECISION: `Role: Strategic Intent Router
Purpose: Classify user requests to trigger the correct workflow.
Inputs: User Message, Existing File Structure.

Intents:
1. "chat": The user is asking a question, seeking advice, or just talking. (No code changes needed).
2. "config": User wants to connect a database, setup auth, or configure Rafiei Cloud settings.
3. "repair": User reports an error, a bug, a blank screen, or "it's not working".
4. "update": User wants to change, add, or delete something specific in an ALREADY EXISTING project.
5. "new_build": User wants to start a completely new app or a project from scratch.

Return STRICT JSON:
{
  "analysis": {
    "intent": "chat" | "config" | "repair" | "update" | "new_build",
    "reasoning": "...",
    "complexity": "low" | "medium" | "high"
  },
  "narrative_summary": "Friendly summary of what I'm about to do...",
  "response_message": "Direct chat response if intent is 'chat' or 'config'..."
}`,

    REQUIREMENTS: `Role: Technical Needs Analyzer. Analyze if the project needs backend (Auth, Database, Storage) based on user prompt.`,

    PHASE_PLANNER: `Role: Build Workflow Architect. 
Goal: Break the request into sequential phases.
IMPORTANT: If the intent is 'update', the phases should only target the relevant components and logic, NOT recreate the whole app.
If intent is 'new_build', start with a Bootstrap phase.

Return STRICT JSON:
{
  "phases": [
    { "id": "p1", "title": "...", "goal": "...", "type": "skeleton|ui|logic|backend" }
  ]
}`,

    DESIGN: `Role: UI/UX Designer. Generate a detailed design spec including routes, components, and layout based on the user's vision.`,
    PLANNER: `Role: Step-by-step Technical Planner. List the files to create or update for the current phase.`,
    BUILDER: `Role: React/Tailwind Code Generator. Write executable, high-quality code for the specified file.`,
    REPAIR_PLANNER: `Role: Senior Debugger. Provide minimal code patches to fix reported errors.`,
    QA: `Role: Quality Assurance. Check for runtime errors and visual completeness.`,
    SQL: `Role: Database Architect. Generate idempotent SQL for Supabase/PostgreSQL.`,
    NARRATOR: `Role: User Companion. Explain technical steps in a friendly way.`,
    FILE_PLAN: `Legacy`,
    CODE: `Legacy`
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
        if (effectiveIsFarsi) sys = "All user-facing text in the JSON MUST be in Farsi.\n" + sys;

        let lastError;
        for (let i = 0; i < 3; i++) {
            this.checkAbort();
            try {
                const { text: resText, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey});
                return { json: extractJson(resText), usage, executionTime: 0 };
            } catch (e: any) {
                lastError = e;
                await this.callbacks.onError(e.message || "Unknown error", 2 - i);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        throw lastError;
    }

    public async repair(initialError: string) {
        const messageId = (await this.callbacks.onBuildMessage('repair_mode', { type: 'build_status', content: this.t('selfHealing'), status: 'working', icon: 'wrench' })).id;
        for (let attempt = 1; attempt <= 5; attempt++) {
            this.checkAbort();
            const repairResult = await this.runStep(PROMPT_KEYS['REPAIR_PLANNER'], JSON.stringify({ error: initialError, files: this.accumulatedFiles }), DEFAULTS.REPAIR_PLANNER, messageId);
            const { patches, explanation } = repairResult.json;
            if (patches && patches.length > 0) {
                // Fix: Explicitly type patchMap and cast its values to any to prevent "unknown" property access errors
                const patchMap = new Map<string, any>(patches.map((p: any) => [p.path.replace(/^\.?\//, ''), p]));
                this.accumulatedFiles = this.accumulatedFiles.map(f => {
                    const patch = patchMap.get(f.path);
                    return patch ? { ...f, content: sanitizeFileContent((patch as any).content, f.path) } : f;
                });
                await this.callbacks.onChunkComplete({ html: '', javascript: '', css: '', explanation }, `Fixed: ${explanation}`, { files: this.accumulatedFiles });
                if (this.callbacks.waitForPreview) {
                    const validation = await this.callbacks.waitForPreview(8000);
                    if (validation.success) {
                         await this.callbacks.onBuildMessage('repair_mode', { id: messageId, content: "Self-repair complete. Preview is healthy.", status: 'completed', icon: 'check' });
                         return;
                    }
                }
            } else break;
        }
        // Finalize status to ensure buttons reset
        await this.callbacks.onSuccess({ html: '', javascript: '', css: '', explanation: 'Repairs finished.' }, "Repairs applied.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            
            // 1. DECISION (The Intelligent Router)
            const decisionMsgId = (await this.callbacks.onBuildMessage('decision', { type: 'build_status', content: this.t('analyzingRequest'), status: 'working', icon: 'loader' })).id;
            const existingPaths = this.accumulatedFiles.map(f => f.path).join(', ');
            const decisionResult = await this.runStep(PROMPT_KEYS['DECISION'], `USER REQUEST: ${this.userPrompt}\nEXISTING_FILES: ${existingPaths || 'NONE'}\nIS_RESUME: ${isResume}`, DEFAULTS.DECISION, decisionMsgId);
            const decision = decisionResult.json;
            const intent = decision.analysis.intent;

            // BRANCH: Chat only (No Code)
            if (intent === 'chat') {
                await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, type: 'assistant_response', content: decision.response_message || decision.narrative_summary, status: 'completed', icon: 'message-square' });
                // CRITICAL: Flip status to idle to restore the "Send" button
                await this.callbacks.onSuccess(this.project.code, "Chat complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            // BRANCH: Config/Database Cloud
            if (intent === 'config') {
                await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, type: 'action_required', content: decision.response_message || "I'll help you configure your database connection.", requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'settings' });
                // Even if action is required, we flip status to idle so the user can interact
                await this.callbacks.onSuccess(this.project.code, "Config requested.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            // BRANCH: Reported Error (Repair)
            if (intent === 'repair') {
                await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, content: "Detecting issue and starting automated repair...", status: 'completed', icon: 'wrench' });
                await this.repair("User reported: " + this.userPrompt);
                return;
            }

            // BRANCH: Build / Update (The Main Execution Loop)
            await this.callbacks.onBuildMessage('decision', { id: decisionMsgId, content: decision.narrative_summary, status: 'completed', icon: 'check' });

            // 2. REQUIREMENTS & BACKEND GATING
            const reqMsgId = (await this.callbacks.onBuildMessage('requirements', { type: 'build_status', content: this.t('checkingBackend'), status: 'working', icon: 'loader' })).id;
            const requirementsResult = await this.runStep(PROMPT_KEYS['REQUIREMENTS'], JSON.stringify({ request: this.userPrompt, intent, analysis: decision }), DEFAULTS.REQUIREMENTS, reqMsgId);
            const requirements = requirementsResult.json;

            const shouldBlockForBackend = (requirements.needs_backend || requirements.backendRequired) && !this.userPrompt.toLowerCase().includes('skip backend');
            if (shouldBlockForBackend && (!this.project.rafieiCloudProject || this.project.rafieiCloudProject.status !== 'ACTIVE')) {
                await this.callbacks.onBuildMessage('requirements', { id: reqMsgId, type: 'action_required', content: this.t('backendActionRequired'), requiresAction: 'CONNECT_DATABASE', status: 'pending', icon: 'warning' });
                // Flip to idle so user can click the button
                await this.callbacks.onSuccess(this.project.code, "Backend required.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            // 3. PHASE PLANNING (Skip if resuming with existing plan)
            let phases: Phase[] = [];
            if (isResume && this.project.buildState?.phases && this.project.buildState.phases.length > 0) {
                phases = this.project.buildState.phases;
                console.log(`Resuming existing build with ${phases.length} phases.`);
            } else {
                const planMsgId = (await this.callbacks.onBuildMessage('phase_planner', { type: 'build_plan', content: this.t('creatingBuildPlan'), status: 'working', icon: 'loader' })).id;
                const phasePlanResult = await this.runStep(PROMPT_KEYS['PHASE_PLANNER'], JSON.stringify({ request: this.userPrompt, intent, analysis: decision, requirements, existing_files: existingPaths }), DEFAULTS.PHASE_PLANNER, planMsgId);
                phases = phasePlanResult.json.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
                await this.callbacks.onPlanUpdate(phases);
                await this.callbacks.onBuildMessage('phase_planner', { id: planMsgId, content: this.t('planReady'), planData: phases.map(p => ({ title: p.title, status: 'pending' })), status: 'completed', icon: 'check' });
            }

            // 4. DESIGN SPEC (Skip for resume/update if already done)
            if (intent === 'new_build' && !isResume) {
                const designMsgId = (await this.callbacks.onBuildMessage('design_phase', { type: 'build_phase', content: this.t('startingDesign'), status: 'working', icon: 'loader' })).id;
                await this.runStep(PROMPT_KEYS['DESIGN'], JSON.stringify({ request: this.userPrompt, phases }), DEFAULTS.DESIGN, designMsgId);
                await this.callbacks.onBuildMessage('design_phase', { id: designMsgId, content: this.t('designComplete'), status: 'completed', icon: 'check' });
            }

            // 5. EXECUTION LOOP
            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                this.checkAbort();

                // TRUE RESUME: Skip phases already completed
                if (isResume && phase.status === 'completed') {
                    console.log(`Resuming: Skipping phase ${phase.title}`);
                    continue;
                }

                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${phase.id}`, { type: 'build_phase', content: this.t('startingPhase', { phaseTitle: phase.title }), status: 'working', icon: 'loader' })).id;
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                
                const detailedPlan = await this.runStep(PROMPT_KEYS['PLANNER'], JSON.stringify({ phase, user_request: this.userPrompt, existing_files: existingPaths }), DEFAULTS.PLANNER, phaseMsgId);
                const steps = detailedPlan.json.steps || [];

                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    this.checkAbort();
                    
                    await this.callbacks.onBuildMessage(`phase_${phase.id}`, { id: phaseMsgId, content: this.t('buildingPhase', { phaseTitle: phase.title, filePath: step.path }), currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } });
                    
                    const codeRes = await this.runStep(PROMPT_KEYS['BUILDER'], JSON.stringify({ task: step.description, file_path: step.path, existing_files: this.accumulatedFiles.map(f => ({ path: f.path, content: f.content })) }), DEFAULTS.BUILDER, phaseMsgId);
                    
                    if (codeRes.json.file_changes) {
                        const changes = codeRes.json.file_changes as any[];
                        for (const c of changes) {
                            const idx = this.accumulatedFiles.findIndex(f => f.path === c.path);
                            if (idx !== -1) {
                                // Fix: Explicitly cast c to any before accessing content property
                                this.accumulatedFiles[idx] = { ...this.accumulatedFiles[idx], content: sanitizeFileContent((c as any).content, c.path) };
                            } else {
                                // Fix: Explicitly cast c to any before accessing content property
                                this.accumulatedFiles.push({ path: c.path, content: sanitizeFileContent((c as any).content, c.path), type: 'file' });
                            }
                        }
                    }
                    await this.callbacks.onChunkComplete({ html: '', javascript: '', css: '', explanation: `Step ${j+1}/${steps.length} finished.` }, `Built ${step.path}`, { files: this.accumulatedFiles });
                }

                phase.status = 'completed';
                await this.callbacks.onPhaseComplete(i);
                await this.callbacks.onBuildMessage(`phase_${phase.id}`, { id: phaseMsgId, content: this.t('phaseComplete', { phaseTitle: phase.title }), status: 'completed', icon: 'check' });
            }

            // 6. FINAL SUCCESS
            const isFarsi = /[\u0600-\u06FF]/.test(this.userPrompt) || this.lang === 'fa';
            const successMsg = isFarsi ? "🎉 ساخت و بروزرسانی با موفقیت انجام شد!" : "🎉 Build and updates completed successfully!";
            await this.callbacks.onSuccess({ html: '', javascript: '', css: '', explanation: 'Success' }, successMsg, { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });

        } catch (e: any) {
            console.error("Supervisor Failure:", e);
            await this.callbacks.onFinalError(e.message);
        }
    }
}

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    // Fast mock for now
    return "Application";
};
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
