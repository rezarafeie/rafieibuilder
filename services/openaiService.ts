
import { AIUsageResult } from "../types";

export const openaiService = {
    async generateContent(
        apiKey: string, 
        model: string, 
        prompt: string, 
        systemInstruction?: string,
        images?: string[]
    ): Promise<{ text: string, usage: AIUsageResult }> {
        
        const PROXY_URL = 'https://corsproxy.io/?';
        const OPENAI_URL = 'https://api.openai.com/v1/responses';

        // Provided specific ID context
        const ORG_ID = 'org-zhaJWr2MhEIQCCW7WAxaUe0k';
        const PROJ_ID = 'proj_WXVi3fbcro03UCUcQztqhDag';

        // Combine system instruction and prompt for the 'input' field
        const fullInput = systemInstruction 
            ? `System Instructions:\n${systemInstruction}\n\nUser Request:\n${prompt}`
            : prompt;

        const payload = {
            model: model || "gpt-5.2",
            input: fullInput,
            temperature: 1.0,
            store: true
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
        
        /**
         * Parsing logic for specific /v1/responses format:
         * data.output[0].content[0].text
         */
        let text = "";
        try {
            const output = data.output?.[0];
            if (output && output.content && Array.isArray(output.content)) {
                const contentPart = output.content.find((c: any) => c.type === 'output_text');
                text = contentPart ? contentPart.text : output.content[0]?.text || "";
            }
        } catch (err) {
            console.error("Failed to parse OpenAI response structure", err);
            throw new Error("Invalid response structure from OpenAI v1/responses API");
        }
        
        // Usage extraction
        const usage = data.usage || {};
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;

        // Pricing logic (approximate for gpt-5.2/4.1 based on tokens)
        const inputPrice = 5.00; // $5 per 1M tokens
        const outputPrice = 15.00; // $15 per 1M tokens

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
