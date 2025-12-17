
import { createClient } from '@supabase/supabase-js';
import { webhookService } from './webhookService';

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

// Default Gemini Pricing (Fallback if not provided)
const MODEL_PRICING: Record<string, { input: number, output: number }> = {
    // Gemini 2.5
    'gemini-2.5-flash': { input: 0.075, output: 0.30 }, 
    'gemini-flash-latest': { input: 0.075, output: 0.30 },
    'gemini-2.5-flash-lite': { input: 0.05, output: 0.20 },
    
    // Gemini 3 / Pro
    'gemini-3-pro': { input: 3.50, output: 10.50 },
    'gemini-3-pro-preview': { input: 3.50, output: 10.50 },
    
    // Gemini 1.5
    'gemini-1.5-pro': { input: 3.50, output: 10.50 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
    
    // Fallback
    'default': { input: 0.10, output: 0.40 } 
};

// 1 USD = 10 Credits
const CREDITS_PER_USD = 10;

export const billingService = {
    
    calculateRawCost(model: string, inputTokens: number, outputTokens: number): number {
        // Guard against null/undefined model strings
        if (!model) return 0;

        // Check if model has specific mapping
        const key = Object.keys(MODEL_PRICING).find(k => model.includes(k)) || 'default';
        const pricing = MODEL_PRICING[key];
        const inputCost = (inputTokens / 1_000_000) * pricing.input;
        const outputCost = (outputTokens / 1_000_000) * pricing.output;
        return inputCost + outputCost;
    },

    calculateCredits(usdCost: number): number {
        return usdCost * CREDITS_PER_USD;
    },

    async checkBalance(userId: string, minRequired: number = 0.1): Promise<boolean> {
        const { data, error } = await supabase.from('user_settings').select('credits_balance').eq('user_id', userId).single();
        if (error) {
            if (error.code === 'PGRST116') return true; 
            return false;
        }
        return (data?.credits_balance || 0) > minRequired;
    },

    async chargeUser(
        userId: string, 
        projectId: string, 
        operationType: string, 
        model: string, 
        usage: { promptTokenCount: number, candidatesTokenCount: number, costUsd?: number },
        meta?: any // New: capture prompts, keys, logs
    ): Promise<number> {
        
        // Use provided cost if available (from OpenAI/Provider service), else calculate fallback
        const rawCostUsd = usage.costUsd !== undefined 
            ? usage.costUsd 
            : this.calculateRawCost(model, usage.promptTokenCount, usage.candidatesTokenCount);
        
        // Convert USD Cost to Credit Cost (1 USD = 10 Credits)
        const creditCost = rawCostUsd * CREDITS_PER_USD;
        
        const safeCreditCost = Math.max(creditCost, 0.00001);

        const { data, error } = await supabase.rpc('process_ai_charge', {
            p_user_id: userId,
            p_project_id: projectId,
            p_model: model,
            p_operation_type: operationType,
            p_input_tokens: usage.promptTokenCount,
            p_output_tokens: usage.candidatesTokenCount,
            p_raw_cost_usd: safeCreditCost,
            p_meta: meta || {}
        });

        if (error) {
            const errStr = error.message || JSON.stringify(error);
            console.error(`Billing Charge Failed: ${errStr}`);
            return 0;
        }
        
        const deducted = data?.deducted || 0;
        const remaining = data?.remaining || 0;
        
        /* 
        // Disabled per request
        webhookService.send('credit.used', {
            amount: deducted,
            model,
            tokens_in: usage.promptTokenCount,
            tokens_out: usage.candidatesTokenCount,
            remaining_balance: remaining
        }, { project_id: projectId }, { id: userId, email: '' });
        */

        if (remaining < 2.0) {
            webhookService.send('credit.balance_low', { remaining_balance: remaining }, {}, { id: userId, email: '' });
        }
        
        return deducted;
    },

    async updateProfitMargin(percentage: number): Promise<void> {
        const { error } = await supabase.from('financial_settings').update({ profit_margin_percentage: percentage }).eq('id', 1);
        if (error) throw error;
    }
};
