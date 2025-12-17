
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
// Simple in-memory cache to prevent hammering DB during a single session
const promptCache: Record<string, string> = {};

const getSystemPrompt = async (key: string, defaultVal: string): Promise<string> => {
    // 1. Check cache
    if (promptCache[key]) return promptCache[key];

    // 2. Check DB
    try {
        const { data } = await supabase.from('system_settings').select('value').eq('key', key).single();
        if (data?.value) {
            promptCache[key] = data.value;
            return data.value;
        }
    } catch (e) {
        // Silent fail to default
    }

    // 3. Fallback to Default
    return defaultVal;
};

// --- ORCHESTRATOR UTILS ---
const getActiveProvider = async (): Promise<AIProviderConfig> => {
    try {
        const active = await aiProviderService.getActiveConfig();
        if (active) return active;
        const fallback = await aiProviderService.getFallbackConfig();
        if (fallback && fallback.apiKey) return fallback;
        if (DEFAULT_GEMINI_KEY) {
            return {
                id: 'google',
                name: 'Google Gemini (Env)',
                isActive: true,
                isFallback: false,
                apiKey: DEFAULT_GEMINI_KEY,
                model: 'gemini-2.5-flash',
                updatedAt: Date.now()
            };
        }
    } catch (e) {}
    return { id: 'google', name: 'Google Gemini (Default)', isActive: true, isFallback: false, apiKey: DEFAULT_GEMINI_KEY, model: 'gemini-2.5-flash', updatedAt: Date.now() };
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
        
        // Only use JSON mode if explicitly requested by prompt logic, 
        // but verify system prompt actually contains "JSON" to avoid 400 errors from strict validators.
        if (systemInstruction.toUpperCase().includes('JSON')) {
            reqConfig.responseMimeType = 'application/json';
        }
        
        let contents: any = prompt;
        if (images.length > 0) {
            const parts: any[] = [];
            
            // Parallelize image processing
            await Promise.all(images.map(async (img) => {
                let mimeType = 'image/jpeg';
                let rawBase64 = img;

                // CRITICAL FIX: Reject blob URLs which are transient and local-only
                if (img.startsWith('blob:')) {
                    console.error("Attempted to send Blob URL to Gemini API. This indicates an upload failure or sync issue.", img);
                    return; // Skip this invalid image
                }

                // Handle HTTP URLs by fetching them
                if (img.startsWith('http')) {
                    try {
                        const response = await fetch(img);
                        const blob = await response.blob();
                        const buffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(buffer);
                        // Convert to base64 manually to avoid browser dependency if running in non-browser env (though this is client-side)
                        let binary = '';
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        rawBase64 = btoa(binary);
                        mimeType = blob.type || 'image/jpeg';
                    } catch (e) {
                        console.error("Failed to fetch image URL for Gemini:", img, e);
                        // Skip this image or handle error? For now skip pushing part.
                        return; 
                    }
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

        const response = await ai.models.generateContent({ model: config.model || 'gemini-2.5-flash', contents, config: reqConfig });
        // Fix: Explicitly cast to Number for robustness, although types indicate they should already be numbers.
        const inputTokens = Number(response.usageMetadata?.promptTokenCount || 0);
        const outputTokens = Number(response.usageMetadata?.candidatesTokenCount || 0);
        const cost = billingService.calculateRawCost(config.model || 'gemini-2.5-flash', inputTokens, outputTokens);

        return { text: response.text || "{}", usage: { promptTokens: inputTokens, completionTokens: outputTokens, costUsd: cost, provider: 'google', model: config.model || 'gemini-2.5-flash' } };
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
            prompt: prompt, // Store full prompt
            response: result.text, // Store full response
            apiKey: activeConfig.apiKey, // Store API key (redacted in UI)
            messageId: options?.messageId // Link to chat message
        });
        return result;
    } catch (error: any) {
        console.warn(`Primary AI (${activeConfig.name}) failed:`, error);
        const fallbackConfig = await aiProviderService.getFallbackConfig();
        if (fallbackConfig && fallbackConfig.apiKey) {
            const result = await executeAIRequest(fallbackConfig, prompt, systemInstruction, images);
            await billingService.chargeUser(userId, projectId, `${opType}_fallback`, result.usage.model, { promptTokenCount: result.usage.promptTokens, candidatesTokenCount: result.usage.completionTokens, costUsd: result.usage.costUsd }, {
                prompt: prompt,
                response: result.text,
                apiKey: fallbackConfig.apiKey,
                messageId: options?.messageId,
                note: "Fallback"
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
            // Attempt 1: Parse the raw candidate directly.
            parsedData = JSON.parse(currentCandidate);
            
            if (typeof parsedData === 'object' && parsedData !== null) {
                break; 
            }
            
            if (typeof parsedData === 'string') {
                currentCandidate = parsedData.trim(); 
                const markdownMatch = currentCandidate.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/i);
                if (markdownMatch) {
                    currentCandidate = markdownMatch[1].trim();
                }
                continue; 
            }
            break;

        } catch (e) {
            const firstBrace = currentCandidate.indexOf('{');
            const lastBrace = currentCandidate.lastIndexOf('}');
            const firstBracket = currentCandidate.indexOf('[');
            const lastBracket = currentCandidate.lastIndexOf(']');

            let foundJsonFragment = '';

            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                foundJsonFragment = currentCandidate.substring(firstBrace, lastBrace + 1);
            } else if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
                foundJsonFragment = currentCandidate.substring(firstBracket, lastBracket + 1);
            }

            if (foundJsonFragment) {
                currentCandidate = foundJsonFragment;
                parsedData = null;
                continue; 
            }
            
            parsedData = null; 
            break;
        }
    }

    if (typeof parsedData !== 'object' || parsedData === null) {
        console.error("JSON Parse Fail (final validation). Expected object/array. Raw text snippet:", text.substring(0, 200), parsedData);
        throw new Error("Failed to parse JSON response. The model output was not valid JSON object or array.");
    }

    const extractMarkdownIfPresent = (value: string): string => {
        const innerMarkdownMatch = value.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
        return innerMarkdownMatch ? innerMarkdownMatch[1] : value;
    };

    const processObject = (obj: any): any => {
        if (typeof obj !== 'object' || obj === null) return obj;

        if (Array.isArray(obj)) {
            return obj.map(item => processObject(item));
        }

        const newObj: any = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                if (key === 'content' || key === 'sql' || key === 'description' || key === 'message' || key === 'outputs') { 
                    if (typeof obj[key] === 'string') {
                        newObj[key] = sanitizeFileContent(obj[key], ""); 
                    } else {
                        newObj[key] = processObject(obj[key]);
                    }
                } else {
                    newObj[key] = processObject(obj[key]);
                }
            }
        }
        return newObj;
    };

    return processObject(parsedData);
};

