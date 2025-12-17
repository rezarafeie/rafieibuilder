
import { AIUsageResult } from "../types";

export const openaiService = {
    async generateContent(
        apiKey: string, 
        model: string, 
        prompt: string, 
        systemInstruction?: string,
        images?: string[] // array of base64 strings OR http urls
    ): Promise<{ text: string, usage: AIUsageResult }> {
        
        const isReasoningModel = model.includes('o1') || model.includes('o3');

        const messages: any[] = [];
        
        if (systemInstruction) {
            if (isReasoningModel) {
                // Reasoning models (o1) use 'developer' role or generally prefer instructions in user message.
                messages.push({ role: "developer", content: systemInstruction });
            } else {
                messages.push({ role: "system", content: systemInstruction });
            }
        }

        const userContent: any[] = [{ type: "text", text: prompt }];
        
        if (images && images.length > 0) {
            images.forEach(img => {
                let url = img;
                
                // If it's NOT a data URI and NOT an HTTP URL, assume it's base64 and wrap it
                if (!img.startsWith('http') && !img.startsWith('data:')) {
                    // Default to jpeg if not specified, though usually we try to detect
                    url = `data:image/jpeg;base64,${img}`;
                }

                userContent.push({
                    type: "image_url",
                    image_url: {
                        url: url
                    }
                });
            });
        }

        messages.push({ role: "user", content: userContent });

        // Use Proxy for CORS
        const PROXY_URL = 'https://corsproxy.io/?';
        const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

        const payload: any = {
            model: model,
            messages: messages,
            // O1 models don't support max_tokens or temperature in the same way sometimes, 
            // but for now we keep defaults or adjust if needed.
            // Reasoning models might reject temperature.
        };

        if (!isReasoningModel) {
            payload.temperature = 0.2;
            payload.max_tokens = 4096;
        } else {
            // O1-preview supports max_completion_tokens
            payload.max_completion_tokens = 8192;
        }

        const response = await fetch(`${PROXY_URL}${encodeURIComponent(OPENAI_URL)}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
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
        const text = data.choices[0]?.message?.content || "";
        
        // Usage
        const usage = data.usage || {};
        const inputTokens = usage.prompt_tokens || 0;
        const outputTokens = usage.completion_tokens || 0;

        // Approximate Pricing (Fallback if not provided by API)
        // GPT-4o: Input $5/1M, Output $15/1M
        // O1-preview: Input $15/1M, Output $60/1M
        // O1-mini: Input $3/1M, Output $12/1M
        // GPT-4o-mini: Input $0.15/1M, Output $0.60/1M
        
        let inputPrice = 5.0; 
        let outputPrice = 15.0;

        if (model.includes('mini')) {
            if (model.includes('o1')) { inputPrice = 3.0; outputPrice = 12.0; }
            else { inputPrice = 0.15; outputPrice = 0.60; }
        } else if (model.includes('o1')) {
            inputPrice = 15.0; outputPrice = 60.0;
        } else if (model.includes('gpt-3.5')) {
            inputPrice = 0.5; outputPrice = 1.5;
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
