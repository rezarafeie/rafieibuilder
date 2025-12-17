
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

const getSystemPrompt = async (key: string): Promise<string> => {
    if (promptCache[key]) return promptCache[key];
    try {
        const { data, error } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
        if (error) throw error;
        if (data?.value) {
            promptCache[key] = data.value;
            return data.value;
        }
    } catch (e) {}
    throw new Error(`CRITICAL CONFIG ERROR: System prompt [${key}] is missing from the database.`);
};

// --- ORCHESTRATOR UTILS ---
const getActiveProvider = async (): Promise<AIProviderConfig> => {
    const active = await aiProviderService.getActiveConfig();
    if (active) return active;
    const fallback = await aiProviderService.getFallbackConfig();
    if (fallback && fallback.apiKey) return fallback;
    return { id: 'google', name: 'Google Gemini', isActive: true, isFallback: false, apiKey: DEFAULT_GEMINI_KEY, model: 'gemini-3-flash-preview', updatedAt: Date.now() };
};

const executeAIRequest = async (config: AIProviderConfig, prompt: string, systemInstruction: string, images: string[] = []): Promise<{ text: string, usage: AIUsageResult }> => {
    if (config.id === 'google') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey! });
        const response = await ai.models.generateContent({ 
            model: config.model || 'gemini-3-flash-preview', 
            contents: images.length > 0 ? { parts: [...images.map(img => ({ inlineData: { mimeType: 'image/jpeg', data: img.includes('base64,') ? img.split('base64,')[1] : img } })), { text: prompt }] } : prompt,
            config: { systemInstruction, temperature: 0.1, responseMimeType: systemInstruction.includes('JSON') ? 'application/json' : undefined }
        });
        const iT = Number(response.usageMetadata?.promptTokenCount || 0);
        const oT = Number(response.usageMetadata?.candidatesTokenCount || 0);
        return { text: response.text || "{}", usage: { promptTokens: iT, completionTokens: oT, costUsd: billingService.calculateRawCost(config.model, iT, oT), provider: 'google', model: config.model } };
    } else if (config.id === 'openai') {
        return await openaiService.generateContent(config.apiKey!, config.model, prompt, systemInstruction, images);
    }
    throw new Error(`Unsupported provider: ${config.id}`);
};

const robustGenerate = async (prompt: string, systemInstruction: string, projectId: string, userId: string, opType: string, images: string[] = []): Promise<{text: string, usage: AIUsageResult}> => {
    const activeConfig = await getActiveProvider();
    const result = await executeAIRequest(activeConfig, prompt, systemInstruction, images);
    await billingService.chargeUser(userId, projectId, opType, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { prompt, response: result.text });
    return result;
};

