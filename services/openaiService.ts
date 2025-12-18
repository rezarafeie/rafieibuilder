
import { AIUsageResult } from "../types";

export const openaiService = {
    async generateContent(
        apiKey: string, 
        model: string, 
        prompt: string, 
        systemInstruction?: string,
        images?: string[]
    ): Promise<{ text: string, usage: AIUsageResult }> {
        
        // Use Proxy for CORS
        const PROXY_URL = 'https://corsproxy.io/?';
        const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

        // Organization and Project IDs (optional, but kept if user needs them)
        const ORG_ID = 'org-zhaJWr2MhEIQCCW7WAxaUe0k';
        const PROJ_ID = 'proj_WXVi3fbcro03UCUcQztqhDag';

        // Standard Chat Completion Payload
        const messages: any[] = [];
        
        if (systemInstruction) {
            messages.push({ role: "system", content: systemInstruction });
        }

        // Note: Image URLs are already enriched into the prompt text by the supervisor in cloudService.ts
        // so we can use a simple text content approach or multi-part if strictly needed.
        messages.push({ role: "user", content: prompt });

        const payload = {
            model: model || "gpt-4o",
            messages: messages,
            temperature: 0.1,
            max_tokens: 4096
        };

        const response = await fetch(`${PROXY_URL}${encodeURIComponent(OPENAI_URL)}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "OpenAI-Organization": ORG_ID,
                "OpenAI-Project": PROJ_ID,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `OpenAI API Error: ${response.status} ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error && errorJson.error.message) {
                    errorMessage = errorJson.error.message;
                }
            } catch (e) {}
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Parsing logic for Chat Completions
        const text = data.choices?.[0]?.message?.content || "";
        
        // Usage extraction
        const usage = data.usage || {};
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;

        // Pricing logic (approximate for standard models)
        let inputPrice = 2.50; 
        let outputPrice = 10.00;
        
        if (model.includes('gpt-4o-mini')) {
            inputPrice = 0.15;
            outputPrice = 0.60;
        } else if (model.includes('gpt-4o')) {
            inputPrice = 5.00;
            outputPrice = 15.00;
        }

        const cost = ((inputTokens / 1_000_000) * inputPrice) + ((outputTokens / 1_000_000) * outputPrice);

        return {
            text,
            usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                costUsd: cost,
                provider: 'openai',
                model: model
            }
        };
    }
};
