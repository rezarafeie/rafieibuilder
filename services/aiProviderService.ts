
import { createClient } from '@supabase/supabase-js';
import { AIProviderConfig, AIProviderId } from '../types';

// Safe environment access
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const AVAILABLE_MODELS = {
    'google': [
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'gemini-2.5-flash',
        'gemini-2.0-flash-exp',
        'gemini-1.5-pro',
        'gemini-1.5-flash'
    ],
    'openai': [
        'gpt-5.2',
        'gpt-4.1-2025-04-14',
        'gpt-4o',
        'gpt-4o-mini',
        'o1-preview',
        'o1-mini',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo'
    ],
    'claude': [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
        'claude-3-sonnet-20240229',
        'claude-3-haiku-20240307'
    ]
};

const DEFAULT_PROVIDERS: AIProviderConfig[] = [
    { id: 'google', name: 'Google Gemini', isActive: true, isFallback: false, model: 'gemini-2.5-flash', updatedAt: Date.now() },
    { id: 'openai', name: 'OpenAI (ChatGPT)', isActive: false, isFallback: false, model: 'gpt-5.2', updatedAt: Date.now() },
    { id: 'claude', name: 'Anthropic Claude', isActive: false, isFallback: false, model: 'claude-3-5-sonnet-20241022', updatedAt: Date.now() }
];

export const aiProviderService = {
    
    getAvailableModels(providerId: string): string[] {
        // @ts-ignore
        return AVAILABLE_MODELS[providerId] || [];
    },

    async getAllConfigs(): Promise<AIProviderConfig[]> {
        const { data, error } = await supabase.from('ai_providers').select('*');
        
        if (error) {
            console.error("Failed to fetch AI configs:", error);
            return DEFAULT_PROVIDERS;
        }
        
        // Map DB rows to Config objects
        const dbConfigs = data.map((row: any) => ({
            id: row.id as AIProviderId,
            name: row.name,
            isActive: row.is_active,
            isFallback: row.is_fallback,
            apiKey: row.api_key,
            model: row.model,
            updatedAt: new Date(row.updated_at).getTime()
        }));

        // Merge DB results with Defaults to ensure all providers are shown even if not in DB yet
        return DEFAULT_PROVIDERS.map(def => {
            const existing = dbConfigs.find((c: AIProviderConfig) => c.id === def.id);
            if (existing) {
                return {
                    ...def,
                    ...existing,
                    model: existing.model || def.model,
                    name: existing.name || def.name
                };
            }
            return def;
        });
    },

    async getActiveConfig(): Promise<AIProviderConfig | null> {
        const { data, error } = await supabase
            .from('ai_providers')
            .select('*')
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error) {
            console.warn("Error fetching active AI provider:", error);
            return null;
        }
        
        if (!data || data.length === 0) return null;
        
        const row = data[0];
        return {
            id: row.id as AIProviderId,
            name: row.name,
            isActive: row.is_active,
            isFallback: row.is_fallback,
            apiKey: row.api_key,
            model: row.model,
            updatedAt: new Date(row.updated_at).getTime()
        };
    },

    async getFallbackConfig(): Promise<AIProviderConfig | null> {
        const { data, error } = await supabase
            .from('ai_providers')
            .select('*')
            .eq('is_fallback', true)
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) return null;
        const row = data[0];
        return {
            id: row.id as AIProviderId,
            name: row.name,
            isActive: row.is_active,
            isFallback: row.is_fallback,
            apiKey: row.api_key,
            model: row.model,
            updatedAt: new Date(row.updated_at).getTime()
        };
    },

    async saveConfig(config: Partial<AIProviderConfig> & { id: string }): Promise<void> {
        const defaultName = config.id === 'google' ? 'Google Gemini' : config.id === 'openai' ? 'OpenAI' : 'Claude';

        const payload: any = {
            id: config.id,
            name: config.name || defaultName,
            updated_at: new Date().toISOString()
        };

        if (config.model !== undefined) payload.model = config.model;
        if (config.apiKey !== undefined) payload.api_key = config.apiKey;
        if (config.isActive !== undefined) payload.is_active = config.isActive;
        if (config.isFallback !== undefined) payload.is_fallback = config.isFallback;

        if (config.isActive) {
            const { data: currentActive } = await supabase
                .from('ai_providers')
                .select('id')
                .eq('is_active', true)
                .neq('id', config.id)
                .limit(1)
                .maybeSingle();

            if (currentActive) {
                await supabase
                    .from('ai_providers')
                    .update({ is_active: false, is_fallback: true })
                    .eq('id', currentActive.id);

                await supabase
                    .from('ai_providers')
                    .update({ is_fallback: false })
                    .neq('id', currentActive.id)
                    .neq('id', config.id);
            } else {
                await supabase.from('ai_providers').update({ is_active: false }).neq('id', config.id);
            }
        }

        const { error } = await supabase.from('ai_providers').upsert(payload);
        if (error) throw error;
    }
};