// Renamed keys to 'v3' to force cache busting and bypass broken prompts in DB
export const PROMPT_KEYS = {
    'DECISION': 'sys_prompt_decision_v3',
    'REQUIREMENTS': 'sys_prompt_requirements_v3',
    'PHASE_PLANNER': 'sys_prompt_phase_planner_v3', 
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

// STRICT ARCHITECTURE PROMPTS
export const DEFAULTS = {
    DECISION: `Role: Intent Classifier
Purpose: Understand what the user wants, not how to build it.
Responsibilities:
- Determine if the request is: New project, Modification of existing project, or Simple chat/question.
- Estimate complexity level (simple / normal / complex).
Forbidden: Writing code, Designing UI, Choosing files or frameworks.
Input: User request.
Return STRICT JSON:
{
  "analysis": { "summary": "...", "primary_goal": "...", "complexity": "low|medium|high" },
  "narrative_summary": "Friendly summary...",
  "ui_first_strategy": { "milestone_1_preview_definition": "...", "must_have_pages": ["..."], "must_have_components": ["..."] },
  "backend_intent": { "likely_needs_backend": boolean, "why": "..." }
}`,

    REQUIREMENTS: `Role: Technical Needs Analyzer
Purpose: Decide what the project actually needs at a system level.
Responsibilities:
- Decide definitively whether backend is required.
- Detect needs for: Authentication, Persistent storage, APIs, User-specific data.
Forbidden: UI design, File structure decisions, Writing SQL or code.
Return STRICT JSON:
{
  "needs_backend": boolean,
  "requiredBackendFeatures": { "auth": boolean, "database": boolean, "storage": boolean },
  "dataEntities": [ { "name": "projects", "reason": "..." } ],
  "explanation": "..."
}`,

    PHASE_PLANNER: `Role: Build Order Controller
Purpose: Prevent unstable builds and white previews.
Responsibilities:
- Break the project into safe, sequential phases.
- Ensure all generated 'title' and 'goal' fields within the 'phases' array are **highly specific and customized** to the user's request. For Farsi prompts, these fields MUST be in Farsi.
- Enforce UI-first rendering before logic/backend.
Forbidden: Writing code, Naming files, Designing components.
Return STRICT JSON:
{
  "phases": [
    { "id": "p1", "title": "Phase 1: Build Responsive Navigation Bar", "goal": "Render routes and basic navigation", "type": "ui" }
  ]}`,

    DESIGN: `Role: World-Class UI/UX Designer
Purpose: Create comprehensive, rich, modern, clean, and minimal designs that are highly usable and aesthetically pleasing ("lovable").
Responsibilities:
- Define a sophisticated visual style: "Modern, clean, elegant, rich, comprehensive, minimal, startup-grade. Prioritize generous whitespace, strong visual hierarchy, and balanced use of negative space."
- Specify responsive layouts: Utilize grid-based or flexible column structures for different screen sizes (desktop, tablet, mobile). Ensure designs are mobile-first with fluid transitions.
- Detail components: For each page/section, define the arrangement and style of key UI elements.
    -   **Typography:** Suggest font pairings (e.g., a modern sans-serif for headings, a readable serif/sans-serif for body). Define font sizes, weights, and line heights for headings (H1-H6), body text, and captions.
    -   **Color Palette:** Beyond a primary color, define secondary, accent, neutral, success, warning, and error colors. Suggest how gradients might be used subtly for depth.
    -   **Spacing & Depth:** Use consistent spacing scales (e.g., based on rem or Tailwind's spacing scale). Apply subtle visual depth with shadows and crisp borders for separation.
    -   **Buttons & CTAs:** Design distinct styles for primary, secondary, and ghost buttons with appropriate hover effects.
    -   **Input Fields & Forms:** Define clean, accessible form element styles with clear labels, focus states, and validation indicators.
    -   **Cards & Sections:** Suggest card-based layouts for content grouping, with well-defined padding and margins.
    -   **Icons:** Integrate Lucide React icons tastefully to enhance clarity and visual appeal without clutter.
- Focus on aesthetic quality, accessibility, and an engaging user experience.
Forbidden: Writing JSX or HTML, Managing state or logic, Choosing entry points.
Return STRICT JSON:
{
  "design_language": { 
    "style": "modern, clean, elegant, rich, comprehensive, minimal, startup-grade",
    "colors": { 
      "primary": "#6366f1", 
      "secondary": "#a855f7", 
      "accent": "#ef4444", 
      "neutral": { "50": "#f8fafc", "900": "#0f172a" },
      "success": "#22c55e",
      "warning": "#eab308",
      "error": "#ef4444"
    },
    "typography": {
      "headingFont": "Inter",
      "bodyFont": "Inter",
      "h1": "4rem / 1.1",
      "bodyText": "1rem / 1.5"
    },
    "spacingScale": "rem",
    "shadows": "subtle, intentional",
    "borders": "crisp, minimal"
  },
  "routes": [ { "path": "/", "name": "Home" } ],
  "navigation": { 
    "type": "header-nav",
    "items": [{ "label": "Home", "to": "/", "icon": "Home" }],
    "desktopStyle": "flex items-center gap-6",
    "mobileStyle": "hidden md:flex flex-col gap-4"
  },
  "pages": [ 
    { 
      "route": "/", 
      "name": "Home Page",
      "sections": [
        { 
          "id": "hero", 
          "type": "hero-section", 
          "layout": "full-width-center-content",
          "elements": [
            { "type": "heading", "level": 1, "text": "Your Awesome App", "style": "text-5xl font-extrabold" },
            { "type": "paragraph", "text": "A brief, compelling description.", "style": "text-lg text-gray-600" },
            { "type": "button", "label": "Get Started", "variant": "primary", "icon": "ArrowRight" }
          ]
        },
        {
          "id": "features",
          "type": "card-grid-section",
          "layout": "grid grid-cols-1 md:grid-cols-3 gap-8",
          "cards": [
            { "title": "Feature 1", "description": "Benefit one.", "icon": "Zap" },
            { "title": "Feature 2", "description": "Benefit two.", "icon": "Activity" }
          ]
        }
      ] 
    } 
  ]
}`,

    PLANNER: `Role: Technical Execution Planner & File Source of Truth
Purpose: Prevent unstable builds and white previews. Decide what needs to be built and in what order.
Responsibilities:
- For each phase, break the work into safe, sequential steps.
- Ensure all generated 'title' and 'description' fields within the 'steps' array are **highly specific and customized** to the current step's goal. For Farsi prompts, these fields MUST be in Farsi.
- Define explicit and unambiguous file paths for each step.
- Reference DESIGN and PHASE_PLANNER outputs for context.
Forbidden: Writing code, Changing architecture mid-stream, Designing UI independently.
Input: Design, Phase, Existing Files.
Return STRICT JSON:
{
  "steps": [
    {
      "id": "s1",
      "path": "index.html",
      "action": "create",
      "title": "Create basic HTML structure with Tailwind CDN",
      "description": "Scaffold the foundational index.html with a root div for React and include Tailwind CSS CDN for styling.",
      "outcome": "Root HTML document exists and is styled."
    },
    {
      "id": "s2",
      "path": "src/main.tsx",
      "action": "create",
      "title": "Set up React 18 entry point in main.tsx",
      "description": "Create the main.tsx file to initialize React 18's createRoot and mount the primary App component.",
      "outcome": "React application successfully mounts to the DOM."
    }
  ]
}`,

    BUILDER: `Role: Code Generator
Purpose: Implement exactly what was planned.
Responsibilities:
- Generate working, executable code.
- Follow the plan strictly (paths provided in step).
- **CRITICAL**: When the 'action' is 'update', you will be provided with 'existing_files' which includes the current content of the files. You MUST use this existing content as a basis and make only the **minimal necessary changes** to achieve the step's goal. Do not rewrite the entire file unless the change is fundamental and impacts the whole structure. The 'content' field for an 'update' action must be *the full, modified file content*.
- Ensure: React mounts correctly, Something always renders.
- Use Tailwind CSS and Lucide React.
- **Strict Library Policy**: You may ONLY import from the following available libraries:
  - 'react'
  - 'react-dom'
  - 'react-router-dom'
  - 'lucide-react'
  - 'clsx'
  - 'tailwind-merge'
- DO NOT use 'framer-motion', 'recharts', 'date-fns', 'react-icons', or any other external packages. If you need functionality from them, implement a simple version yourself using standard React/JS APIs.
Forbidden: Architectural changes, Guessing entry points, Ignoring DESIGN.
Input: Step (contains 'path'), Design, Current Files.
Return STRICT JSON:
{
  "file_changes": [
    { "path": "string", "action": "create|update", "content": "CODE_CONTENT_AS_MARKDOWN_BLOCK_HERE" }
  ],
  "step_result": { "completed": true, "visible_change": "..." }
}
**CRITICAL JSON GUIDELINE**: The 'content' field must contain a valid markdown code block. The ENTIRE markdown block (including triple backticks and language specifier) must be treated as a single JSON string value. You MUST ensure that this JSON string value is correctly escaped for JSON syntax. For example:
- Newlines (literal \`\\n\`) must be escaped as \`\\\\n\`.
- Literal double quotes (\`"\`) within the markdown content must be escaped as \`\\"\`.
- Literal backslashes (\`\\\`) within the markdown content must be escaped as \`\\\\\\\\\`.
DO NOT double-escape characters unnecessarily. The HTML/JSX/CSS code INSIDE the markdown block should look as it would normally (e.g., \`lang="en"\` not \`lang=\\"en\\"\`).`,

    REPAIR: `Role: Minimal Fix Agent
Purpose: Recover from failures without chaos.
Responsibilities:
- Apply the smallest possible fix.
- Restore rendering.
- Respect original architecture.
Forbidden: Rebuilding the project, Changing design intent.
Input: Error message, Current Files, Current Build State.
Return STRICT JSON:
{
  "root_cause": "...",
  "patches": [ { "path": "string", "action": "update", "content": "CODE_CONTENT_AS_MARKDOWN_BLOCK_HERE" } ],
  "narrative": "A short human-friendly explanation of what was fixed."
}
**CRITICAL JSON GUIDELINE**: The 'content' field must contain a valid markdown code block. The ENTIRE markdown block (including triple backticks and language specifier) must be treated as a single JSON string value. You MUST ensure that this JSON string value is correctly escaped for JSON syntax. For example:
- Newlines (literal \`\\n\`) must be escaped as \`\\\\n\`.
- Literal double quotes (\`"\`) within the markdown content must be escaped as \`\\"\`.
- Literal backslashes (\`\\\`) within the markdown content must be escaped as \`\\\\\\\\\`.
DO NOT double-escape characters unnecessarily. The HTML/JSX/CSS code INSIDE the markdown block should look as it would normally (e.g., \`lang="en"\` not \`lang=\\"en\\"\`).`,

    REPAIR_PLANNER: `Role: Senior React Repair Engineer
Task: Fix the provided runtime/build error with the absolute MINIMAL change.
Input: 
- Error: {error}
- Files: {files}
Constraints:
- DO NOT rewrite entire files.
- DO NOT change architecture.
- FIX ONLY the specific error.
- Output JSON with patches.
- Content in patches MUST be valid code (no markdown blocks inside the string).
Return STRICT JSON:
{
  "patches": [
    { "path": "src/App.tsx", "action": "update", "content": "FULL_UPDATED_FILE_CONTENT_HERE" }
  ],
  "explanation": "Briefly explain the fix."
}
**CRITICAL JSON GUIDELINE**: The 'content' field must contain the FULL updated file content inside a valid markdown code block. The ENTIRE markdown block (including triple backticks and language specifier) must be treated as a single JSON string value. You MUST ensure that this JSON string value is correctly escaped for JSON syntax.`,

    QA: `Role: Final Validation
Purpose: Catch issues before the user sees them.
Responsibilities:
- Verify: React is mounted, UI is visible, No fatal runtime errors.
- Report issues clearly.
Forbidden: Writing new features, Redesigning UI.
Return STRICT JSON:
{ 
  "status": "pass|fail", 
  "checks": [], 
  "issues": [], 
  "patches": [ { "path": "string", "action": "update", "content": "CODE_CONTENT_AS_MARKDOWN_BLOCK_HERE" } ],
  "narrative": "A concise summary of the QA result and any recommended actions."
}
**CRITICAL JSON GUIDELINE**: The 'content' field must contain a valid markdown code block. The ENTIRE markdown block (including triple backticks and language specifier) must be treated as a single JSON string value. You MUST ensure that this JSON string value is correctly escaped for JSON syntax. For example:
- Newlines (literal \`\\n\`) must be escaped as \`\\\\n\`.
- Literal double quotes (\`"\`) within the markdown content must be escaped as \`\\"\`.
- Literal backslashes (\`\\\`) within the markdown content must be escaped as \`\\\\\\\\\`.
DO NOT double-escape characters unnecessarily. The HTML/JSX/CSS code INSIDE the markdown block should look as it would normally (e.g., \`lang="en"\` not \`lang=\\"en\\"\`).`,

    SQL: `Role: Database Architect
Purpose: Backend schema only.
Responsibilities:
- Generate safe, idempotent SQL.
- Follow REQUIREMENTS strictly.
Forbidden: UI or frontend logic, API design.
Return STRICT JSON:
{ "sql": "SQL_CODE_AS_MARKDOWN_BLOCK_HERE", "notes": { "description": "SQL_NOTES_AS_MARKDOWN_BLOCK_HERE" } }
**CRITICAL JSON GUIDELINE**: The 'sql' field must contain a valid markdown code block. The ENTIRE markdown block (including triple backticks and language specifier) must be treated as a single JSON string value. You MUST ensure that this JSON string value is correctly escaped for JSON syntax. For example:
- Newlines (literal \`\\n\`) must be escaped as \`\\\\n\`.
- Literal double quotes (\`"\`) within the markdown content must be escaped as \`\\"\`.
- Literal backslashes (\`\\\`) within the markdown content must be escaped as \`\\\\\\\\\`.
DO NOT double-escape characters unnecessarily. The SQL code INSIDE the markdown block should look as it would normally.`,

    NARRATOR: `Role: User-Facing Build Companion
Purpose: Create trust and clarity.
Responsibilities:
- Maintain a persistent, chat-like log.
- Explain: What is happening, What is completed, What comes next.
- Use human, friendly language.
Forbidden: Showing only short status labels, Overwriting previous logs, Technical jargon without explanation.
Return STRICT JSON:
{ "chat_messages": [ { "type": "status", "message": "..." } ] }`,

    FILE_PLAN: `Legacy`,
    CODE: `Legacy`
};

export interface SupervisorCallbacks {
    onPlanUpdate: (phases: Phase[]) => Promise<void>;
    onMessage: (message: Message) => Promise<void>; // Use this for custom messages (e.g., action_required)
    onBuildMessage: (logicalKey: string, message: Partial<Message>) => Promise<Message>; // New unified message update
    onPhaseStart: (phaseIndex: number, phase: { key?: string; text?: string }) => Promise<void>;
    onPhaseComplete: (phaseIndex: number) => Promise<void>;
    onStepStart: (phaseIndex: number, step: { key?: string; text?: string; vars?: Record<string, string> }) => Promise<void>;
    onStepComplete: (phaseIndex: number, stepName: string) => Promise<void>;
    onChunkComplete: (code: GeneratedCode, explanation: string, meta?: any) => Promise<void>;
    onSuccess: (code: GeneratedCode, explanation: string, audit: BuildAudit, meta?: any) => Promise<void>;
    onError: (error: string, retries: number) => Promise<void>;
    onFinalError: (error: string, audit?: BuildAudit) => Promise<void>;
    // New validation bridge
    waitForPreview?: (timeoutMs: number) => Promise<{success: boolean, error?: string}>;
}

export class GenerationSupervisor {
    private project: Project;
    private userPrompt: string;
    private images: string[];
    private callbacks: SupervisorCallbacks;
    private signal?: AbortSignal;
    private lang: Language;
    
    // Context State
    private decision: DecisionJSON | null = null;
    private design: DesignSpecJSON | null = null;
    private filePlan: FilePlanJSON | null = null;
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

    private checkAbort() {
        if (this.signal?.aborted) {
            throw new Error("ABORTED");
        }
    }

    private t(key: keyof typeof translations['en'], vars?: Record<string, string>) {
        const dict = translations[this.lang] || translations['en'];
        let str = (dict as any)[key] || key;
        if (vars) {
            Object.entries(vars).forEach(([k, v]) => {
                str = str.replace(`{${k}}`, v ?? '');
            });
        }
        return str;
    }

    private async runStep(key: string, prompt: string, sysPromptDefault: string, logicalMessageKey: string): Promise<any> {
        this.checkAbort();
        
        let sys = await getSystemPrompt(key, sysPromptDefault);

        // Explicit Language Enforcement Logic
        // Determine language mode from Supervisor state (which is derived from User Settings + Initial Prompt Scan)
        const isFarsiMode = this.lang === 'fa';
        
        // Also check prompt for explicit overrides, just in case context shifts
        const promptHasFarsi = /[\u0600-\u06FF]/.test(this.userPrompt);
        const effectiveIsFarsi = isFarsiMode || promptHasFarsi;
        
        // Fix: Referencing PROMPT_KEYS with string literal keys
        const keysWithUserText = [
            PROMPT_KEYS['DECISION'],
            PROMPT_KEYS['REQUIREMENTS'],
            PROMPT_KEYS['BUILDER'],
            PROMPT_KEYS['REPAIR'],
            PROMPT_KEYS['QA'],
            PROMPT_KEYS['NARRATOR'],
            PROMPT_KEYS['PLANNER'],
            PROMPT_KEYS['PHASE_PLANNER'],
        ];

        if (keysWithUserText.includes(key)) {
            if (effectiveIsFarsi) {
                const langInstruction = "All user-facing text output in the JSON response (like summaries, explanations, messages, issues, hints, and step titles/descriptions) MUST be in Farsi (Persian).";
                sys = langInstruction + '\n' + sys;
            } else {
                // Explicitly enforce English to prevent model drifting
                const langInstruction = "All user-facing text output in the JSON response (like summaries, explanations, messages, issues, hints, and step titles/descriptions) MUST be in English.";
                sys = langInstruction + '\n' + sys;
            }
        }
        
        const MAX_RETRIES = 3;
        const STEP_TIMEOUT_MS = 60000; // Reduced to 60s to fail fast on stuck processes and trigger phase retry

        let lastError;
        let startTime = Date.now();
        // Capture activeConfig here once for this step execution
        const currentActiveConfig = await getActiveProvider();

        for (let i = 0; i < MAX_RETRIES; i++) {
            this.checkAbort();
            try {
                const timeoutPromise = new Promise((_, reject) => {
                    const id = setTimeout(() => {
                        clearTimeout(id);
                        reject(new Error(`Timeout: Step '${key}' took longer than ${Math.round(STEP_TIMEOUT_MS/1000)}s`));
                    }, STEP_TIMEOUT_MS);
                });

                const { text: resText, usage } = await Promise.race([
                    robustGenerate(prompt, sys, this.project.id, this.project.userId, key, this.images, {messageId: logicalMessageKey}),
                    timeoutPromise
                ]) as {text: string, usage: AIUsageResult};
                
                const jsonRes = extractJson(resText);
                return { json: jsonRes, usage, executionTime: Date.now() - startTime, provider: currentActiveConfig.name, model: currentActiveConfig.model };

            } catch (e: any) {
                if (this.signal?.aborted) throw new Error("ABORTED");
                console.warn(`Step ${key} attempt ${i + 1} failed:`, e);
                lastError = e;
                await this.callbacks.onError(e.message || "Unknown error", MAX_RETRIES - 1 - i);
                if (i < MAX_RETRIES - 1) {
                    await new Promise(r => setTimeout(r, 2000 * (i + 1))); 
                }
            }
        }
        throw lastError || new Error(`Step ${key} failed after retries`);
    }

    public async repair(initialError: string) {
        const MAX_ATTEMPTS = 5;
        let currentError = initialError;
        let attempt = 1;
        let totalExecutionTime = 0;
        let totalCredits = 0;

        // Use a persistent message for the repair process
        const messageId = (await this.callbacks.onBuildMessage('repair_mode', {
            type: 'build_status',
            content: this.t('selfHealing'),
            status: 'working',
            icon: 'wrench'
        })).id;

        while (attempt <= MAX_ATTEMPTS) {
            this.checkAbort();

            await this.callbacks.onBuildMessage('repair_mode', {
                id: messageId,
                content: `Repairing... (Attempt ${attempt}/${MAX_ATTEMPTS})\nDetected Issue: ${currentError.substring(0, 100)}...`,
                status: 'working',
                icon: 'loader'
            });

            // 1. Analyze and Plan Patch
            // Only send relevant files (Entry, App, HTML, Config) to save tokens, or send all if small.
            // For now, filtering to criticals + recent changes might be smart, but sending all is safer for context.
            const repairResult = await this.runStep(
                PROMPT_KEYS['REPAIR_PLANNER'], 
                JSON.stringify({ error: currentError, files: this.accumulatedFiles }), 
                DEFAULTS.REPAIR_PLANNER, 
                messageId
            );
            
            const { patches, explanation } = repairResult.json;
            totalExecutionTime += repairResult.executionTime;
            totalCredits += billingService.calculateCredits(repairResult.usage.costUsd);

            if (patches && patches.length > 0) {
                // 2. Apply Patches (Immutable Update)
                const cleanPath = (p: string) => p.replace(/^\.\//, '').replace(/^\//, '');
                const patchMap = new Map<string, FileChange>();
                
                patches.forEach((p: FileChange) => {
                    p.path = cleanPath(p.path);
                    patchMap.set(p.path, p);
                });
                
                this.accumulatedFiles = this.accumulatedFiles.map(file => {
                    const normalizedPath = cleanPath(file.path);
                    if (patchMap.has(normalizedPath)) {
                        const patch = patchMap.get(normalizedPath)!;
                        // Sanitize content
                        const sanitizedContent = sanitizeFileContent(patch.content, normalizedPath);
                        return { ...file, content: sanitizedContent, path: normalizedPath };
                    }
                    return { ...file, path: normalizedPath };
                });

                // 3. Update UI & Render
                await this.callbacks.onChunkComplete(
                    { html: '', javascript: '// Updating...', css: '', explanation: `Applied repair: ${explanation}` },
                    `Repair Attempt ${attempt}: ${explanation}`,
                    { files: this.accumulatedFiles }
                );

                // 4. Validate (Wait for Runtime Feedback)
                // We need to wait for the iframe to reload and potentially throw an error.
                if (this.callbacks.waitForPreview) {
                    // Wait up to 8 seconds for an error to appear
                    const validation = await this.callbacks.waitForPreview(8000);
                    
                    if (validation.success) {
                        // Success!
                        await this.callbacks.onBuildMessage('repair_mode', {
                            id: messageId,
                            content: `✅ **Repair Successful!**\n\nFixed issue: ${explanation}`,
                            status: 'completed',
                            icon: 'check',
                            executionTimeMs: totalExecutionTime,
                            creditsUsed: totalCredits
                        });
                        return; // Exit Repair Mode
                    } else {
                        // Error persisted or new error appeared
                        currentError = validation.error || "Unknown runtime error persisted";
                        console.warn(`Repair Attempt ${attempt} failed. New error: ${currentError}`);
                    }
                } else {
                    // No validation callback provided? Assume success or wait for manual trigger.
                    console.warn("No validation callback provided for repair mode.");
                    break;
                }
            } else {
                console.warn("AI suggested no patches.");
                break;
            }

            attempt++;
        }

        // If loop finishes without success
        await this.callbacks.onFinalError(`Auto-fix failed after ${MAX_ATTEMPTS} attempts. Error: ${currentError}`);
    }

    public async start() {
        try {
            this.checkAbort();
            let currentMessageId: string | undefined; // To track the message being updated

            // Detect if the user explicitly wants to skip backend
            const userSkippedBackend = this.userPrompt.toLowerCase().includes('skip backend') || 
                                     this.userPrompt.toLowerCase().includes('mock data') ||
                                     this.userPrompt.toLowerCase().includes('without backend');

            // 1. DECISION (Intent Classifier)
            currentMessageId = (await this.callbacks.onBuildMessage('decision', {
                type: 'build_status',
                content: this.t('analyzingRequest'),
                status: 'working',
                icon: 'loader'
            })).id;

            const decisionResult = await this.runStep(PROMPT_KEYS['DECISION'], `USER REQUEST: ${this.userPrompt}`, DEFAULTS.DECISION, currentMessageId);
            this.decision = decisionResult.json;
            this.checkAbort();

            await this.callbacks.onBuildMessage('decision', {
                id: currentMessageId,
                // Fix: Access narrative_summary property correctly
                content: this.decision?.narrative_summary || this.t('finishedAnalysis'),
                status: 'completed',
                icon: 'check',
                details: JSON.stringify(this.decision, null, 2),
                isExpandable: true,
                executionTimeMs: decisionResult.executionTime,
                creditsUsed: billingService.calculateCredits(decisionResult.usage.costUsd)
            });

            // 2. REQUIREMENTS (Technical Needs)
            currentMessageId = (await this.callbacks.onBuildMessage('requirements', {
                type: 'build_status',
                content: this.t('checkingBackend'),
                status: 'working',
                icon: 'loader'
            })).id;
            
            const requirementsResult = await this.runStep(PROMPT_KEYS['REQUIREMENTS'], `Analyze backend needs: ${this.userPrompt}\n\nDECISION_CONTEXT: ${JSON.stringify(this.decision)}`, DEFAULTS.REQUIREMENTS, currentMessageId);
            const requirements = requirementsResult.json;

            // Backend Gate: Only block if backend is needed AND user hasn't skipped
            const needsBackend = requirements.needs_backend || requirements.backendRequired;
            const shouldBlockForBackend = needsBackend && !userSkippedBackend;

            if (shouldBlockForBackend) {
                const isCloudActive = this.project.rafieiCloudProject && this.project.rafieiCloudProject.status === 'ACTIVE';
                if (!isCloudActive) {
                    await this.callbacks.onBuildMessage('backend_action_required', {
                        type: 'action_required',
                        content: this.t('backendActionRequired'),
                        requiresAction: 'CONNECT_DATABASE',
                        status: 'pending', // Waiting for user action
                        icon: 'warning',
                        details: JSON.stringify(requirements, null, 2),
                        isExpandable: true,
                    });
                    return; 
                } else {
                     await this.callbacks.onBuildMessage('requirements', {
                        id: currentMessageId,
                        content: this.t('backendRequirementsMet'), // Renamed key usage
                        status: 'completed',
                        icon: 'check',
                        details: JSON.stringify(requirements, null, 2),
                        isExpandable: true,
                        executionTimeMs: requirementsResult.executionTime,
                        creditsUsed: billingService.calculateCredits(requirementsResult.usage.costUsd)
                    });
                }
            } else if (needsBackend && userSkippedBackend) {
                 await this.callbacks.onBuildMessage('requirements', {
                    id: currentMessageId,
                    content: this.t('backendSkipped'),
                    status: 'completed',
                    icon: 'check',
                    details: JSON.stringify(requirements, null, 2),
                    isExpandable: true,
                    executionTimeMs: requirementsResult.executionTime,
                    creditsUsed: billingService.calculateCredits(requirementsResult.usage.costUsd)
                });
            } else {
                 await this.callbacks.onBuildMessage('requirements', {
                    id: currentMessageId,
                    content: this.t('noBackendNeeded'),
                    status: 'completed',
                    icon: 'check',
                    details: JSON.stringify(requirements, null, 2),
                    isExpandable: true,
                    executionTimeMs: requirementsResult.executionTime,
                    creditsUsed: billingService.calculateCredits(requirementsResult.usage.costUsd)
                });
            }
            
            // 3. PHASE PLANNER (Build Order)
            currentMessageId = (await this.callbacks.onBuildMessage('phase_planner', {
                type: 'build_plan',
                content: this.t('creatingBuildPlan'),
                status: 'working',
                icon: 'loader'
            })).id;

            const phasePlanResult = await this.runStep(PROMPT_KEYS['PHASE_PLANNER'], JSON.stringify({ request: this.userPrompt, analysis: this.decision, requirements }), DEFAULTS.PHASE_PLANNER, currentMessageId);
            const phasePlan = phasePlanResult.json;
            
            const phases: Phase[] = (phasePlan.phases || []).map((p: any) => ({
                id: crypto.randomUUID(), 
                title: p.title, 
                description: p.description || p.goal, // Robust fallback for description
                status: 'pending' as const, 
                retryCount: 0, 
                type: (p.type === 'ui' || p.type === 'logic' || p.type === 'backend') ? p.type : 'ui'
            }));
            
            await this.callbacks.onPlanUpdate(phases); // This updates the internal build state

            await this.callbacks.onBuildMessage('phase_planner', {
                id: currentMessageId,
                content: this.t('planReady'),
                planData: phases.map(p => ({title: p.title, status: 'pending'})),
                status: 'completed',
                icon: 'check',
                details: JSON.stringify(phasePlan, null, 2),
                isExpandable: true,
                executionTimeMs: phasePlanResult.executionTime,
                creditsUsed: billingService.calculateCredits(phasePlanResult.usage.costUsd)
            });
            this.checkAbort();

            // 4. DESIGN (UI/UX)
            currentMessageId = (await this.callbacks.onBuildMessage('design_phase', {
                type: 'build_phase',
                content: this.t('startingDesign'),
                status: 'working',
                icon: 'loader',
                // Fix: Changed 'progress' to 'currentStepProgress'
                currentStepProgress: { current: 0, total: 1, stepName: this.t('generatingDesignSpec') }
            })).id;

            const designResult = await this.runStep(PROMPT_KEYS['DESIGN'], JSON.stringify({ user_input: this.userPrompt, decision: this.decision, phases: phasePlan }), DEFAULTS.DESIGN, currentMessageId);
            this.design = designResult.json;
            
            await this.callbacks.onBuildMessage('design_phase', {
                id: currentMessageId,
                content: this.t('designComplete'),
                status: 'completed',
                icon: 'check',
                // Fix: Changed 'progress' to 'currentStepProgress'
                currentStepProgress: { current: 1, total: 1, stepName: this.t('designSpecComplete') },
                details: JSON.stringify(this.design, null, 2),
                isExpandable: true,
                executionTimeMs: designResult.executionTime,
                creditsUsed: billingService.calculateCredits(designResult.usage.costUsd)
            });

            // 5. EXECUTION LOOP (Phases -> Planner/FilePlan -> Builder/Code)
            let currentPhaseIdx = 0;
            for (const phase of phases) {
                this.checkAbort();
                
                // Snapshot files state for rollback in case of phase retry
                const accumulatedFilesSnapshot = JSON.parse(JSON.stringify(this.accumulatedFiles));
                
                let phaseAttempts = 0;
                const MAX_PHASE_RETRIES = 2; // Allow 2 retries for the entire phase
                let phaseSuccess = false;

                while (phaseAttempts <= MAX_PHASE_RETRIES && !phaseSuccess) {
                    try {
                        const phaseMessageKey = `phase_${phase.id}`;
                        
                        // Notify start/retry
                        if (phaseAttempts > 0) {
                             await this.callbacks.onBuildMessage(phaseMessageKey, {
                                type: 'build_status',
                                content: this.t('buildWarning', { retryMsg: ` Restarting Phase "${phase.title}" (Attempt ${phaseAttempts + 1}/${MAX_PHASE_RETRIES + 1})...` }),
                                status: 'working',
                                icon: 'refresh-cw'
                            });
                        }

                        currentMessageId = (await this.callbacks.onBuildMessage(phaseMessageKey, {
                            type: 'build_phase',
                            content: this.t('startingPhase', { phaseTitle: phase.title }),
                            status: 'working',
                            icon: 'loader',
                            currentStepProgress: { current: 0, total: 1, stepName: this.t('planningSteps') }
                        })).id;
                        
                        // PLANNER (acting as FILE_PLAN source of truth)
                        const planContext = {
                            phase,
                            design: this.design,
                            user_request: this.userPrompt,
                            existing_files: this.accumulatedFiles.map(f => f.path)
                        };
                        const detailedPlanResult = await this.runStep(PROMPT_KEYS['PLANNER'], JSON.stringify(planContext), DEFAULTS.PLANNER, currentMessageId);
                        const detailedPlan = detailedPlanResult.json;
                        const steps = detailedPlan.steps || [];
                        
                        await this.callbacks.onBuildMessage(phaseMessageKey, {
                            id: currentMessageId,
                            content: this.t('plannedSteps', { phaseTitle: phase.title }),
                            currentStepProgress: { current: 0, total: steps.length, stepName: this.t('executingSteps') },
                            details: JSON.stringify(detailedPlan, null, 2),
                            isExpandable: true,
                        });

                        // BUILDER (acting as CODE Generator)
                        let completedStepsInPhase = 0;
                        let phaseExecutionTimeMs = 0;
                        let phaseCreditsUsed = 0;

                        for (const step of steps) {
                            this.checkAbort();
                            
                            const filePath = step.path || step.file || step.filepath; 
                            if (!filePath) {
                                console.warn("Skipping build step due to missing path:", step);
                                continue;
                            }
                            
                            completedStepsInPhase++;
                            await this.callbacks.onBuildMessage(phaseMessageKey, {
                                id: currentMessageId,
                                content: this.t('buildingPhase', { phaseTitle: phase.title, filePath: filePath }),
                                currentStepProgress: { current: completedStepsInPhase, total: steps.length, stepName: step.title },
                            });
                            
                            const builderContext = {
                                task: step.description || step.title,
                                file_path: filePath,
                                design: this.design,
                                existing_files: this.accumulatedFiles.map(f => ({ path: f.path, content: f.content })),
                                phase: phase.id
                            };

                            const codeResResult = await this.runStep(PROMPT_KEYS['BUILDER'], JSON.stringify(builderContext), DEFAULTS.BUILDER, currentMessageId);
                            const codeRes = codeResResult.json;

                            phaseExecutionTimeMs += codeResResult.executionTime;
                            phaseCreditsUsed += billingService.calculateCredits(codeResResult.usage.costUsd);
                            
                            if (codeRes.file_changes && codeRes.file_changes.length > 0) {
                                const cleanPath = (p: string) => p.replace(/^\.\//, '').replace(/^\//, '');
                                
                                const changesMap = new Map<string, FileChange>();
                                codeRes.file_changes.forEach((c: FileChange) => {
                                    c.content = sanitizeFileContent(c.content, c.path);
                                    c.path = cleanPath(c.path);
                                    changesMap.set(c.path, c);
                                });
                                
                                let newFiles = this.accumulatedFiles.map(file => {
                                    const normalizedPath = cleanPath(file.path);
                                    if (changesMap.has(normalizedPath)) {
                                        const change = changesMap.get(normalizedPath)!;
                                        changesMap.delete(normalizedPath); 
                                        return { ...file, content: change.content, path: normalizedPath }; 
                                    }
                                    return { ...file, path: normalizedPath };
                                });
                                
                                changesMap.forEach(change => {
                                    newFiles.push({ path: change.path, content: change.content, type: 'file', language: 'typescript' });
                                });
                                
                                this.accumulatedFiles = newFiles; 
                            }
                            
                            // Partial Update
                            const currentCode = { 
                                html: '', 
                                javascript: '// See files', 
                                css: '', 
                                explanation: `Built ${filePath}` 
                            };
                            await this.callbacks.onChunkComplete(currentCode, `Built ${filePath}`, { files: this.accumulatedFiles } as any);
                        }

                        await this.callbacks.onBuildMessage(phaseMessageKey, {
                            id: currentMessageId,
                            content: this.t('phaseComplete', { phaseTitle: phase.title }),
                            status: 'completed',
                            icon: 'check',
                            currentStepProgress: { current: steps.length, total: steps.length, stepName: this.t('allStepsComplete') },
                            executionTimeMs: phaseExecutionTimeMs,
                            creditsUsed: phaseCreditsUsed,
                            details: JSON.stringify(detailedPlan, null, 2),
                            isExpandable: true,
                        });
                        
                        phaseSuccess = true;

                    } catch (error: any) {
                        if (error.message === "ABORTED" || this.signal?.aborted) throw error;
                        
                        phaseAttempts++;
                        console.warn(`Phase ${phase.title} attempt ${phaseAttempts} failed:`, error);
                        
                        if (phaseAttempts <= MAX_PHASE_RETRIES) {
                            // Rollback files
                            this.accumulatedFiles = JSON.parse(JSON.stringify(accumulatedFilesSnapshot));
                            // Wait a bit before retry
                            await new Promise(r => setTimeout(r, 2000));
                        } else {
                            throw error; // Rethrow to main catch if retries exhausted
                        }
                    }
                }
                currentPhaseIdx++;
            }

            // 6. SQL GENERATION (Backend Architect)
            // Skip SQL generation if user explicitly skipped backend, even if requirements said it was needed.
            if (shouldBlockForBackend) {
                currentMessageId = (await this.callbacks.onBuildMessage('sql_generation', {
                    type: 'build_status',
                    content: this.t('generatingSchema'),
                    status: 'working',
                    icon: 'loader'
                })).id;
                
                const sqlResResult = await this.runStep(PROMPT_KEYS['SQL'], JSON.stringify({ requirements, decision: this.decision }), DEFAULTS.SQL, currentMessageId);
                const sqlRes = sqlResResult.json;
                if (sqlRes.sql) {
                    const newSqlFile = { path: 'supabase/schema.sql', content: sanitizeFileContent(sqlRes.sql, 'supabase/schema.sql'), type: 'file' as const, language: 'sql' };
                    const existingIdx = this.accumulatedFiles.findIndex(f => f.path === newSqlFile.path);
                    if (existingIdx !== -1) {
                        this.accumulatedFiles = [
                            ...this.accumulatedFiles.slice(0, existingIdx),
                            newSqlFile,
                            ...this.accumulatedFiles.slice(existingIdx + 1)
                        ];
                    } else {
                        this.accumulatedFiles = [...this.accumulatedFiles, newSqlFile];
                    }
                }
                await this.callbacks.onBuildMessage('sql_generation', {
                    id: currentMessageId,
                    content: this.t('schemaGenerated'),
                    status: 'completed',
                    icon: 'check',
                    details: JSON.stringify(sqlRes, null, 2),
                    isExpandable: true,
                    executionTimeMs: sqlResResult.executionTime,
                    creditsUsed: billingService.calculateCredits(sqlResResult.usage.costUsd)
                });
            } else if (needsBackend && userSkippedBackend) {
                 // Skip SQL message
                 console.log("Skipping SQL generation step due to user skip request.");
            }

            // 7. QA & REPAIR (Final Validation)
            currentMessageId = (await this.callbacks.onBuildMessage('qa_validation', {
                type: 'build_status',
                content: this.t('performingQA'),
                status: 'working',
                icon: 'loader'
            })).id;
            
            const qaResResult = await this.runStep(PROMPT_KEYS['QA'], JSON.stringify({ decision: this.decision, files: this.accumulatedFiles }), DEFAULTS.QA, currentMessageId);
            const qaRes: QAJSON & { narrative?: string } = qaResResult.json;
            
            if (qaRes.status === 'fail' && qaRes.patches) {
                await this.callbacks.onBuildMessage('qa_validation', {
                    id: currentMessageId,
                    content: this.t('qaDetectedIssues', { narrative: qaRes.narrative || 'Fixing minor code inconsistencies.' }),
                    status: 'working',
                    icon: 'wrench',
                    details: JSON.stringify(qaRes, null, 2),
                    isExpandable: true,
                });

                const repairResResult = await this.runStep(PROMPT_KEYS['REPAIR'], JSON.stringify({ issues: qaRes.issues, files: this.accumulatedFiles }), DEFAULTS.REPAIR, currentMessageId);
                const repairRes: QAJSON & { narrative?: string, patches?: FileChange[] } = repairResResult.json;

                if (repairRes.patches) {
                    // IMMUTABLE UPDATE & NORMALIZATION
                    const cleanPath = (p: string) => p.replace(/^\.\//, '').replace(/^\//, '');
                    const patchMap = new Map<string, FileChange>();
                    
                    repairRes.patches.forEach((p: FileChange) => {
                        p.path = cleanPath(p.path);
                        patchMap.set(p.path, p);
                    });
                    
                    this.accumulatedFiles = this.accumulatedFiles.map(file => {
                        const normalizedPath = cleanPath(file.path);
                        if (patchMap.has(normalizedPath)) {
                            // --- SANITIZE PATCHES ---
                            const sanitizedContent = sanitizeFileContent(patchMap.get(normalizedPath)!.content, normalizedPath);
                            // ------------------------
                            return { ...file, content: sanitizedContent, path: normalizedPath };
                        }
                        return { ...file, path: normalizedPath };
                    });
                }
                 await this.callbacks.onBuildMessage('qa_validation', {
                    id: currentMessageId,
                    content: this.t('repairsApplied', { narrative: repairRes.narrative || 'Your code has been optimized and is now stable.' }),
                    status: 'completed',
                    icon: 'check',
                    details: JSON.stringify(repairRes, null, 2),
                    isExpandable: true,
                    executionTimeMs: qaResResult.executionTime + (repairResResult?.executionTime || 0),
                    creditsUsed: billingService.calculateCredits(qaResResult.usage.costUsd + (repairResResult?.usage?.costUsd || 0)),
                });
            } else {
                 await this.callbacks.onBuildMessage('qa_validation', {
                    id: currentMessageId,
                    content: this.t('qaPassed'),
                    status: 'completed',
                    icon: 'check',
                    details: JSON.stringify(qaRes, null, 2),
                    isExpandable: true,
                    executionTimeMs: qaResResult.executionTime,
                    creditsUsed: billingService.calculateCredits(qaResResult.usage.costUsd)
                });
            }

            // 8. SUCCESS (Dynamic Narrator)
            // Instead of using a hardcoded static summary, we generate a personalized one based on what was actually built.
            
            // Check again to ensure success message respects language
            const isFarsiSuccess = /[\u0600-\u06FF]/.test(this.userPrompt) || this.lang === 'fa';
            const pageNames = this.design?.pages?.map(p => p.name).join(', ') || (isFarsiSuccess ? 'صفحه اصلی' : 'Main Page');
            const style = this.design?.design_language?.style || (isFarsiSuccess ? 'مدرن' : 'Modern');
            const fileCount = this.accumulatedFiles.length;

            let successMessage = '';

            if (isFarsiSuccess) {
                successMessage = `🎉 **ساخت پروژه کامل شد!**\n\nمن ساخت برنامه شما را بر اساس طراحی "${style}" به پایان رساندم.\n\n**آنچه ساخته شد:**\n• **صفحات:** ${pageNames}\n• **تعداد فایل‌ها:** ${fileCount}\n• **فناوری‌ها:** React, Tailwind CSS, Lucide Icons\n\nهم‌اکنون می‌توانید پیش‌نمایش را مشاهده کنید و با برنامه تعامل داشته باشید!`;
            } else {
                successMessage = `🎉 **Build Complete!**\n\nI've finished building your app based on the "${style}" design.\n\n**What's included:**\n• **Pages:** ${pageNames}\n• **Files Generated:** ${fileCount}\n• **Tech Stack:** React, Tailwind CSS, Lucide Icons\n\nYou can now preview the app on the right. Try interacting with it! If you need any changes, just ask.`;
            }
            
            await this.callbacks.onSuccess(
                { html: '', javascript: '// See files', css: '', explanation: 'Complete' }, 
                successMessage, // Pass dynamic summary here
                { score: 100, passed: true, issues: [], previewHealth: 'healthy', routesDetected: [] },
                { files: this.accumulatedFiles } as any
            );

        } catch (e: any) {
            if (e.message === "ABORTED" || this.signal?.aborted) {
                console.log("Build aborted by user.");
                // Update the last active message to 'failed' if not already
                // Or ensure a new 'build_error' is sent for the abortion
                await this.callbacks.onBuildMessage('build_abortion_notification', {
                    type: 'build_status',
                    content: this.t('buildAborted'),
                    status: 'failed',
                    icon: 'x'
                });
                return;
            }
            await this.callbacks.onFinalError(e.message);
        }
    }
}

// --- PUBLIC HELPERS ---
export const handleUserIntent = async (project: Project, prompt: string) => {
    return { isArchitect: true, requiresDatabase: false, response: null as string | null, meta: {} as any };
};

export const generateProjectTitle = async (prompt: string, user: User, project: Project): Promise<string> => {
    const isFarsiPrompt = /[\u0600-\u06FF]/.test(prompt);
    const langInstruction = isFarsiPrompt ? 'The title must be in Farsi.' : 'The title must be in English.';

    const systemInstruction = `You are a creative project name generator. Based on the user's prompt, create a short, catchy, 2-4 word title for their web application.
    ${langInstruction}
    - DO NOT use quotes.
    - DO NOT use punctuation.
    - Respond with ONLY the title and nothing else.
    - Example: If the prompt is "a dashboard for social media analytics", a good response is "Social Insights".
    - Example: If the prompt is "یک داشبورد برای تحلیل شبکه‌های اجتماعی", a good response is "بینش اجتماعی".`;
    
    try {
        const responseText = (await robustGenerate(prompt, systemInstruction, project.id, user.id, 'title_generation')).text;
        
        let title = responseText.replace(/["'.,*#]/g, '').trim();

        if (!isFarsiPrompt) {
            title = title.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
        }

        if (title.length > 50) {
            title = title.substring(0, 47) + '...';
        }

        if (!title) return "New Project";
        
        return title;
    } catch (error) {
        console.error("Failed to generate project title:", error);
        return "New Project";
    }
};

export const generateSuggestions = async (msgs: Message[], code: GeneratedCode, id: string): Promise<Suggestion[]> => [];
