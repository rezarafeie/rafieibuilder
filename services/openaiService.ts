
import { AIUsageResult } from "../types";

export const openaiService = {
    async generateContent(
        apiKey: string, 
        model: string, 
        prompt: string, 
        systemInstruction?: string,
        images?: string[]
    ): Promise<{ text: string, usage: AIUsageResult }> {
        
        const OPENAI_URL = 'https://api.openai.com/v1/responses';

        // Context Identifiers
        const ORG_ID = 'org-zhaJWr2MhEIQCCW7WAxaUe0k';
        const PROJ_ID = 'proj_WXVi3fbcro03UCUcQztqhDag';

        // Optimized Input Construction for v1/responses
        const fullInput = systemInstruction 
            ? `## SYSTEM INSTRUCTIONS\n${systemInstruction}\n\n## USER REQUEST\n${prompt}`
            : prompt;

        const payload = {
            model: model || "gpt-5.2",
            input: fullInput,
            temperature: 0.1,
            store: true
        };

        const response = await fetch(OPENAI_URL, {
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
            let errorMessage = `OpenAI API ${response.status}: ${response.statusText}`;
            
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) errorMessage = errorJson.error.message;
            } catch (e) {}
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Extract raw text from nested v1/responses structure: data.output[0].content[0].text
        let rawText = "";
        try {
            const contentParts = data.output?.[0]?.content;
            if (Array.isArray(contentParts)) {
                // Find the part with type 'output_text' as per your provided schema
                const textPart = contentParts.find((c: any) => c.type === 'output_text') || contentParts[0];
                rawText = textPart?.text || textPart?.value || "";
            }
        } catch (err) {
            throw new Error("OpenAI v1/responses structure mismatch.");
        }
        
        const usage = data.usage || {};
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;

        // Pricing estimates for high-end models (gpt-5.2/4.1)
        const inputPrice = 5.00; 
        const outputPrice = 15.00;
        const cost = ((inputTokens / 1_000_000) * inputPrice) + ((outputTokens / 1_000_000) * outputPrice);

        return {
            text: rawText,
            usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                costUsd: cost,
                provider: 'openai',
                model: model || "gpt-5.2"
            }
        };
    }
};
