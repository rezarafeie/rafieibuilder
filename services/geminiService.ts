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
    'CLASSIFIER': `You are a strategic router for a web app builder.
Analyze user intent and respond with a minified JSON object.
Rules:
1. DO NOT include any text before or after the JSON.
2. DO NOT use markdown code blocks.
JSON Structure:
{
  "intent": "chat" | "build" | "repair",
  "direct_response": "Message for chat intent only"
}`,
    'DESIGN': `Architect the UI/UX for a new project. 
Respond with a minified JSON object.
Rules:
1. Always include index.html, src/main.tsx, and src/App.tsx in the architecture if they don't exist.
2. DO NOT include any text before or after the JSON.
JSON Structure:
{
  "design_language": { "theme": "modern" | "neo-brutalism" | "glassmorphism", "primary_color": "hex" },
  "pages": [ { "route": "/", "name": "Home", "sections": ["hero", "features"] } ]
}`,
    'PHASE_PLANNER': `Break the project into milestones. 
Respond with a minified JSON object.
MANDATORY RULES:
1. For NEW projects, the first phase MUST be "Project Foundation" to create index.html, src/main.tsx, and src/App.tsx.
2. The preview CANNOT work without these files.
JSON Structure:
{
  "phases": [ { "title": "Milestone Name", "goal": "Description", "type": "ui" | "logic" | "backend" } ]
}`,
    'PLANNER': `Create implementation steps for this phase.
Respond with a minified JSON object.
JSON Structure:
{
  "steps": [ { "title": "Step Name", "path": "src/App.tsx", "description": "Specific coding instructions", "is_entry": boolean } ]
}`,
    'BUILDER': `Write code for the requested file. 
Respond with a minified JSON object.
CRITICAL RULES:
1. NEVER delete or modify "index.html" in a way that removes <div id="root">.
2. Ensure index.html always renders App.tsx through src/main.tsx.
3. If you write large files, ensure the JSON remains valid and not truncated.
4. Avoid tailwind.config.js; use inline Tailwind classes as the platform uses CDN Tailwind.
JSON Structure:
{
  "file_changes": [ { "path": "string", "content": "Full code", "action": "create" | "update" } ]
}`,
    'REPAIR_PLANNER': `Surgically fix the error provided.
Respond with a minified JSON object.
JSON Structure:
{
  "patches": [ { "path": "string", "content": "Full Fixed code", "action": "update" } ],
  "explanation": "Summary"
}`,
    'TITLE': `Generate a creative 2-word app name.
Respond with a minified JSON object.
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
    return (DEFAULTS as any)[key] || "You are a helpful coding assistant. Respond ONLY with valid JSON.";
};

// --- ROBUST JSON EXTRACTION & REPAIR ---

/**
 * Attempts to repair truncated JSON by balancing braces, brackets, and quotes.
 */
const repairJson = (json: string): string => {
    let repaired = json.trim();
    
    // 1. Handle unclosed string property or value
    let inString = false;
    let escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        if (repaired[i] === '"' && !escaped) inString = !inString;
        escaped = repaired[i] === '\\' && !escaped;
    }
    if (inString) repaired += '"';

    // 2. Balance braces and brackets
    const stack: string[] = [];
    inString = false;
    escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (char === '"' && !escaped) inString = !inString;
        if (!inString) {
            if (char === '{' || char === '[') stack.push(char === '{' ? '}' : ']');
            else if (char === '}' || char === ']') {
                if (stack.length > 0 && stack[stack.length - 1] === char) stack.pop();
            }
        }
        escaped = char === '\\' && !escaped;
    }

    while (stack.length > 0) {
        repaired += stack.pop();
    }

    return repaired;
};

const extractJson = (text: string | undefined): any => {
    if (!text) throw new Error("AI returned empty response");
    
    let cleaned = text
        .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
        .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
    
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Strategy 1: Direct Parse
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        // Strategy 2: Extract block and attempt repair
        const firstBrace = cleaned.indexOf('{');
        const firstBracket = cleaned.indexOf('[');
        const start = (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) ? firstBrace : firstBracket;
        
        if (start !== -1) {
            // Find the last actual delimiter or just take the rest of the string
            const potentialJson = cleaned.substring(start);
            const repaired = repairJson(potentialJson);
            try {
                return JSON.parse(repaired);
            } catch (innerError) {
                console.error("Critical Parse Error after repair attempt:", repaired);
                throw new Error(`Invalid JSON format: ${innerError}`);
            }
        }
    }
    throw new Error("Invalid AI Response Format: Could not find or parse any JSON structure.");
};

// --- ORCHESTRATOR UTILS ---
const getActiveProvider = async (): Promise<AIProviderConfig> => {
    try {
        const active = await aiProviderService.getActiveConfig();
        if (active && active.apiKey) return active;
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey) return fallback;
    } catch (e) {}
    // UPDATED: Use gemini-3-pro-preview for coding-related generation tasks
    return { id: 'google', name: 'Google Gemini (System)', isActive: true, isFallback: false, apiKey: process.env.API_KEY || '', model: 'gemini-3-pro-preview', updatedAt: Date.now() };
};

const executeAIRequest = async (config: AIProviderConfig, prompt: string, systemInstruction: string, images: string[] = []): Promise<{ text: string, usage: AIUsageResult }> => {
    if (!config.apiKey) throw new Error(`AI configuration for ${config.name} is missing an API Key.`);
    if (config.id === 'google') {
        const ai = new GoogleGenAI({ apiKey: config.apiKey });
        // UPDATED: Set thinkingBudget when maxOutputTokens is set for Gemini 3 series models to ensure response capacity
        const reqConfig: any = { 
            systemInstruction, 
            temperature: 0.1, 
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 8192 },
            responseMimeType: systemInstruction.toUpperCase().includes('JSON') ? 'application/json' : 'text/plain'
        };
        let contents: any = prompt;
        if (images.length > 0) {
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
        // UPDATED: Ensuring default model is gemini-3-pro-preview for complex coding tasks
        const response = await ai.models.generateContent({ model: config.model || 'gemini-3-pro-preview', contents, config: reqConfig });
        const input = Number(response.usageMetadata?.promptTokenCount || 0);
        const output = Number(response.usageMetadata?.candidatesTokenCount || 0);
        const cost = billingService.calculateRawCost(config.model || 'gemini-3-pro-preview', input, output);
        return { text: response.text || "{}", usage: { promptTokens: input, completionTokens: output, costUsd: cost, provider: 'google', model: config.model || 'gemini-3-pro-preview' } };
    } 
    else if (config.id === 'openai') return await openaiService.generateContent(config.apiKey, config.model, prompt, systemInstruction, images);
    else if (config.id === 'claude') return await claudeService.generateContent(config.apiKey, config.model, prompt, systemInstruction, images);
    throw new Error(`Unknown provider: ${config.id}`);
};

const robustGenerate = async (prompt: string, systemInstruction: string, projectId: string, userId: string, opType: string, images: string[] = [], options?: { messageId?: string, meta?: any }): Promise<{text: string, usage: AIUsageResult}> => {
    let activeConfig = await getActiveProvider();
    try {
        const result = await executeAIRequest(activeConfig, prompt, systemInstruction, images);
        const ledgerMeta = { 
            messageId: options?.messageId, 
            systemPrompt: systemInstruction,
            userPrompt: prompt,
            aiResponse: result.text,
            ...options?.meta 
        };
        billingService.chargeUser(userId, projectId, opType, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, ledgerMeta).catch(console.error);
        return result;
    } catch (error: any) {
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey && fallback.id !== activeConfig.id) {
            const result = await executeAIRequest(fallback, prompt, systemInstruction, images);
            const ledgerMeta = { 
                messageId: options?.messageId, 
                systemPrompt: systemInstruction,
                userPrompt: prompt,
                aiResponse: result.text,
                note: "Fallback",
                ...options?.meta 
            };
            billingService.chargeUser(userId, projectId, `${opType}_fallback`, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, ledgerMeta).catch(console.error);
            return result;
        }
        throw error;
    }
};

// ADDED: SupervisorCallbacks interface to resolve "Cannot find name 'SupervisorCallbacks'" errors
export interface SupervisorCallbacks {
    onPlanUpdate: (phases: Phase[]) => Promise<void>;
    onMessage?: (msg: Message) => Promise<void>;
    onBuildMessage: (key: string, message: Partial<Message>) => Promise<Message>;
    onPhaseStart: (index: number, phase: { text: string }) => Promise<void>;
    onPhaseComplete: (index: number) => Promise<void>;
    onStepStart: (index: number, step: any) => Promise<void>;
    onStepComplete: (index: number, name: string) => Promise<void>;
    onChunkComplete: (code: GeneratedCode, explanation: string, meta?: any) => Promise<void>;
    onSuccess: (code: GeneratedCode, explanation: string, audit: BuildAudit, meta?: any) => Promise<void>;
    onError: (error: string) => Promise<void>;
    onFinalError: (error: string) => Promise<void>;
    onAIDebugLog?: (log: AIDebugLog, logicalMessageKey: string) => void;
    waitForPreview?: (timeoutMs: number) => Promise<{ success: boolean; error?: string }>;
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

    private async runStep(key: string, prompt: string, logicalMessageKey: string): Promise<any> {
        this.checkAbort();
        let sys = await getSystemPrompt(key);
        if (this.lang === 'fa' || /[\u0600-\u06FF]/.test(this.userPrompt)) {
            sys = "IMPORTANT: All user-facing strings in the JSON response MUST be in Farsi.\n" + sys;
        }
        this.checkAbort();
        const { text, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey});
        if (this.callbacks.onAIDebugLog) {
            this.callbacks.onAIDebugLog({ id: crypto.randomUUID(), timestamp: Date.now(), stepKey: key, model: usage.model, systemInstruction: sys, prompt, response: text }, logicalMessageKey);
        }
        return extractJson(text);
    }

    private async ensureProjectFoundation() {
        const foundationPaths = ['index.html', 'src/main.tsx', 'src/App.tsx'];
        const needsBootstrap = foundationPaths.some(path => !this.accumulatedFiles.some(f => f.path === path));
        
        if (needsBootstrap) {
            const defaults = [
                { path: 'index.html', content: '<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>App</title></head><body><div id="root"></div></body></html>', type: 'file' as const },
                { path: 'src/main.tsx', content: 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nconst root = document.getElementById("root");\nif (root) createRoot(root).render(<App />);', type: 'file' as const },
                { path: 'src/App.tsx', content: 'import React from "react";\nexport default function App() { return <div className="p-8"><h1>Initializing App...</h1></div>; }', type: 'file' as const }
            ];
            
            for (const def of defaults) {
                if (!this.accumulatedFiles.some(f => f.path === def.path)) {
                    this.accumulatedFiles.push(def);
                }
            }
            await this.callbacks.onChunkComplete(this.project.code, "Established project foundation.", { files: this.accumulatedFiles });
        }
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            if (!isResume) await this.ensureProjectFoundation();

            const classMsgId = (await this.callbacks.onBuildMessage('classifier', { type: 'build_status', content: "Strategizing build approach...", status: 'working', icon: 'loader', startTime: Date.now() })).id;
            const classification = await this.runStep('CLASSIFIER', `User Prompt: ${this.userPrompt}`, classMsgId);
            if (classification.intent === 'chat') {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, type: 'assistant_response', content: classification.direct_response, status: 'completed' });
                await this.callbacks.onSuccess(this.project.code, "Chat complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }
            await this.callbacks.onBuildMessage('classifier', { id: classMsgId, status: 'completed', content: "Build strategy defined." });

            const designMsgId = (await this.callbacks.onBuildMessage('design', { type: 'build_status', content: "Designing architecture & UI...", status: 'working', icon: 'loader', startTime: Date.now() })).id;
            const designSpec = await this.runStep('DESIGN', `Request: ${this.userPrompt}\nExisting Files: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, designMsgId);
            await this.callbacks.onBuildMessage('design', { id: designMsgId, status: 'completed', content: "Application architecture designed." });

            const phasePlanMsgId = (await this.callbacks.onBuildMessage('phases_planning', { type: 'build_status', content: "Planning development milestones...", status: 'working', icon: 'loader', startTime: Date.now() })).id;
            const phaseRes = await this.runStep('PHASE_PLANNER', JSON.stringify({ request: this.userPrompt, design: designSpec }), phasePlanMsgId);
            const phases: Phase[] = phaseRes.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);
            await this.callbacks.onBuildMessage('phases_planning', { id: phasePlanMsgId, status: 'completed', content: `${phases.length} milestones planned.` });

            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                if (isResume && phase.status === 'completed') continue;
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${i}`, { type: 'build_phase', content: `Building Milestone: ${phase.title}`, status: 'working', startTime: Date.now() })).id;
                const stepsRes = await this.runStep('PLANNER', JSON.stringify({ phase, design: designSpec }), phaseMsgId);
                const steps = stepsRes.steps || [];
                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } });
                    const builderRes = await this.runStep('BUILDER', JSON.stringify({ task: step.description, path: step.path, design: designSpec, context_files: this.accumulatedFiles.map(f=>({path:f.path, content: f.content.substring(0, 1000)})) }), phaseMsgId);
                    if (builderRes.file_changes) {
                        for (const change of builderRes.file_changes) {
                            const cleanPath = change.path.replace(/^\//, '');
                            if (cleanPath === 'index.html' && (change.action === 'delete' || !change.content.includes('id="root"'))) continue;
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
            
            // Final Completion Narration
            await this.callbacks.onBuildMessage('final_completion', { 
                type: 'assistant_response', 
                content: this.lang === 'fa' ? "ساخت پروژه شما با موفقیت به پایان رسید! اکنون می‌توانید پیش‌نمایش آن را مشاهده کرده و آن را در وب منتشر کنید." : "The project build is now complete! You can now preview your application in the canvas and publish it to the web whenever you're ready.", 
                status: 'completed',
                icon: 'sparkles'
            });

            await this.callbacks.onSuccess(this.project.code, "Build complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            if (e.message !== "ABORTED") await this.callbacks.onFinalError(e.message || "An unexpected error occurred.");
        }
    }

    public async repair(error: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Analyzing error and planning fix...", status: 'working', icon: 'wrench', startTime: Date.now() })).id;
        try {
            const res = await this.runStep('REPAIR_PLANNER', JSON.stringify({ error, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 2000)})) }), msgId);
            if (res.patches) {
                for (const patch of res.patches) {
                    const cleanPath = patch.path.replace(/^\//, '');
                    if (cleanPath === 'index.html' && (patch.action === 'delete' || !patch.content.includes('id="root"'))) continue;
                    const idx = this.accumulatedFiles.findIndex(f => f.path === cleanPath);
                    const sanitized = sanitizeFileContent(patch.content, cleanPath);
                    if (idx !== -1) this.accumulatedFiles[idx].content = sanitized;
                    else this.accumulatedFiles.push({ path: cleanPath, content: sanitized, type: 'file' });
                }
                await this.callbacks.onChunkComplete(this.project.code, "Applied fix", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, status: 'completed', content: "Issue resolved successfully." });
            await this.callbacks.onSuccess(this.project.code, "Healed.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            if (e.message !== "ABORTED") await this.callbacks.onFinalError("Repair failed: " + e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const sys = await getSystemPrompt('TITLE');
        const config = await getActiveProvider();
        const { text } = await executeAIRequest(config, `Request: ${prompt}`, sys);
        const json = extractJson(text);
        return json.title || "New Project";
    } catch (e) { return "New Project"; }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
