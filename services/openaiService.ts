
import { AIUsageResult } from "../types";

export const openaiService = {
    async generateContent(
        apiKey: string, 
        model: string, 
        prompt: string, 
        systemInstruction?: string,
        images?: string[] // array of base64 strings
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
                // OpenAI requires Data URI format: data:image/jpeg;base64,{base64_image}
                // If input is already a data URI, use it directly. If raw base64, construct it.
                let url = img;
                if (!img.startsWith('data:')) {
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

        const payload: any = {
            model: model || "gpt-4o",
            messages: messages
        };

        if (isReasoningModel) {
            // o1/o3 models use max_completion_tokens and do not support temperature/response_format in standard ways yet
            payload.max_completion_tokens = 25000; // High limit for reasoning
        } else {
            payload.temperature = 0.2; // Low temp for code generation
            payload.max_tokens = 4096;
            
            // Fix: Only enforce JSON object mode if the SYSTEM instruction explicitly asks for it.
            // We strictly check systemInstruction to avoid triggering this on generic Chat/Router prompts.
            const systemContext = (systemInstruction || '').toLowerCase();
            
            if (systemContext.includes('json')) {
                payload.response_format = { type: "json_object" };
                
                // CRITICAL FIX: OpenAI throws a 400 error if response_format is json_object but the word "JSON"
                // is not found in the messages. Even if systemInstruction triggered the check, quirks in validation
                // or case-sensitivity can cause failures. We defensively ensure "JSON" is present.
                const hasSystemMessage = messages.some(m => m.role === 'system');
                if (hasSystemMessage) {
                    // Start from end to find the system message we added
                    const sysMsg = messages.find(m => m.role === 'system');
                    if (sysMsg && !sysMsg.content.includes('JSON') && !sysMsg.content.includes('json')) {
                        sysMsg.content += " (Respond in JSON)";
                    }
                } else {
                    // Fallback if no system message exists (shouldn't happen if systemContext has json, but safe is safe)
                    messages.unshift({ role: "system", content: "Please output valid JSON." });
                }
            }
        }

        try {
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
                const errMsg = err.error?.message || response.statusText;

                // Automatic Fallback for missing/restricted models (e.g. o1-mini 404)
                if ((response.status === 404 || response.status === 403) && isReasoningModel) {
                    console.warn(`Model ${model} failed (${response.status}). Falling back to gpt-4o.`);
                    return this.generateContent(apiKey, 'gpt-4o', prompt, systemInstruction, images);
                }

                throw new Error(`OpenAI Error: ${errMsg}`);
            }

            const data = await response.json();
            const text = data.choices[0]?.message?.content || "";
            
            // Calculate Cost (Estimate based on model pricing tiers)
            // Prices per 1M tokens (USD)
            let inputPrice = 0.50; // Default / low tier
            let outputPrice = 1.50;

            if (model.includes('gpt-5') || model.includes('gpt-4.1') || model.includes('o1')) {
                 inputPrice = 15.00; // o1-preview pricing (approx)
                 outputPrice = 60.00;
                 if (model.includes('mini')) {
                     inputPrice = 3.00;
                     outputPrice = 12.00;
                 }
            } else if (model.includes('gpt-4') && !model.includes('mini')) {
                 inputPrice = 5.00; // GPT-4o
                 outputPrice = 15.00;
            } else if (model.includes('mini')) {
                 inputPrice = 0.15;
                 outputPrice = 0.60;
            }

            const inputTokens = data.usage?.prompt_tokens || 0;
            const outputTokens = data.usage?.completion_tokens || 0;
            
            const cost = ((inputTokens / 1000000) * inputPrice) + ((outputTokens / 1000000) * outputPrice);

            return {
                text,
                usage: {
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    costUsd: cost,
                    provider: 'openai',
                    model
                }
            };
        } catch (e: any) {
            throw e; // Supervisor will catch this
        }
    }
};
