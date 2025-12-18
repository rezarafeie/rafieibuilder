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
        const OPENAI_URL = 'https://api.openai.com/v1/responses';

        // Organization and Project IDs from reference
        const ORG_ID = 'org-zhaJWr2MhEIQCCW7WAxaUe0k';
        const PROJ_ID = 'proj_WXVi3fbcro03UCUcQztqhDag';

        // Construct payload according to example request provided by user
        const payload: any = {
            model: model,
            input: prompt
        };

        // Pass system instructions if provided
        if (systemInstruction) {
            payload.instructions = systemInstruction;
        }

        // Note: The /v1/responses API uses a single 'input' string. 
        // Image URLs are already enriched into the prompt by cloudService.ts

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
        
        // Parsing logic strictly mapped to provided answer example
        // Path: output[0].content[0].text
        const text = data.output?.[0]?.content?.[0]?.text || "";
        
        // Usage extraction mapping
        const usage = data.usage || {};
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;

        // Pricing logic (approximate for custom models)
        let inputPrice = 5.0; 
        let outputPrice = 15.0;
        
        if (model.includes('5.2')) {
            inputPrice = 10.0;
            outputPrice = 30.0;
        } else if (model.includes('4.1')) {
            inputPrice = 2.5; 
            outputPrice = 10.0;
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