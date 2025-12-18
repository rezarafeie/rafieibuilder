import { AIUsageResult } from "../types";

// --- COPIED FROM GEMINI SERVICE (Synchronization) ---

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

// --- ROBUST JSON PARSING ENGINE (Ported from GeminiService) ---

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
    if (!text) return {};
    
    let cleaned = text
        .replace(/<(?:thought|thinking)>[\s\S]*?<\/(?:thought|thinking)>/gi, "")
        .replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, "")
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
    
    cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Direct Parse Attempt
    if ((cleaned.startsWith('{') || cleaned.startsWith('[')) && (cleaned.endsWith('}') || cleaned.endsWith(']'))) {
        try { return JSON.parse(cleaned); } catch (e) {}
    }

    // Substring Extraction
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
            try { return JSON.parse(potentialJson); } catch (innerError) {
                potentialJson = preRepairMangledJson(potentialJson);
                try { return JSON.parse(potentialJson); } catch (mangleError) {
                    const repaired = repairJson(potentialJson);
                    try { return JSON.parse(repaired); } catch (finalError) {
                        try {
                            const fn = new Function(`return (${repaired})`);
                            return fn();
                        } catch (looseError) {}
                    }
                }
            }
        }
    }
    return null; // Return null to indicate failure to caller, so they can handle it
};

// --- SERVICE ---

export const openaiService = {
    async generateContent(
        apiKey: string, 
        model: string, 
        prompt: string, 
        systemInstruction?: string,
        images?: string[]
    ): Promise<{ text: string, usage: AIUsageResult }> {
        
        const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
        
        // Strict JSON Enforcement similar to Gemini Service logic
        const forcedJsonInstruction = "IMPORTANT: You are a JSON-only API. You MUST return pure valid JSON. Do not include markdown formatting like ```json or ```. Do not include any text before or after the JSON object. Do not output marketing briefs, audience analysis, or conversion strategies. Focus ONLY on generating the requested application code and structure.";
        
        const messages: any[] = [];
        messages.push({ 
            role: 'system', 
            content: systemInstruction ? `${systemInstruction}\n\n${forcedJsonInstruction}` : forcedJsonInstruction 
        });
        
        if (images && images.length > 0) {
             const contentParts: any[] = [{ type: 'text', text: `GENERATE CODE FOR THIS TASK:\n${prompt}\n\n(Respond in JSON)` }];
             images.forEach(img => {
                 contentParts.push({
                     type: 'image_url',
                     image_url: { url: img } 
                 });
             });
             messages.push({ role: 'user', content: contentParts });
        } else {
             // Append hint to user prompt as well for safety
             messages.push({ role: 'user', content: `GENERATE CODE FOR THIS TASK:\n${prompt}\n\n(Respond in JSON)` });
        }

        const payload = {
            model: model || "gpt-4o",
            messages: messages,
            temperature: 0.1,
            response_format: { type: "json_object" } 
        };

        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `OpenAI API ${response.status}: ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) errorMessage = errorJson.error.message;
            } catch (e) {}
            throw new Error(errorMessage);
        }

        const data = await response.json();
        const rawText = data.choices?.[0]?.message?.content || "{}";
        
        // --- KEY FIX: Apply Robust JSON Extraction to OpenAI Response ---
        // Even if OpenAI sends markdown (rare in JSON mode but possible if hallucinating), 
        // this cleans it before the app sees it.
        let cleanText = rawText;
        const parsed = extractJson(rawText);
        if (parsed) {
            // Re-stringify to ensure clean JSON string is returned to supervisor
            cleanText = JSON.stringify(parsed);
        } else {
            // If internal extraction fails, return rawText and let supervisor retry/fail
            console.warn("OpenAI: Internal JSON extraction failed, returning raw text.");
        }

        const usage = data.usage || {};
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;

        // Pricing estimate for GPT-4o
        const inputPrice = 5.00; 
        const outputPrice = 15.00;
        const cost = ((inputTokens / 1_000_000) * inputPrice) + ((outputTokens / 1_000_000) * outputPrice);

        return {
            text: cleanText,
            usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                costUsd: cost,
                provider: 'openai',
                model: model || "gpt-4o"
            }
        };
    }
};