
import { AIUsageResult } from "../types";

export const claudeService = {
    async generateContent(
        apiKey: string,
        model: string,
        prompt: string,
        systemInstruction?: string,
        images?: string[] // base64 strings (raw or data URI) or HTTP URLs
    ): Promise<{ text: string, usage: AIUsageResult }> {
        // Anthropic API does not support CORS for browser requests, so we use a proxy.
        const PROXY_URL = 'https://corsproxy.io/?';
        const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
        
        const content: any[] = [];
        
        // Handle Images
        if (images && images.length > 0) {
            await Promise.all(images.map(async (img) => {
                let mediaType = "image/jpeg";
                let rawBase64 = img;

                // 1. Check if HTTP URL - fetch and convert
                if (img.startsWith('http')) {
                    try {
                        const response = await fetch(img);
                        const blob = await response.blob();
                        const buffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(buffer);
                        let binary = '';
                        for (let i = 0; i < bytes.byteLength; i++) {
                            binary += String.fromCharCode(bytes[i]);
                        }
                        rawBase64 = btoa(binary);
                        if (blob.type.includes('png')) mediaType = 'image/png';
                        else if (blob.type.includes('gif')) mediaType = 'image/gif';
                        else if (blob.type.includes('webp')) mediaType = 'image/webp';
                    } catch(e) {
                        console.error("Failed to fetch image URL for Claude", e);
                        return; // Skip this image
                    }
                }
                // 2. Check for Data URI prefix and extract
                else if (img.includes('base64,')) {
                    const parts = img.split('base64,');
                    rawBase64 = parts[1];
                    // Try to extract mime type from the prefix
                    const prefix = parts[0];
                    if (prefix.includes('image/png')) mediaType = 'image/png';
                    else if (prefix.includes('image/gif')) mediaType = 'image/gif';
                    else if (prefix.includes('image/webp')) mediaType = 'image/webp';
                } else {
                    // 3. Fallback to magic bytes if no prefix
                    if (img.startsWith("iVBORw")) mediaType = "image/png";
                    else if (img.startsWith("R0lGOD")) mediaType = "image/gif";
                    else if (img.startsWith("UklGR")) mediaType = "image/webp";
                }

                content.push({
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: mediaType,
                        data: rawBase64
                    }
                });
            }));
        }

        // Add Text Prompt
        content.push({ type: "text", text: prompt });

        // --- MODEL NORMALIZATION ---
        let activeModel = model;
        
        // Only map the generic 'latest' alias. 
        if (!activeModel || activeModel === 'claude-3-5-sonnet-latest') {
             activeModel = 'claude-3-5-sonnet-20241022';
        }

        const payload: any = {
            model: activeModel,
            max_tokens: 8192,
            messages: [{ role: "user", content }],
            temperature: 0.2
        };

        if (systemInstruction) {
            payload.system = systemInstruction;
        }

        try {
            const response = await fetch(`${PROXY_URL}${encodeURIComponent(ANTHROPIC_URL)}`, {
                method: "POST",
                headers: {
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                let errMsg = errText;
                try {
                    const json = JSON.parse(errText);
                    if (json.error && json.error.message) errMsg = json.error.message;
                } catch (e) {}

                // --- ROBUST FALLBACK CHAIN ---
                if (response.status === 404 || response.status === 400) {
                    console.warn(`Claude model '${activeModel}' failed (${response.status}). Attempting fallback...`);
                    
                    // Fallback 1: Try the June 2024 version of 3.5 Sonnet
                    if (activeModel === 'claude-3-5-sonnet-20241022') {
                         console.log("Falling back to claude-3-5-sonnet-20240620");
                         return claudeService.generateContent(apiKey, 'claude-3-5-sonnet-20240620', prompt, systemInstruction, images);
                    }
                    
                    // Fallback 2: Try Claude 3 Sonnet (very stable)
                    if (activeModel === 'claude-3-5-sonnet-20240620') {
                         console.log("Falling back to claude-3-sonnet-20240229");
                         return claudeService.generateContent(apiKey, 'claude-3-sonnet-20240229', prompt, systemInstruction, images);
                    }
                    
                    // Fallback 3: Try Claude 3 Haiku (last resort)
                    if (activeModel === 'claude-3-sonnet-20240229') {
                         console.log("Falling back to claude-3-haiku-20240307");
                         return claudeService.generateContent(apiKey, 'claude-3-haiku-20240307', prompt, systemInstruction, images);
                    }
                }

                throw new Error(`Anthropic Error (${response.status}): ${errMsg}`);
            }

            const data = await response.json();
            const text = data.content?.find((c: any) => c.type === 'text')?.text || "";
            
            // Usage & Cost Calculation
            const inputTokens = data.usage?.input_tokens || 0;
            const outputTokens = data.usage?.output_tokens || 0;

            // Pricing (Estimates per 1M tokens)
            let inputPrice = 3.00; // Sonnet (Default)
            let outputPrice = 15.00;

            if (activeModel.includes('opus')) {
                inputPrice = 15.00;
                outputPrice = 75.00;
            } else if (activeModel.includes('haiku')) {
                inputPrice = 0.25;
                outputPrice = 1.25;
            }

            const cost = ((inputTokens / 1000000) * inputPrice) + ((outputTokens / 1000000) * outputPrice);

            return {
                text,
                usage: {
                    promptTokens: inputTokens,
                    completionTokens: outputTokens,
                    costUsd: cost,
                    provider: 'claude',
                    model: activeModel
                }
            };
        } catch (e: any) {
            throw e;
        }
    }
};
