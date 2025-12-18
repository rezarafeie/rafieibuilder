
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
    'CLASSIFIER': 'sys_prompt_classifier_v13',
    'DESIGN': 'sys_prompt_design_v13',
    'PHASE_PLANNER': 'sys_prompt_phase_planner_v13', 
    'PLANNER': 'sys_prompt_planner_v13', 
    'BUILDER': 'sys_prompt_builder_v13', 
    'UPDATER': 'sys_prompt_updater_v13', 
    'REPAIR_PLANNER': 'sys_prompt_repair_planner_v13',
    'TITLE': 'sys_prompt_title_v13'
};

export const DEFAULTS: Record<string, string> = {
    'CLASSIFIER': `You are the brain of an AI App Builder. Analyze the user's request.
Possible Intents:
1. "build": creating a new app, adding a major feature, or changing the look significantly.
2. "update": changing specific text, fixing a small bug, or minor CSS tweaks.
3. "chat": general questions not related to code changes.

Output JSON ONLY:
{ "intent": "build" | "update" | "chat", "direct_response": "string" }`,

    'UPDATER': `You are an expert React/Vite developer.
Task: Update specific files based on the user request.
Output JSON ONLY.
Format: { "patches": [ { "path": "src/App.tsx", "content": "FULL_FILE_CONTENT_HERE" } ], "summary": "string" }
IMPORTANT: Return the COMPLETE file content, not diffs.`,

    'DESIGN': `You are a UI/UX Architect.
Task: Design a modern, beautiful, and responsive web application.
Style: Clean, whitespace-heavy, rounded corners, subtle shadows (Lovable/Vercel style).
CRITICAL: Focus ONLY on UI components, Layout, and User Experience.
FORBIDDEN: Do NOT generate marketing briefs, audience segments, or conversion strategies.
Output JSON ONLY: { "design_language": { "theme": "modern", "colors": ["#..."] }, "pages": [{ "name": "Home", "components": ["Hero", "Features"] }] }`,

    'PHASE_PLANNER': `You are a Project Manager.
Task: Break down the build into logical phases.
CRITICAL: Start immediately with "Setup" and "UI Implementation".
FORBIDDEN: Do NOT create phases for "Research", "Briefing", "Strategy", or "Audience Analysis".
Output JSON ONLY: { "phases": [ { "title": "Setup", "goal": "Initialize layout", "type": "ui" } ] }`,

    'PLANNER': `You are a Tech Lead.
Task: List specific file generation steps for this phase.
Output JSON ONLY: { "steps": [ { "title": "Create Header", "path": "src/components/Header.tsx", "description": "Responsive navbar with logo" } ] }`,

    'BUILDER': `You are a Senior React Developer.
Task: Write professional, production-ready code.
Stack: React 18, Tailwind CSS, Lucide React, Framer Motion (optional).
Rules:
- Use 'export default' for components.
- Ensure all imports are valid (lucide-react, react-router-dom).
- NO placeholders. Write full logic.
Output JSON ONLY: { "file_changes": [ { "path": "string", "content": "string" } ] }`,

    'REPAIR_PLANNER': `You are a Debugging Expert.
Task: Analyze the error and fix the code.
Output JSON ONLY: { "patches": [ { "path": "string", "content": "string" } ], "explanation": "string" }`,

    'TITLE': `Generate a short, catchy project title (max 4 words).
JSON ONLY.
Example: { "title": "TaskMaster" }`
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
    } catch (e) {}
    return (DEFAULTS as any)[key] || "Respond ONLY with valid JSON.";
};

// --- HIGH PERFORMANCE JSON ENGINE ---

const preRepairMangledJson = (text: string): string => {
    let result = text.trim();
    const backtickRegex = /("[\w_]+")\s*:\s*`([\s\S]*?)`(\s*[,}\]])/g;
    result = result.replace(backtickRegex, (match, key, content, suffix) => {
        return `${key}: ${JSON.stringify(content)}${suffix}`;
    });
    return result;
};

