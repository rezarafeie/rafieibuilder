
import { User } from '../types';
import { createClient } from '@supabase/supabase-js';

// Default Fallback
const DEFAULT_WEBHOOK_URL = 'https://hook.us1.make.com/jx8gnwt3nvrhz4ozyu3cdw68ky2eoc8m';

// Safe environment access for auto-actor resolution
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

export type EventType = 
  // User
  | 'user.registered' | 'user.logged_in' | 'user.logged_out' | 'user.profile_updated'
  // Project
  | 'project.created' | 'project.updated' | 'project.deleted' | 'project.opened' | 'project.imported_from_github'
  // Build / AI
  | 'build.started' | 'build.phase_started' | 'build.phase_completed' | 'build.completed' | 'build.failed' | 'build.paused_due_to_quota' | 'build.paused_due_to_credit'
  // Cloud
  | 'cloud.connection_requested' | 'cloud.connected' | 'cloud.connection_failed' | 'cloud.disconnected'
  // Credit / Billing
  | 'credit.used' | 'credit.balance_low' | 'credit.added' | 'credit.purchase_started' | 'credit.purchase_completed' | 'credit.purchase_failed'
  // System
  | 'system.warning' | 'system.error' | 'ai.quota_exceeded' | 'ai.runtime_error'
  // Admin Test
  | 'admin.test_event';

interface Actor {
    user_id: string;
    email: string;
}

export interface WebhookPayload {
    event: {
        id: string;
        type: EventType;
        timestamp: string;
    };
    actor: Actor;
    context: {
        project_id?: string;
        build_id?: string;
        [key: string]: any;
    };
    data: Record<string, any>;
    meta: {
        environment: string;
        source: string;
        version: string;
    };
}

class WebhookService {
    
    private cachedUrl: string | null = null;
    private lastCacheTime: number = 0;

    // Force refresh cache (e.g., when Admin updates the URL)
    public clearCache() {
        this.cachedUrl = null;
    }

    private async getUrl(): Promise<string> {
        // Cache for 5 minutes
        if (this.cachedUrl && (Date.now() - this.lastCacheTime < 300000)) {
            return this.cachedUrl;
        }

        try {
            // Direct DB call to avoid circular dependency on cloudService
            const { data } = await supabase.from('system_settings').select('value').eq('key', 'webhook_url').single();
            if (data?.value) {
                this.cachedUrl = data.value;
                this.lastCacheTime = Date.now();
                return data.value;
            }
        } catch(e) {
            console.warn("Failed to fetch webhook URL from DB, using default.", e);
        }

        return DEFAULT_WEBHOOK_URL;
    }

    /**
     * Resolves the current actor. 
     * Uses provided user object if available, otherwise attempts to fetch session from Supabase.
     */
    private async resolveActor(providedUser?: { id: string, email?: string }): Promise<Actor> {
        if (providedUser && providedUser.email) {
            return {
                user_id: providedUser.id,
                email: providedUser.email
            };
        }

        try {
            const { data } = await (supabase.auth as any).getSession();
            if (data.session?.user) {
                return {
                    user_id: data.session.user.id,
                    email: data.session.user.email || 'no-email@rafieibuilder.com'
                };
            }
        } catch (e) {
            // Ignore session fetch errors
        }

        return { user_id: 'anonymous', email: 'anonymous@rafieibuilder.com' };
    }

    /**
     * Main entry point to send an event.
     * Non-blocking (Fire-and-Forget).
     */
    public async send(
        type: EventType, 
        data: Record<string, any> = {}, 
        context: Record<string, any> = {}, 
        user?: { id: string, email?: string }
    ): Promise<void> {
        // Resolve actor first
        this.resolveActor(user).then(async actor => {
            const payload: WebhookPayload = {
                event: {
                    id: crypto.randomUUID(),
                    type,
                    timestamp: new Date().toISOString()
                },
                actor,
                context,
                data,
                meta: {
                    environment: 'production',
                    source: 'rafieibuilder',
                    version: '1.0.0'
                }
            };

            const url = await this.getUrl();
            this.emit(url, payload);
        }).catch(err => console.error("Webhook Actor Resolution Failed", err));
    }

    private async emit(url: string, payload: WebhookPayload, attempt = 1) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const responseBody = await res.text();
            
            // Direct DB Log to avoid circular dependency
            try {
                await supabase.from('webhook_logs').insert({
                    event_type: payload.event.type,
                    payload: payload,
                    status_code: res.status,
                    response_body: responseBody.substring(0, 1000)
                });
            } catch(e) {}

            if (!res.ok) {
                console.warn(`[Webhook] Delivery failed (${res.status}). Type: ${payload.event.type}. Attempt ${attempt}`);
                this.retry(url, payload, attempt);
            } else {
                console.debug(`[Webhook] Sent: ${payload.event.type}`);
            }
        } catch (err: any) {
            console.warn(`[Webhook] Network error. Type: ${payload.event.type}. Attempt ${attempt}`, err);
            
            // Log failure directly
            try {
                await supabase.from('webhook_logs').insert({
                    event_type: payload.event.type,
                    payload: payload,
                    status_code: 0, // Network error
                    response_body: err.message
                });
            } catch(e) {}

            this.retry(url, payload, attempt);
        }
    }

    private retry(url: string, payload: WebhookPayload, attempt: number) {
        const MAX_RETRIES = 3;
        if (attempt >= MAX_RETRIES) {
            console.error(`[Webhook] Dropped event ${payload.event.type} after ${MAX_RETRIES} attempts.`);
            return; 
        }
        
        // Exponential backoff: 2s, 4s, 8s
        const delay = Math.pow(2, attempt) * 1000;
        
        setTimeout(() => {
            this.emit(url, payload, attempt + 1);
        }, delay);
    }
}

export const webhookService = new WebhookService();