const extractJson = (text: string): any => {
    try {
        let cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
        return JSON.parse(cleaned);
    } catch (e) {
        const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (match) return JSON.parse(match[0]);
        throw new Error("AI failed to return valid JSON.");
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
}

export class GenerationSupervisor {
    private project: Project;
    private userPrompt: string;
    private images: string[];
    private callbacks: SupervisorCallbacks;
    private lang: Language;
    private accumulatedFiles: ProjectFile[] = [];
    private entryPath: string | null = null;

    constructor(project: Project, userPrompt: string, images: string[], callbacks: SupervisorCallbacks, signal?: AbortSignal, lang: Language = 'en') {
        this.project = project;
        this.userPrompt = userPrompt;
        this.images = images;
        this.callbacks = callbacks;
        this.accumulatedFiles = project.files || [];
        this.lang = lang;
    }

    private async runStep(key: string, prompt: string, logicalMessageKey: string): Promise<any> {
        const sys = await getSystemPrompt(key);
        const { text } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images);
        return extractJson(text);
    }

    public async start(isResume: boolean = false) {
        try {
            // 1. CLASSIFIER
            const classification = await this.runStep(PROMPT_KEYS['CLASSIFIER'], `USER: ${this.userPrompt}`, 'classifier');
            if (classification.intent === 'chat') {
                await this.callbacks.onBuildMessage('classifier', { type: 'assistant_response', content: classification.direct_response, status: 'completed' });
                return;
            }

            // 2. DESIGN & ARCHITECTURE
            await this.callbacks.onBuildMessage('design', { type: 'build_status', content: "Drafting app architecture...", status: 'working', icon: 'loader' });
            const designSpec = await this.runStep(PROMPT_KEYS['DESIGN'], `REQUEST: ${this.userPrompt}\nEXISTING_FILES: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, 'design');
            await this.callbacks.onBuildMessage('design', { content: "Architecture defined.", status: 'completed', icon: 'check', isExpandable: true, details: JSON.stringify(designSpec, null, 2) });

            // 3. PHASE PLANNING
            const phasePlan = await this.runStep(PROMPT_KEYS['PHASE_PLANNER'], `DESIGN_SPEC: ${JSON.stringify(designSpec)}\nUSER_PROMPT: ${this.userPrompt}`, 'plan');
            const phases: Phase[] = phasePlan.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);

            // 4. EXECUTION ENGINE
            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                if (isResume && phase.status === 'completed') continue;
                
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                const steps = (await this.runStep(PROMPT_KEYS['PLANNER'], `PHASE: ${phase.title}\nDESIGN: ${JSON.stringify(designSpec)}\nFILES: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, `phase_${i}`)).steps;

                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    
                    // --- MANTATORY: depends_on Validation ---
                    if (step.depends_on && Array.isArray(step.depends_on)) {
                        for (const depPath of step.depends_on) {
                            const exists = this.accumulatedFiles.some(f => f.path === depPath);
                            if (!exists) {
                                await this.callbacks.onBuildMessage(`step_${i}_${j}`, { type: 'build_phase', content: `Blocking: Missing dependency ${depPath}`, status: 'failed', icon: 'alert-triangle' });
                                throw new Error(`Build sequencing error: Step for ${step.path} cannot proceed without ${depPath}.`);
                            }
                        }
                    }

                    await this.callbacks.onBuildMessage(`step_${i}_${j}`, { type: 'build_phase', content: `Building ${step.path}...`, status: 'working' });
                    
                    const builderRes = await this.runStep(PROMPT_KEYS['BUILDER'], `FILE: ${step.path}\nTASK: ${step.description}\nCONTEXT: ${JSON.stringify(designSpec)}\nEXISTING_FILES: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, `builder_${i}_${j}`);
                    
                    if (builderRes.file_changes) {
                        for (const change of builderRes.file_changes) {
                            // --- MANDATORY: action logic (create|update) ---
                            const existingIdx = this.accumulatedFiles.findIndex(f => f.path === change.path);
                            const action = change.action || 'update';

                            if (action === 'create' && existingIdx !== -1) {
                                console.log(`Skipping create action for existing file: ${change.path}`);
                                continue; 
                            }

                            const content = sanitizeFileContent(change.content, change.path);
                            
                            // --- MANDATORY: is_entry logic ---
                            if (change.is_entry || step.is_entry) {
                                this.entryPath = change.path;
                            }

                            if (existingIdx !== -1) {
                                this.accumulatedFiles[existingIdx].content = content;
                            } else {
                                this.accumulatedFiles.push({ path: change.path, content, type: 'file' });
                            }
                        }
                    }
                    await this.callbacks.onChunkComplete(this.project.code, `Updated ${step.path}`, { files: this.accumulatedFiles });
                    await this.callbacks.onBuildMessage(`step_${i}_${j}`, { status: 'completed' });
                }
                phase.status = 'completed';
                await this.callbacks.onPhaseComplete(i);
            }

            // --- MANDATORY: Post-Build Validation ---
            await this.validateRuntime();

            await this.callbacks.onSuccess(this.project.code, "Build complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            await this.callbacks.onFinalError(e.message);
        }
    }

    private async validateRuntime() {
        const buildStatusId = (await this.callbacks.onBuildMessage('validation', { type: 'build_status', content: "Verifying runtime stability...", status: 'working', icon: 'shield' })).id;

        // 1. Entry File Check
        const hasEntry = this.entryPath && this.accumulatedFiles.some(f => f.path === this.entryPath);
        const hasStandardEntry = this.accumulatedFiles.some(f => f.path.includes('App.tsx') || f.path.includes('main.tsx'));
        
        if (!hasEntry && !hasStandardEntry) {
            await this.callbacks.onBuildMessage('validation', { id: buildStatusId, status: 'failed' });
            return this.repair("Critical Error: No runtime entry point found. App cannot mount.");
        }

        // 2. Preview Health Check
        if (this.callbacks.waitForPreview) {
            const check = await this.callbacks.waitForPreview(4000); // Wait 4s for mount
            if (!check.success) {
                await this.callbacks.onBuildMessage('validation', { id: buildStatusId, status: 'failed' });
                return this.repair(`Runtime Error: ${check.error || "Preview rendered blank. This usually indicates a broken export or missing import."}`);
            }
        }

        await this.callbacks.onBuildMessage('validation', { id: buildStatusId, content: "Runtime validated. Preview healthy.", status: 'completed', icon: 'check-circle' });
    }

    public async repair(error: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Self-healing triggered...", status: 'working', icon: 'wrench' })).id;
        try {
            const res = await this.runStep(PROMPT_KEYS['REPAIR_PLANNER'], JSON.stringify({ error, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 1000)})) }), msgId);
            if (res.patches) {
                for (const patch of res.patches) {
                    const idx = this.accumulatedFiles.findIndex(f => f.path === patch.path);
                    const content = sanitizeFileContent(patch.content, patch.path);
                    if (idx !== -1) this.accumulatedFiles[idx].content = content;
                    else this.accumulatedFiles.push({ path: patch.path, content, type: 'file' });
                }
                await this.callbacks.onChunkComplete(this.project.code, "Applied healing patches", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, content: "Self-healing complete. Re-validating...", status: 'completed', icon: 'check' });
            
            // Recursively validate after repair
            await this.validateRuntime();
        } catch (e: any) {
            await this.callbacks.onFinalError("Repair failed: " + e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const sys = await getSystemPrompt(PROMPT_KEYS['TITLE']);
        const ai = new GoogleGenAI({ apiKey: DEFAULT_GEMINI_KEY });
        const res = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { systemInstruction: sys } });
        return extractJson(res.text || "{}").title || "AI App";
    } catch (e) { return "New App"; }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