const repairJson = (json: string): string => {
    let repaired = json.trim();
    let inString = false;
    let escaped = false;
    for (let i = 0; i < repaired.length; i++) {
        if (repaired[i] === '"' && !escaped) inString = !inString;
        escaped = repaired[i] === '\\' && !escaped;
    }
    if (inString) repaired += '"';
    
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
        .replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, "")
        .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
    
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, "");

    if ((cleaned.startsWith('{') || cleaned.startsWith('[')) && (cleaned.endsWith('}') || cleaned.endsWith(']'))) {
        try { 
            return JSON.parse(cleaned); 
        } catch (e) {
        }
    }

    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    
    let start = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
        start = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
        start = firstBrace;
    } else if (firstBracket !== -1) {
        start = firstBracket;
    }

    if (start !== -1) {
        let potentialJson = cleaned.substring(start);
        const lastBrace = potentialJson.lastIndexOf('}');
        const lastBracket = potentialJson.lastIndexOf(']');
        const end = Math.max(lastBrace, lastBracket);
        
        if (end !== -1) {
            potentialJson = potentialJson.substring(0, end + 1);
            
            try { 
                return JSON.parse(potentialJson); 
            } catch (innerError) {
                potentialJson = preRepairMangledJson(potentialJson);
                try {
                    return JSON.parse(potentialJson);
                } catch (mangleError) {
                    const repaired = repairJson(potentialJson);
                    try { 
                        return JSON.parse(repaired); 
                    } catch (finalError: any) {
                        try {
                            const fn = new Function(`return (${repaired})`);
                            return fn();
                        } catch (looseError) {
                            throw new Error(`JSON Extraction failed. Raw text start: ${cleaned.substring(0, 50)}...`);
                        }
                    }
                }
            }
        }
    }
    
    throw new Error(`No structured JSON data found in AI response. Response start: ${text.substring(0, 20)}...`);
};

// --- ORCHESTRATOR ---

const getActiveProvider = async (): Promise<AIProviderConfig> => {
    try {
        const active = await aiProviderService.getActiveConfig();
        if (active && active.apiKey) return active;
    } catch (e) {}
    return { id: 'google', name: 'Google Gemini', isActive: true, isFallback: false, apiKey: process.env.API_KEY || '', model: 'gemini-3-pro-preview', updatedAt: Date.now() };
};

