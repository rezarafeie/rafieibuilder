
import { createClient } from '@supabase/supabase-js';
import { User, Project, RafieiCloudProject, ProjectFile, Domain, Message, BuildState } from '../types';
import { GenerationSupervisor } from './geminiService';
import { getCurrentLanguage, Language } from '../utils/translations';

// --- ENVIRONMENT & SAFETY ---
const getEnv = (key: string) => {
  try {
    // @ts-ignore
    if (typeof process !== 'undefined' && process.env) return process.env[key];
  } catch (e) {}
  return undefined;
};

const SUPABASE_URL = getEnv('SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || 'https://sxvqqktlykguifvmqrni.supabase.co';
const SUPABASE_KEY = getEnv('SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4dnFxa3RseWtndWlmdm1xcm5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU0MDE0MTIsImV4cCI6MjA4MDk3NzQxMn0.5psTW7xePYH3T0mkkHmDoWNgLKSghOHnZaW2zzShkSA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const mapSupabaseUser = (u: any): User | null => {
    if (!u) return null;
    return {
        id: u.id,
        email: u.email || '',
        name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
        avatar: u.user_metadata?.avatar_url,
        credits_balance: u.user_metadata?.credits_balance ?? -1,
        isAdmin: u.email === 'rezarafeie13@gmail.com',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at
    };
};

export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

export const cloudService = {
    abortController: null as AbortController | null,
    messageMap: {} as Record<string, string>, // Maps logical keys to message IDs for current session

    async getCurrentUser(): Promise<User | null> {
        const { data, error } = await supabase.auth.getSession();
        if (error || !data.session) return null;
        return mapSupabaseUser(data.session.user);
    },

    onAuthStateChange(callback: (user: User | null) => void) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            const user = mapSupabaseUser(session?.user || null);
            callback(user);
        });
        return { unsubscribe: () => subscription.unsubscribe() };
    },

    async getUserLanguage(userId: string): Promise<string> {
        const { data } = await supabase.from('user_settings').select('language').eq('user_id', userId).maybeSingle();
        return data?.language || 'en';
    },

    async saveUserLanguage(userId: string, lang: string): Promise<void> {
        await supabase.from('user_settings').upsert({ user_id: userId, language: lang });
    },

    async logout() { await supabase.auth.signOut(); },
    async disconnectSession() { await supabase.auth.signOut(); },

    async login(email: string, pass: string): Promise<User> {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        return mapSupabaseUser(data.user)!;
    },

    async register(email: string, pass: string, name: string): Promise<User> {
        const { data, error } = await supabase.auth.signUp({ email, password: pass, options: { data: { full_name: name } } });
        if (error) throw error;
        return mapSupabaseUser(data.user)!;
    },

    async signInWithGoogle() { await supabase.auth.signInWithOAuth({ provider: 'google' }); },
    async signInWithGitHub() { await supabase.auth.signInWithOAuth({ provider: 'github' }); },

    async getProject(projectId: string): Promise<Project | null> {
        const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
        if (error || !data) return null;
        return this.mapProject(data);
    },

    async getProjectByDomain(domain: string): Promise<Project | null> {
        const { data } = await supabase.from('project_domains').select('project_id').eq('domain', domain).eq('status', 'verified').maybeSingle();
        if (!data) return null;
        return this.getProject(data.project_id);
    },

    async getProjects(userId: string, limit: number, offset: number): Promise<Project[]> {
        const { data } = await supabase.from('projects').select('*').eq('user_id', userId).is('deleted_at', null).order('updated_at', { ascending: false }).range(offset, offset + limit - 1);
        return (data || []).map(p => this.mapProject(p));
    },

    async getTrashedProjects(userId: string, limit: number, offset: number): Promise<Project[]> {
        const { data } = await supabase.from('projects').select('*').eq('user_id', userId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).range(offset, offset + limit - 1);
        return (data || []).map(p => this.mapProject(p));
    },

    async getTrashCount(userId: string): Promise<number> {
        const { count } = await supabase.from('projects').select('*', { count: 'exact', head: true }).eq('user_id', userId).not('deleted_at', 'is', null);
        return count || 0;
    },

    async saveProject(project: Project): Promise<void> {
        const payload = {
            id: project.id, user_id: project.userId, name: project.name, updated_at: new Date().toISOString(),
            code: project.code, files: project.files, messages: project.messages, build_state: project.buildState,
            status: project.status, published_url: project.publishedUrl, custom_domain: project.customDomain,
            rafiei_cloud_project: project.rafieiCloudProject, vercel_config: project.vercelConfig,
            deleted_at: project.deletedAt ? new Date(project.deletedAt).toISOString() : null
        };
        const { error } = await supabase.from('projects').upsert(payload);
        if (error) console.error("Database Save Failure:", error);
    },

    async createProjectSkeleton(user: User, prompt: string, images: { url: string; base64: string }[]): Promise<string> {
        const id = crypto.randomUUID();
        const project: Project = {
            id, userId: user.id, name: "New Project", createdAt: Date.now(), updatedAt: Date.now(),
            code: { html: '', javascript: '', css: '', explanation: '' },
            messages: [{ id: crypto.randomUUID(), role: 'user', type: 'user_input', content: prompt, timestamp: Date.now(), images: images.map(i => i.url) }],
            status: 'idle', buildState: null
        };
        await this.saveProject(project);
        return id;
    },

    async createImportedProject(user: User, name: string, files: ProjectFile[]): Promise<string> {
        const id = crypto.randomUUID();
        const project: Project = {
            id, userId: user.id, name, createdAt: Date.now(), updatedAt: Date.now(),
            code: { html: '', javascript: '', css: '', explanation: '' },
            files, messages: [], status: 'idle', buildState: null
        };
        await this.saveProject(project);
        return id;
    },

    async softDeleteProject(id: string): Promise<void> { await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id); },
    async restoreProject(id: string): Promise<void> { await supabase.from('projects').update({ deleted_at: null }).eq('id', id); },
    async deleteProject(id: string): Promise<void> { await supabase.from('projects').delete().eq('id', id); },

    subscribeToProjectChanges(projectId: string, callback: (p: Project) => void) {
        const channel = supabase.channel(`project-${projectId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, async () => {
                const p = await this.getProject(projectId);
                if (p) callback(p);
            })
            .subscribe();
        return { unsubscribe: () => supabase.removeChannel(channel) };
    },

    subscribeToUserProjects(userId: string, callback: () => void) {
        const channel = supabase.channel(`user-projects-${userId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${userId}` }, callback)
            .subscribe();
        return { unsubscribe: () => supabase.removeChannel(channel) };
    },

    async triggerBuild(project: Project, prompt: string, images: { url: string; base64: string }[], onUpdate: (p: Project, meta?: any) => void, isResume: boolean = false) {
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        this.messageMap = {}; // Reset logical mappings for new trigger

        let currentProject = { ...project };
        const lang = /[\u0600-\u06FF]/.test(prompt) ? 'fa' : getCurrentLanguage();

        const updateLocalState = (updates: Partial<Project>, meta?: any) => {
            currentProject = { ...currentProject, ...updates };
            onUpdate(currentProject, meta);
            return currentProject;
        };

        const createOrUpdateBuildMessage = async (logicalKey: string, message: Partial<Message>): Promise<Message> => {
            if (signal.aborted) throw new Error("ABORTED");
            
            // Resolve ID from map or generate new one
            let msgId = this.messageMap[logicalKey];
            let updatedMessages = [...currentProject.messages];
            const idx = msgId ? updatedMessages.findIndex(m => m.id === msgId) : -1;

            if (idx !== -1) {
                updatedMessages[idx] = { ...updatedMessages[idx], ...message, timestamp: Date.now() };
            } else {
                msgId = crypto.randomUUID();
                this.messageMap[logicalKey] = msgId;
                updatedMessages.push({ id: msgId, role: 'assistant', timestamp: Date.now(), status: 'pending', content: '', ...message } as Message);
            }
            
            updateLocalState({ messages: updatedMessages });
            // Direct save for persistence
            try { await this.saveProject(currentProject); } catch(e) {}
            
            return updatedMessages.find(m => m.id === msgId)!;
        };

        const supervisor = new GenerationSupervisor(currentProject, prompt, images.map(i => i.base64 || i.url), {
            onPlanUpdate: async (phases) => { updateLocalState({ buildState: { ...currentProject.buildState!, phases } }); },
            onMessage: async (msg) => { 
                const updatedMessages = [...currentProject.messages, msg];
                updateLocalState({ messages: updatedMessages });
                try { await this.saveProject(currentProject); } catch(e) {}
            },
            onBuildMessage: createOrUpdateBuildMessage,
            onPhaseStart: async (idx, p) => {
                const bs = currentProject.buildState || { currentPhaseIndex: 0, currentStep: 0, lastCompletedStep: -1, phases: [], error: null, plan: [] };
                bs.currentPhaseIndex = idx;
                if (bs.phases[idx]) bs.phases[idx].status = 'active';
                updateLocalState({ buildState: bs });
            },
            onPhaseComplete: async (idx) => {
                const bs = currentProject.buildState!;
                if (bs.phases[idx]) bs.phases[idx].status = 'completed';
                updateLocalState({ buildState: bs });
            },
            onStepStart: async (idx, s) => {},
            onStepComplete: async (idx, name) => {},
            onChunkComplete: async (code, exp, meta) => { updateLocalState({ code, status: 'generating', files: meta?.files || currentProject.files }); },
            onSuccess: async (code, exp, audit, meta) => { 
                updateLocalState({ code, status: 'idle', files: meta?.files || currentProject.files }); 
                try { await this.saveProject(currentProject); } catch(e) {}
            },
            onError: async (err, retries) => {},
            onFinalError: async (err) => { 
                updateLocalState({ status: 'failed' }); 
                try { await this.saveProject(currentProject); } catch(e) {}
            }
        }, signal, lang as Language);

        supervisor.start(isResume).catch(console.error);
    },

    async triggerRepair(project: Project, error: string, onUpdate: (p: Project, meta?: any) => void, waitForPreview: any) {
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        const supervisor = new GenerationSupervisor(project, "", [], {
            onBuildMessage: async (k, m) => { return m as Message; },
            onChunkComplete: async (c, e, m) => onUpdate({ ...project, files: m?.files }),
            onSuccess: async () => onUpdate({ ...project, status: 'idle' }),
            onFinalError: async () => onUpdate({ ...project, status: 'failed' }),
            onPlanUpdate: async () => {}, onMessage: async () => {}, onPhaseStart: async () => {}, onPhaseComplete: async () => {}, onStepStart: async () => {}, onStepComplete: async () => {}, onError: async () => {},
            waitForPreview
        }, this.abortController.signal);
        supervisor.repair(error);
    },

    stopBuild(projectId: string) { if (this.abortController) { this.abortController.abort(); this.abortController = null; } },
    
    async uploadChatImage(userId: string, tempId: string, file: File) {
        const path = `${userId}/${tempId}-${file.name}`;
        const { data } = await supabase.storage.from('chat_images').upload(path, file);
        return supabase.storage.from('chat_images').getPublicUrl(path).data.publicUrl;
    },

    async checkTableExists(tableName: string) { return true; },
    async rpc(fn: string, params: any) { return await supabase.rpc(fn, params); },
    async getAdminProjects(page = 1, limit = 10) { 
        const { data, count } = await supabase.from('projects').select('*', { count: 'exact' }).range((page-1)*limit, page*limit-1);
        return { data: (data || []).map(p => this.mapProject(p)), count: count || 0 };
    },
    async getAdminUsers(page = 1, limit = 10) { 
        const { data } = await supabase.rpc('get_all_users');
        return { data: data || [], count: data?.length || 0 };
    },
    async searchUsers(query: string) { 
        const { data } = await supabase.rpc('get_all_users');
        return (data || []).filter((u: any) => u.email.includes(query));
    },
    async getSystemLogs(page = 1, limit = 10) { 
        const { data, count } = await supabase.from('system_logs').select('*', { count: 'exact' }).range((page-1)*limit, page*limit-1);
        return { data: data || [], count: count || 0 };
    },
    async getFinancialStats() { return { totalRevenueCredits: 0, totalCostUsd: 0, netProfitUsd: 0, totalCreditsPurchased: 0, currentMargin: 50, totalInputTokens: 0, totalOutputTokens: 0, totalRequestCount: 0 }; },
    async getLedger(page = 1, limit = 10) { 
        const { data, count } = await supabase.from('credit_ledger').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range((page-1)*limit, page*limit-1);
        return { data: data || [], count: count || 0 };
    },
    async getSystemSetting(key: string) { 
        const { data } = await supabase.from('system_settings').select('value').eq('key', key).maybeSingle();
        return data?.value || null;
    },
    async getSystemSettings(keys: string[]) { 
        const { data } = await supabase.from('system_settings').select('*').in('key', keys);
        return data || [];
    },
    async setSystemSetting(key: string, value: string) { await supabase.from('system_settings').upsert({ key, value }); },
    async getWebhookLogs(page = 1, limit = 10) { 
        const { data, count } = await supabase.from('webhook_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range((page-1)*limit, page*limit-1);
        return { data: data || [], count: count || 0 };
    },
    async getUserCredits(userId: string) { 
        const { data } = await supabase.from('user_settings').select('credits_balance').eq('user_id', userId).maybeSingle();
        return data?.credits_balance || 0;
    },
    async getUserFinancialOverview(userId: string) { return { totalPurchased: 0, totalSpent: 0, totalCost: 0, profitGenerated: 0 }; },
    async getUserTransactions(userId: string) { 
        const { data } = await supabase.from('credit_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        return data || [];
    },
    async adminAdjustCredit(userId: string, amount: number, note: string) { await supabase.rpc('admin_adjust_balance', { p_target_user_id: userId, p_amount: amount, p_description: note }); },
    async getDomainsForProject(projectId: string) { 
        const { data } = await supabase.from('project_domains').select('*').eq('project_id', projectId);
        return data || [];
    },
    async addDomain(projectId: string, userId: string, domain: string) { await supabase.from('project_domains').insert({ project_id: projectId, domain, status: 'pending' }); },
    async deleteDomain(domainId: string) { await supabase.from('project_domains').delete().eq('id', domainId); },
    async verifyDomain(domainId: string) { 
        const { data } = await supabase.from('project_domains').select('*').eq('id', domainId).single();
        return data; 
    },
    async saveRafieiCloudProject(project: RafieiCloudProject) {
        const payload = {
            id: project.id, user_id: project.userId, project_ref: project.projectRef,
            project_name: project.projectName, status: project.status, region: project.region,
            db_pass: project.dbPassword, publishable_key: project.publishableKey, secret_key: project.secretKey,
            created_at: new Date(project.createdAt).toISOString()
        };
        await supabase.from('rafiei_cloud_projects').upsert(payload);
    },

    async getProjectLogs(projectId: string) { return []; },

    mapProject(p: any): Project {
        return {
            id: p.id, userId: p.user_id, name: p.name,
            createdAt: new Date(p.created_at).getTime(),
            updatedAt: new Date(p.updated_at).getTime(),
            deletedAt: p.deleted_at ? new Date(p.deleted_at).getTime() : undefined,
            code: p.code || { html: '', javascript: '', css: '', explanation: '' },
            files: p.files || [],
            messages: p.messages || [],
            status: p.status || 'idle',
            buildState: p.build_state || null,
            publishedUrl: p.published_url,
            customDomain: p.custom_domain,
            rafieiCloudProject: p.rafiei_cloud_project,
            vercelConfig: p.vercel_config
        };
    }
};
