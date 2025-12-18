
import { AIUsageResult } from "../types";

export const claudeService = {
    async generateContent(
        apiKey: string,
        model: string,
        prompt: string,
        systemInstruction?: string,
        images?: string[] 
    ): Promise<{ text: string, usage: AIUsageResult }> {
        
        const PROXY_URL = 'https://corsproxy.io/?';
        const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
        
        const content: any[] = [];
        
        // Image Processing
        if (images && images.length > 0) {
            await Promise.all(images.map(async (img) => {
                let mediaType = "image/jpeg";
                let rawBase64 = img;

                if (img.startsWith('http')) {
                    try {
                        const response = await fetch(img);
                        const blob = await response.blob();
                        const buffer = await blob.arrayBuffer();
                        const bytes = new Uint8Array(buffer);
                        let binary = '';
                        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                        rawBase64 = btoa(binary);
                        if (blob.type.includes('png')) mediaType = 'image/png';
                        else if (blob.type.includes('webp')) mediaType = 'image/webp';
                    } catch(e) { return; }
                } else if (img.includes('base64,')) {
                    const parts = img.split('base64,');
                    rawBase64 = parts[1];
                    const prefix = parts[0];
                    if (prefix.includes('image/png')) mediaType = 'image/png';
                    else if (prefix.includes('image/webp')) mediaType = 'image/webp';
                }

                content.push({
                    type: "image",
                    source: { type: "base64", media_type: mediaType, data: rawBase64 }
                });
            }));
        }

        content.push({ type: "text", text: prompt });

        const payload: any = {
            model: model || 'claude-3-5-sonnet-20241022',
            max_tokens: 8192,
            messages: [{ role: "user", content }],
            temperature: 0.1
        };

        if (systemInstruction) payload.system = systemInstruction;

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
            throw new Error(`Claude API ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const text = data.content?.find((c: any) => c.type === 'text')?.text || "";
        
        const inputTokens = data.usage?.input_tokens || 0;
        const outputTokens = data.usage?.output_tokens || 0;
        const cost = ((inputTokens / 1000000) * 3.00) + ((outputTokens / 1000000) * 15.00);

        return {
            text,
            usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                costUsd: cost,
                provider: 'claude',
                model: payload.model
            }
        };
    }
};