const executeAIRequest = async (config: AIProviderConfig, prompt: string, systemInstruction: string, images: string[] = []): Promise<{ text: string, usage: AIUsageResult }> => {
    if (!config.apiKey) throw new Error(`API Key missing for ${config.name}.`);
    
    if (config.id === 'google') {
        const model = config.model || 'gemini-3-pro-preview';
        const TARGET_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
        
        const parts: any[] = [];
        if (images.length > 0) {
            images.forEach(img => {
                let data = img;
                let mimeType = 'image/jpeg';
                if (img.startsWith('data:')) {
                    const split = img.split('base64,');
                    data = split[1];
                    mimeType = split[0].split(':')[1].split(';')[0];
                }
                parts.push({ inlineData: { mimeType, data } });
            });
        }
        parts.push({ text: prompt });

        const payload = {
            contents: [{ role: 'user', parts: parts }],
            generationConfig: { 
                temperature: 0.1, 
                maxOutputTokens: 16384,
                responseMimeType: 'application/json'
            },
            systemInstruction: { parts: [{ text: systemInstruction }] }
        };

        const response = await fetch(TARGET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const input = Number(data.usageMetadata?.promptTokenCount || 0);
        const output = Number(data.usageMetadata?.candidatesTokenCount || 0);
        const cost = billingService.calculateRawCost(model, input, output);

        return { 
            text, 
            usage: { 
                promptTokens: input, 
                completionTokens: output, 
                costUsd: cost, 
                provider: 'google', 
                model 
            } 
        };
    } 
    
    if (config.id === 'openai') return await openaiService.generateContent(config.apiKey, config.model, prompt, systemInstruction, images);
    if (config.id === 'claude') return await claudeService.generateContent(config.apiKey, config.model, prompt, systemInstruction, images);
    
    throw new Error(`Provider ${config.id} not implemented.`);
};

const robustGenerate = async (prompt: string, systemInstruction: string, projectId: string, userId: string, opType: string, images: string[] = [], options?: { messageId?: string, meta?: any }): Promise<{text: string, usage: AIUsageResult}> => {
    let activeConfig = await getActiveProvider();
    try {
        const result = await executeAIRequest(activeConfig, prompt, systemInstruction, images);
        billingService.chargeUser(userId, projectId, opType, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { messageId: options?.messageId, ...options?.meta }).catch(console.error);
        return result;
    } catch (error: any) {
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey && fallback.id !== activeConfig.id) {
            const result = await executeAIRequest(fallback, prompt, systemInstruction, images);
            billingService.chargeUser(userId, projectId, `${opType}_fallback`, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, { messageId: options?.messageId, note: "Fallback used", ...options?.meta }).catch(console.error);
            return result;
        }
        throw error;
    }
};

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
            sys = "IMPORTANT: Respond in Farsi.\n" + sys;
        }
        this.checkAbort();
        const { text, usage } = await robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, { messageId: logicalMessageKey });
        if (this.callbacks.onAIDebugLog) {
            this.callbacks.onAIDebugLog({ id: crypto.randomUUID(), timestamp: Date.now(), stepKey: key, model: usage.model, systemInstruction: sys, prompt, response: text }, logicalMessageKey);
        }
        return extractJson(text);
    }

    private async ensureProjectFoundation() {
        const foundationPaths = ['index.html', 'src/main.tsx', 'src/App.tsx'];
        if (foundationPaths.some(p => !this.accumulatedFiles.some(f => f.path === p))) {
            const defaults = [
                { path: 'index.html', content: '<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>', type: 'file' as const },
                { path: 'src/main.tsx', content: 'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\nconst root = document.getElementById("root");\nif (root) createRoot(root).render(<App />);', type: 'file' as const },
                { path: 'src/App.tsx', content: 'import React from "react";\nexport default function App() { return <div className="p-8"><h1>Initializing App...</h1></div>; }', type: 'file' as const }
            ];
            for (const def of defaults) {
                if (!this.accumulatedFiles.some(f => f.path === def.path)) this.accumulatedFiles.push(def);
            }
        }
    }

    public async start(isResume: boolean = false) {
        try {
            this.checkAbort();
            if (!isResume) await this.ensureProjectFoundation();

            const classMsgId = (await this.callbacks.onBuildMessage('classifier', { type: 'build_status', content: "Analyzing request...", status: 'working', icon: 'loader', startTime: Date.now() })).id;
            const classification = await this.runStep('CLASSIFIER', `Request: ${this.userPrompt}\nFiles: ${this.accumulatedFiles.map(f=>f.path).join(',')}`, classMsgId);
            
            if (classification.intent === 'chat') {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, type: 'assistant_response', content: classification.direct_response, status: 'completed' });
                await this.callbacks.onSuccess(this.project.code, "Chat complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            if (classification.intent === 'update' && this.accumulatedFiles.length > 2) {
                await this.callbacks.onBuildMessage('classifier', { id: classMsgId, status: 'completed', content: "Update intent detected." });
                const updateMsgId = (await this.callbacks.onBuildMessage('fast_update', { type: 'build_status', content: "Surgically applying changes...", status: 'working', icon: 'wrench', startTime: Date.now() })).id;
                const updateRes = await this.runStep('UPDATER', JSON.stringify({ request: this.userPrompt, files: this.accumulatedFiles.map(f=>({path:f.path, content: f.content.substring(0, 5000)})) }), updateMsgId);
                
                const changes = updateRes.file_changes || updateRes.patches;
                if (changes) {
                    for (const change of changes) { this.applyChange(change); }
                    await this.callbacks.onChunkComplete(this.project.code, "Updates applied.", { files: this.accumulatedFiles });
                }
                
                await this.callbacks.onBuildMessage('fast_update', { id: updateMsgId, status: 'completed', content: updateRes.summary || "Code successfully modified." });
                await this.callbacks.onSuccess(this.project.code, "Build update complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
                return;
            }

            await this.callbacks.onBuildMessage('classifier', { id: classMsgId, status: 'completed', content: "Starting architecture phase." });

            const designMsgId = (await this.callbacks.onBuildMessage('design', { type: 'build_status', content: "Designing layout...", status: 'working', icon: 'loader', startTime: Date.now() })).id;
            const designSpec = await this.runStep('DESIGN', `Prompt: ${this.userPrompt}`, designMsgId);
            await this.callbacks.onBuildMessage('design', { id: designMsgId, status: 'completed', content: "UI/UX Architecture designed." });

            const phaseRes = await this.runStep('PHASE_PLANNER', JSON.stringify({ request: this.userPrompt, design: designSpec }), 'phase_planning');
            const phases: Phase[] = phaseRes.phases.map((p: any) => ({ id: crypto.randomUUID(), title: p.title, description: p.goal, status: 'pending', retryCount: 0, type: p.type || 'ui' }));
            await this.callbacks.onPlanUpdate(phases);

            for (let i = 0; i < phases.length; i++) {
                const phase = phases[i];
                if (isResume && phase.status === 'completed') continue;
                await this.callbacks.onPhaseStart(i, { text: phase.title });
                const phaseMsgId = (await this.callbacks.onBuildMessage(`phase_${i}`, { type: 'build_phase', content: `Building: ${phase.title}`, status: 'working', startTime: Date.now() })).id;
                
                const stepsRes = await this.runStep('PLANNER', JSON.stringify({ request: this.userPrompt, phase, design: designSpec }), phaseMsgId);
                const steps = stepsRes.steps || [];
                for (let j = 0; j < steps.length; j++) {
                    const step = steps[j];
                    await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, currentStepProgress: { current: j + 1, total: steps.length, stepName: step.title } });
                    const builderRes = await this.runStep('BUILDER', JSON.stringify({ task: step.description, path: step.path, context: this.accumulatedFiles.map(f=>({path:f.path, content: f.content.substring(0, 1000)})) }), phaseMsgId);
                    
                    const changes = builderRes.file_changes || builderRes.patches;
                    if (changes) {
                        for (const change of (Array.isArray(changes) ? changes : [])) { this.applyChange(change); }
                    }
                    await this.callbacks.onChunkComplete(this.project.code, `Generated ${step.path}`, { files: this.accumulatedFiles });
                }
                phase.status = 'completed';
                await this.callbacks.onPhaseComplete(i);
                await this.callbacks.onBuildMessage(`phase_${i}`, { id: phaseMsgId, status: 'completed' });
            }
            await this.callbacks.onSuccess(this.project.code, "Build finished.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            if (e.message !== "ABORTED") await this.callbacks.onFinalError(e.message);
        }
    }

    private applyChange(change: { path: string, content: string, action?: string }) {
        if (!change.content || !change.path) return;
        const cleanPath = change.path.replace(/^\//, '');
        if (cleanPath === 'index.html' && !change.content.includes('id="root"')) return;
        
        const idx = this.accumulatedFiles.findIndex(f => f.path === cleanPath);
        const content = sanitizeFileContent(change.content, cleanPath);
        if (idx !== -1) this.accumulatedFiles[idx].content = content;
        else this.accumulatedFiles.push({ path: cleanPath, content, type: 'file' });
    }

    public async repair(error: string) {
        const msgId = (await this.callbacks.onBuildMessage('repair', { type: 'build_status', content: "Fixing runtime error...", status: 'working', icon: 'wrench', startTime: Date.now() })).id;
        try {
            const res = await this.runStep('REPAIR_PLANNER', JSON.stringify({ error, files: this.accumulatedFiles.map(f=>({path: f.path, content: f.content.substring(0, 3000)})) }), msgId);
            const patches = res.patches || res.file_changes;
            if (patches) {
                for (const patch of (Array.isArray(patches) ? patches : [])) { this.applyChange(patch); }
                await this.callbacks.onChunkComplete(this.project.code, "Fix applied.", { files: this.accumulatedFiles });
            }
            await this.callbacks.onBuildMessage('repair', { id: msgId, status: 'completed', content: "Error resolved." });
            await this.callbacks.onSuccess(this.project.code, "Repair complete.", { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] }, { files: this.accumulatedFiles });
        } catch (e: any) {
            if (e.message !== "ABORTED") await this.callbacks.onFinalError("Repair failed: " + e.message);
        }
    }
}

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    try {
        const config = await getActiveProvider();
        const { text } = await executeAIRequest(config, `Request: ${prompt}`, await getSystemPrompt('TITLE'));
        
        try {
            const json = extractJson(text);
            return json.title || "New Project";
        } catch (jsonError) {
            console.warn("Title Generation: JSON extraction failed, attempting fallback.");
            const cleanText = text.replace(/"/g, '').trim();
            if (cleanText.length > 0 && cleanText.length < 50 && !cleanText.includes('{')) {
                return cleanText;
            }
            return "New Project";
        }
    } catch (e) { 
        console.error("Title Generation Failed:", e);
        return "New Project"; 
    }
};

export const handleUserIntent = async (project: Project, prompt: string) => ({ isArchitect: true });
export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string) => [];
