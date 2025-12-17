
// ... (keep all imports same)
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Project, RafieiCloudProject, ProjectFile, Domain, CreditLedgerEntry, FinancialStats, WebhookLog, SystemLog, CreditTransaction, AdminMetric, BuildState, BuildAudit, GeneratedCode, Message, AIDebugLog } from '../types';
import { GenerationSupervisor } from './geminiService';
import { translations, getCurrentLanguage, Language } from '../utils/translations';

type SupabaseUser = any;
type Session = any;

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

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined
    },
    // Add global fetch with timeout to prevent infinite hangs at the network layer
    global: {
        fetch: (url, options) => {
            return fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); // 20s hard timeout on requests
        }
    }
});

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

const dataURItoBlob = (dataURI: string): Blob => {
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], {type: mimeString});
};

const mapSupabaseUser = (u: SupabaseUser | null): User | null => {
    if (!u) return null;
    return {
        id: u.id,
        email: u.email || '',
        name: u.user_metadata?.full_name || u.email?.split('@')[0] || 'User',
        avatar: u.user_metadata?.avatar_url,
        credits_balance: -1, // Lazy load
        isAdmin: u.email === 'rezarafeie13@gmail.com',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at
    };
};

export const cloudService = {
    abortController: null as AbortController | null,

    async getCurrentUser(): Promise<User | null> {
        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                console.warn("Offline detected");
                return null;
            }

            const sessionPromise = (supabase.auth as any).getSession();
            const timeoutPromise = new Promise<{data: {session: null}, error: {message: string}}>((resolve) => 
                setTimeout(() => resolve({ data: { session: null }, error: { message: 'Timeout' } }), 15000)
            );

            const { data, error } = await Promise.race([sessionPromise, timeoutPromise]);
            
            if (error) {
                console.warn("Supabase session error:", error);
                return null;
            }
            return mapSupabaseUser(data.session?.user || null);
        } catch (e) {
            console.error("Critical Supabase Client Error in getCurrentUser:", e);
            if (e instanceof Error && e.message.includes('JSON')) {
                 try { localStorage.removeItem(`sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`); } catch(err) {}
            }
            return null;
        }
    },

    onAuthStateChange(callback: (user: User | null) => void) {
        const { data: { subscription } } = (supabase.auth as any).onAuthStateChange(async (event: any, session: any) => {
            const user = mapSupabaseUser(session?.user || null);
            if (user) {
                try {
                    this.getUserCredits(user.id).then(balance => {
                        user.credits_balance = balance;
                        callback({ ...user }); 
                    }).catch(() => {});
                } catch(e) {}
            }
            callback(user);
        });
        return { unsubscribe: () => subscription.unsubscribe() };
    },

    async getUserLanguage(userId: string): Promise<string> {
        try {
            const { data, error } = await supabase.from('user_settings').select('language').eq('user_id', userId).single();
            if (error) throw error;
            return data?.language || 'en';
        } catch (e) {
            return 'en';
        }
    },

    async saveUserLanguage(userId: string, lang: string): Promise<void> {
        await supabase.from('user_settings').upsert({ user_id: userId, language: lang });
    },

    async login(email: string, pass: string): Promise<User> {
        const { data, error } = await (supabase.auth as any).signInWithPassword({ email, password: pass });
        if (error) throw error;
        return mapSupabaseUser(data.user!)!;
    },

    async register(email: string, pass: string, name: string): Promise<User> {
        const { data, error } = await (supabase.auth as any).signUp({ 
            email, 
            password: pass,
            options: { data: { full_name: name } }
        });
        if (error) throw error;
        if (!data.user) throw new Error("Registration failed");
        
        await supabase.from('user_settings').upsert({ user_id: data.user.id });
        
        return mapSupabaseUser(data.user)!;
    },

    async signInWithGoogle() {
        const { error } = await (supabase.auth as any).signInWithOAuth({
            provider: 'google',
            options: { redirectTo: window.location.origin }
        });
        if (error) throw error;
    },

    async signInWithGitHub() {
        const { error } = await (supabase.auth as any).signInWithOAuth({
            provider: 'github',
            options: { redirectTo: window.location.origin }
        });
        if (error) throw error;
    },

    async logout() {
        await (supabase.auth as any).signOut();
    },

    async disconnectSession() {
        try {
            await Promise.race([
                (supabase.auth as any).signOut(),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (e) {
            console.warn("Sign out failed, forcing local storage clear", e);
        } finally {
            if (typeof window !== 'undefined') {
                const keysToRemove = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
                        keysToRemove.push(key);
                    }
                }
                keysToRemove.forEach(k => localStorage.removeItem(k));
            }
        }
    },

    // --- PROJECTS ---
    
    async getProjects(userId: string, limit?: number, offset?: number): Promise<Project[]> {
        let query = supabase.from('projects')
            .select('*')
            .eq('user_id', userId)
            .is('deleted_at', null)
            .order('updated_at', { ascending: false });
            
        if (limit !== undefined && offset !== undefined) {
            query = query.range(offset, offset + limit - 1);
        } else if (limit !== undefined) {
            query = query.limit(limit);
        }
            
        const { data, error } = await query;
        if (error) throw error;
        return data.map(this.mapProject);
    },

    async getTrashedProjects(userId: string, limit?: number, offset?: number): Promise<Project[]> {
        let query = supabase.from('projects')
            .select('*')
            .eq('user_id', userId)
            .not('deleted_at', 'is', null)
            .order('deleted_at', { ascending: false });
            
        if (limit !== undefined && offset !== undefined) {
            query = query.range(offset, offset + limit - 1);
        } else if (limit !== undefined) {
            query = query.limit(limit);
        }
            
        const { data, error } = await query;
        if (error) throw error;
        return data.map(this.mapProject);
    },

    async getTrashCount(userId: string): Promise<number> {
        const { count, error } = await supabase.from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('deleted_at', 'is', null);
        if (error) return 0;
        return count || 0;
    },

    async getProject(projectId: string): Promise<Project | null> {
        const { data, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
        if (error || !data) return null;
        return this.mapProject(data);
    },

    async getProjectByDomain(hostname: string): Promise<Project | null> {
        const fetchDomain = async () => {
            const { data: domainData } = await supabase.from('project_domains')
                .select('project_id')
                .eq('domain', hostname)
                .eq('status', 'verified')
                .single();
                
            let projectId = domainData?.project_id;

            if (!projectId) {
                 const { data: projData } = await supabase.from('projects')
                    .select('id')
                    .or(`custom_domain.eq.${hostname},published_url.ilike.%${hostname}%`)
                    .single();
                 projectId = projData?.id;
            }

            if (projectId) {
                return await this.getProject(projectId);
            }
            return null;
        };

        try {
            return await Promise.race([
                fetchDomain(),
                new Promise<null>(resolve => setTimeout(() => resolve(null), 8000))
            ]);
        } catch(e) {
            return null;
        }
    },

    async saveProject(project: Project): Promise<void> {
        const payload = {
            id: project.id,
            user_id: project.userId,
            name: project.name,
            updated_at: new Date().toISOString(),
            code: project.code,
            files: project.files,
            messages: project.messages,
            build_state: project.buildState,
            status: project.status,
            published_url: project.publishedUrl,
            custom_domain: project.customDomain,
            rafiei_cloud_project: project.rafieiCloudProject, 
            vercel_config: project.vercelConfig,
            deleted_at: project.deletedAt ? new Date(project.deletedAt).toISOString() : null
        };
        const { error } = await supabase.from('projects').upsert(payload);
        if (error) throw error;
    },

    async softDeleteProject(id: string): Promise<void> {
        await supabase.from('projects').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    },

    async restoreProject(id: string): Promise<void> {
        await supabase.from('projects').update({ deleted_at: null }).eq('id', id);
    },

    async deleteProject(id: string): Promise<void> {
        await supabase.from('projects').delete().eq('id', id);
    },

    async uploadBase64Image(userId: string, base64Data: string): Promise<string> {
        try {
            const blob = dataURItoBlob(base64Data);
            const ext = blob.type.split('/')[1] || 'png';
            const filename = `${userId}/${crypto.randomUUID()}.${ext}`;
            
            const { data, error } = await supabase.storage.from('chat_images').upload(filename, blob);
            
            if (error) throw error;
            
            const { data: publicData } = supabase.storage.from('chat_images').getPublicUrl(filename);
            return publicData.publicUrl;
        } catch (error) {
            console.error("Failed to upload base64 image:", error);
            throw error;
        }
    },

    async createProjectSkeleton(user: User, prompt: string, images: {url: string, base64: string}[]): Promise<string> {
        const processedImages: string[] = [];
        
        for (const img of images) {
            if (img.base64 && !img.base64.startsWith('http')) {
                try {
                    const publicUrl = await this.uploadBase64Image(user.id, img.base64);
                    processedImages.push(publicUrl);
                } catch (e) {
                    console.warn("Failed to upload initial image, skipping.", e);
                }
            } else if (img.url && !img.url.startsWith('blob:')) {
                processedImages.push(img.url);
            }
        }

        const newProject: Project = {
            id: crypto.randomUUID(),
            userId: user.id,
            name: "New Project", 
            createdAt: Date.now(),
            updatedAt: Date.now(),
            code: { html: '', javascript: '', css: '', explanation: '' },
            files: [],
            messages: [{
                id: crypto.randomUUID(),
                role: 'user',
                type: 'user_input', 
                content: prompt, 
                timestamp: Date.now(),
                images: processedImages
            }],
            status: 'idle',
            buildState: null
        };
        await this.saveProject(newProject);
        return newProject.id;
    },

    async createImportedProject(user: User, name: string, files: ProjectFile[]): Promise<string> {
        const newProject: Project = {
            id: crypto.randomUUID(),
            userId: user.id,
            name: name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            code: { html: '', javascript: '', css: '', explanation: 'Imported from GitHub' },
            files: files,
            messages: [],
            status: 'idle',
            buildState: null
        };
        await this.saveProject(newProject);
        return newProject.id;
    },

    // --- REALTIME ---
    subscribeToUserProjects(userId: string, callback: () => void) {
        const channel = supabase.channel(`user-projects-${userId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `user_id=eq.${userId}` }, callback)
            .subscribe();
        return { unsubscribe: () => supabase.removeChannel(channel) };
    },

    subscribeToProjectChanges(projectId: string, callback: (p: Project) => void) {
        const channel = supabase.channel(`project-${projectId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, async (payload) => {
                const p = await this.getProject(projectId);
                if (p) callback(p);
            })
            .subscribe();
        return { unsubscribe: () => supabase.removeChannel(channel) };
    },

    // --- BUILD PROCESS ---
    
    // Internal helper for common Supervisor callbacks
    createSupervisorCallbacks(currentProject: Project, updateLocalState: any, createOrUpdateBuildMessage: any, signal: AbortSignal, lang: Language, onAIDebugLog?: (log: AIDebugLog, messageId?: string) => void) {
        const t = (key: keyof typeof translations['en'], vars?: Record<string, string>) => {
            let str = (translations[lang] || translations['en'])[key] || key;
            if (vars) {
                Object.entries(vars).forEach(([k, v]) => {
                    str = str.replace(`{${k}}`, v ?? '');
                });
            }
            return str;
        };

        return {
            onPlanUpdate: async (phases: any) => {
                if (signal.aborted) return;
                const bs = currentProject.buildState || {} as any;
                const updated = updateLocalState({ 
                    buildState: { ...bs, phases, plan: phases.map((p: any) => p.title) } 
                });
                
                await createOrUpdateBuildMessage('build_plan', {
                    type: 'build_plan',
                    content: t('buildPlanTitle'),
                    planData: phases.map((p: any) => ({ title: p.title, status: 'pending' })),
                    status: 'completed',
                    icon: 'check',
                    isExpandable: true,
                    details: JSON.stringify(phases, null, 2)
                });

                try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Plan Update):", e); }
            },
            onMessage: async (msg: any) => {
                if (signal.aborted) return;
                let meta = {};
                if (msg.requiresAction === 'CONNECT_DATABASE') meta = { requires_database: true };
                const updatedMessages = [...currentProject.messages, msg];
                const updated = updateLocalState({ messages: updatedMessages }, meta);
                try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Narrator Message):", e); }
            },
            onBuildMessage: createOrUpdateBuildMessage, 
            onPhaseStart: async (index: number, phase: any) => {
                if (signal.aborted) return;
                const phaseTitle = phase.key ? t(phase.key as any) : phase.text || 'Untitled Phase';
                const bs = currentProject.buildState || {} as any;
                if(bs.phases && bs.phases[index]) bs.phases[index].status = 'active';
                updateLocalState({ 
                    buildState: { ...bs, currentPhaseIndex: index, currentStep: 0 } 
                });
                
                await createOrUpdateBuildMessage(`phase_${index}`, {
                    type: 'build_phase',
                    content: t('buildPhaseStart', { phaseTitle: phaseTitle }),
                    status: 'working',
                    icon: 'loader',
                    currentStepProgress: { current: 0, total: 1, stepName: "Starting..." }
                });
            },
            onPhaseComplete: async (index: number) => {
                if (signal.aborted) return;
                const bs = currentProject.buildState || {} as any;
                if(bs.phases && bs.phases[index]) bs.phases[index].status = 'completed';
                const updated = updateLocalState({ buildState: bs });
                
                await createOrUpdateBuildMessage(`phase_${index}`, {
                    type: 'build_phase',
                    content: bs.phases?.[index]?.title ? `${bs.phases[index].title} completed.` : "Phase completed.",
                    status: 'completed',
                    icon: 'check',
                    currentStepProgress: { current: 1, total: 1, stepName: "Completed" }
                });

                try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Phase Complete):", e); }
            },
            onStepStart: async (phaseIndex: number, step: any) => {
                if (signal.aborted) return;
                const stepName = step.key ? t(step.key as any, step.vars) : step.text || 'Untitled Step';
                const bs = currentProject.buildState || {} as any;
                const logs = bs.logs || [];
                updateLocalState({ buildState: { ...bs, logs: [...logs, stepName] } });
                
                await createOrUpdateBuildMessage(`phase_${phaseIndex}`, {
                    type: 'build_phase',
                    currentStepProgress: { 
                        current: bs.currentStep,
                        total: bs.totalSteps, 
                        stepName: stepName
                    },
                    status: 'working',
                    icon: 'loader'
                });
            },
            onStepComplete: async (phaseIndex: number, stepKeyOrName: string) => {
                if (signal.aborted) return;
                const stepName = t(stepKeyOrName as any) || stepKeyOrName;
                const bs = currentProject.buildState || {} as any;
                updateLocalState({ buildState: { ...bs, lastCompletedStep: phaseIndex, currentStep: (bs.currentStep || 0) + 1 } });
                
                await createOrUpdateBuildMessage(`phase_${phaseIndex}`, {
                    type: 'build_phase',
                    currentStepProgress: { 
                        current: (bs.currentStep || 0) + 1,
                        total: bs.totalSteps,
                        stepName: stepName
                    },
                    status: 'working', 
                    icon: 'loader'
                });
            },
            onChunkComplete: async (code: any, explanation: string, meta: any) => {
                if (signal.aborted) return;
                const updates: Partial<Project> = { code, status: 'generating' as const };
                if (meta?.files) updates.files = meta.files;
                updateLocalState(updates);
            },
            onSuccess: async (code: any, explanation: string, audit: any, meta: any) => {
                if (signal.aborted) return;
                
                const updates: Partial<Project> = { 
                    code, 
                    status: 'idle' as const, 
                    buildState: { ...currentProject.buildState, error: null, audit } as any
                };
                if (meta?.files) updates.files = meta.files;
                updateLocalState(updates);

                await createOrUpdateBuildMessage('final_summary', {
                    type: 'final_summary',
                    content: explanation, 
                    status: 'completed',
                    icon: 'check',
                    isExpandable: true,
                    details: JSON.stringify(audit, null, 2)
                });

                try { await this.saveProject(currentProject); } catch(e) { console.warn("Background save failed (Success):", e); }
            },
            onError: async (error: string, retries: number) => {
                if (signal.aborted) return;
                const bs = currentProject.buildState || {} as any;
                
                updateLocalState({ 
                    buildState: { ...bs, error: `Error: ${error} (Retrying... ${retries} attempts left)` } as any 
                });

                const retryMsg = retries > 0 ? `\n🔄 Retrying step (${4 - retries} of 3)...` : '';
                await createOrUpdateBuildMessage('build_warning', {
                    type: 'build_status',
                    content: t('buildWarning', { retryMsg }),
                    status: 'working',
                    icon: 'warning',
                    isExpandable: true,
                    details: error
                });
            },
            onFinalError: async (error: string, audit: any) => {
                if (signal.aborted) return;
                
                const updated = updateLocalState({ 
                    status: 'failed' as const, 
                    buildState: { ...currentProject.buildState, error, audit } as any
                });

                await createOrUpdateBuildMessage('build_error_final', {
                    type: 'build_error',
                    content: t('buildError', { error }),
                    status: 'failed',
                    icon: 'x',
                    isExpandable: true,
                    details: JSON.stringify(audit || { error: error }, null, 2)
                });
                
                try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Final Error):", e); }
            },
            onAIDebugLog: (log: AIDebugLog, messageId?: string) => {
                if (onAIDebugLog) onAIDebugLog(log, messageId);
                
                // Also update the message directly if messageId is provided
                if (messageId) {
                    const msgIndex = currentProject.messages.findIndex(m => m.id === messageId);
                    if (msgIndex !== -1) {
                        const updatedMessages = [...currentProject.messages];
                        const msg = updatedMessages[msgIndex];
                        const aiInteractions = msg.aiInteractions || [];
                        updatedMessages[msgIndex] = { ...msg, aiInteractions: [...aiInteractions, log] };
                        updateLocalState({ messages: updatedMessages });
                    }
                }
            }
        };
    },

    async triggerBuild(
        project: Project, 
        prompt: string, 
        images: { url: string; base64: string }[], 
        onUpdate: (p: Project, meta?: any) => void,
        isResume: boolean = false,
        onAIDebugLog?: (log: AIDebugLog, messageId?: string) => void
    ) {
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const supervisorImgs = images.map(i => i.base64 || i.url);
        let currentProject = { ...project };

        const userLang = getCurrentLanguage();
        const isFarsiPrompt = /[\u0600-\u06FF]/.test(prompt);
        const lang: Language = isFarsiPrompt ? 'fa' : userLang;
        
        const t = (key: keyof typeof translations['en'], vars?: Record<string, string>) => {
            let str = (translations[lang] || translations['en'])[key] || key;
            if (vars) Object.entries(vars).forEach(([k, v]) => { str = str.replace(`{${k}}`, v ?? ''); });
            return str;
        };

        const messageMap: Record<string, string> = {};

        const updateLocalState = (updates: Partial<Project>, meta?: any) => {
            currentProject = { ...currentProject, ...updates };
            onUpdate(currentProject, meta);
            return currentProject;
        };

        const createOrUpdateBuildMessage = async (logicalKey: string, message: Partial<Message>): Promise<Message> => {
            if (signal.aborted) throw new Error("ABORTED");

            const existingMessageIndex = currentProject.messages.findIndex(m => m.id === messageMap[logicalKey]);
            let updatedMessages = [...currentProject.messages];
            let msgId = messageMap[logicalKey] || crypto.randomUUID();

            if (existingMessageIndex !== -1) {
                const existingMsg = updatedMessages[existingMessageIndex];
                updatedMessages[existingMessageIndex] = {
                    ...existingMsg,
                    ...message,
                    id: msgId, 
                    timestamp: Date.now(), 
                    role: 'assistant', 
                    type: message.type || existingMsg.type 
                };
            } else {
                const newMsg: Message = {
                    id: msgId,
                    role: 'assistant',
                    timestamp: Date.now(),
                    status: 'pending',
                    content: message.content || '', 
                    ...message,
                };
                updatedMessages.push(newMsg);
            }
            messageMap[logicalKey] = msgId; 

            let meta = {};
            if (message.requiresAction === 'CONNECT_DATABASE') meta = { requires_database: true };

            const updated = updateLocalState({ messages: updatedMessages }, meta);
            try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Build Message):", e); }
            return updatedMessages.find(m => m.id === msgId)!; 
        };

        await createOrUpdateBuildMessage('build_intro', {
            type: 'build_status',
            content: t('buildIntro'),
            status: 'working',
            icon: 'sparkles'
        });

        await this.saveProject(currentProject);

        const callbacks = this.createSupervisorCallbacks(currentProject, updateLocalState, createOrUpdateBuildMessage, signal, lang, onAIDebugLog);

        const supervisor = new GenerationSupervisor(
            currentProject,
            prompt,
            supervisorImgs,
            callbacks,
            signal,
            lang
        );

        supervisor.start(isResume).catch(console.error);
    },

    async triggerRepair(
        project: Project, 
        error: string,
        onUpdate: (p: Project, meta?: any) => void,
        waitForPreview: (ms: number) => Promise<{success: boolean, error?: string}>,
        onAIDebugLog?: (log: AIDebugLog, messageId?: string) => void
    ) {
        if (this.abortController) this.abortController.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        let currentProject = { ...project };
        const userLang = getCurrentLanguage();
        const lang: Language = userLang;

        const messageMap: Record<string, string> = {};

        const updateLocalState = (updates: Partial<Project>, meta?: any) => {
            currentProject = { ...currentProject, ...updates };
            onUpdate(currentProject, meta);
            return currentProject;
        };

        const createOrUpdateBuildMessage = async (logicalKey: string, message: Partial<Message>): Promise<Message> => {
            if (signal.aborted) throw new Error("ABORTED");

            const existingMessageIndex = currentProject.messages.findIndex(m => m.id === messageMap[logicalKey]);
            let updatedMessages = [...currentProject.messages];
            let msgId = messageMap[logicalKey] || crypto.randomUUID();

            if (existingMessageIndex !== -1) {
                const existingMsg = updatedMessages[existingMessageIndex];
                updatedMessages[existingMessageIndex] = {
                    ...existingMsg,
                    ...message,
                    id: msgId, 
                    timestamp: Date.now(), 
                    role: 'assistant', 
                    type: message.type || existingMsg.type 
                };
            } else {
                const newMsg: Message = {
                    id: msgId,
                    role: 'assistant',
                    timestamp: Date.now(),
                    status: 'pending',
                    content: message.content || '', 
                    ...message,
                };
                updatedMessages.push(newMsg);
            }
            messageMap[logicalKey] = msgId; 

            const updated = updateLocalState({ messages: updatedMessages });
            try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Repair Message):", e); }
            return updatedMessages.find(m => m.id === msgId)!; 
        };

        const callbacks = this.createSupervisorCallbacks(currentProject, updateLocalState, createOrUpdateBuildMessage, signal, lang, onAIDebugLog);
        callbacks.waitForPreview = waitForPreview;

        const supervisor = new GenerationSupervisor(
            currentProject,
            "", 
            [],
            callbacks,
            signal,
            lang
        );

        supervisor.repair(error).catch(console.error);
    },

    stopBuild(projectId: string) {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    },

    async uploadChatImage(userId: string, tempId: string, file: File): Promise<string> {
        const path = `${userId}/${tempId}-${file.name}`;
        const { data, error } = await supabase.storage.from('chat_images').upload(path, file);
        if (error) {
            if (error.message.includes('Bucket not found') || (error as any).statusCode === '404') {
                console.debug("Image upload skipped (Bucket missing), using base64.");
            } else {
                console.warn("Image upload failed, using base64 fallback", error);
            }
            return fileToBase64(file);
        }
        const { data: publicData } = supabase.storage.from('chat_images').getPublicUrl(path);
        return publicData.publicUrl;
    },

    async getDomainsForProject(projectId: string): Promise<Domain[]> {
        const { data, error } = await supabase.from('project_domains').select('*').eq('project_id', projectId);
        if (error) throw error;
        return data.map((d: any) => ({
            id: d.id,
            domainName: d.domain,
            projectId: d.project_id,
            type: d.type,
            dnsRecordType: d.dns_record_type,
            dnsRecordValue: d.dns_record_value,
            status: d.status,
            updatedAt: new Date(d.updated_at).getTime()
        }));
    },

    async addDomain(projectId: string, userId: string, domain: string): Promise<void> {
        if (!domain.includes('.')) throw new Error("Invalid domain format");
        const type = domain.split('.').length > 2 ? 'subdomain' : 'root';
        const recordType = type === 'root' ? 'A' : 'CNAME';
        const recordValue = type === 'root' ? '76.76.21.21' : 'cname.vercel-dns.com';

        await supabase.from('project_domains').insert({
            project_id: projectId,
            domain,
            type,
            dns_record_type: recordType,
            dns_record_value: recordValue,
            status: 'pending'
        });
    },

    async deleteDomain(domainId: string): Promise<void> {
        await supabase.from('project_domains').delete().eq('id', domainId);
    },

    async verifyDomain(domainId: string): Promise<Domain> {
        await new Promise(r => setTimeout(r, 1500));
        const status = Math.random() > 0.3 ? 'verified' : 'error';
        const { data, error } = await supabase.from('project_domains').update({ status }).eq('id', domainId).select().single();
        if (error) throw error;
        if (status === 'verified') await supabase.from('projects').update({ custom_domain: data.domain }).eq('id', data.project_id);

        return {
            id: data.id,
            domainName: data.domain,
            projectId: data.project_id,
            type: data.type,
            dnsRecordType: data.dns_record_type,
            dnsRecordValue: data.dns_record_value,
            status: data.status,
            updatedAt: new Date(data.updated_at).getTime()
        };
    },

    async saveRafieiCloudProject(project: RafieiCloudProject) {
        const payload = {
            id: project.id,
            user_id: project.userId,
            project_ref: project.projectRef,
            project_name: project.projectName,
            status: project.status,
            region: project.region,
            db_pass: project.dbPassword,
            publishable_key: project.publishableKey,
            secret_key: project.secretKey
        };
        const { error } = await supabase.from('rafiei_cloud_projects').upsert(payload);
        if (error) throw error;
    },

    async getProjectLogs(projectId: string, limit: number = 100): Promise<SystemLog[]> {
        const { data, error } = await supabase
            .from('system_logs')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: false })
            .limit(limit);
        if (error) return [];
        return (data || []).map((l: any) => ({
            id: l.id,
            timestamp: new Date(l.created_at).getTime(),
            level: l.level,
            source: l.source,
            message: l.message,
            projectId: l.project_id,
            meta: l.meta
        }));
    },

    async checkTableExists(tableName: string): Promise<boolean> {
        const { error } = await supabase.from(tableName).select('id').limit(1);
        if (error && error.code === '42P01') return false; 
        return true;
    },

    async rpc(fn: string, params: any) {
        const { data, error } = await supabase.rpc(fn, params);
        if (error) throw error;
        return data;
    },

    async getAdminProjects(page = 1, limit = 10): Promise<{ data: Project[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await supabase
            .from('projects')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (error) throw error;
        return { data: (data || []).map(this.mapProject), count: count || 0 };
    },

    async getAdminUsers(page = 1, limit = 10): Promise<{ data: any[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await supabase
            .rpc('get_all_users', {}, { count: 'exact' })
            .range(from, to);
        if (error) throw error;
        return { data: data || [], count: count || 0 };
    },

    async searchUsers(query: string): Promise<any[]> {
        const { data, error } = await supabase.rpc('get_all_users').ilike('email', `%${query}%`).limit(5);
        if (error) throw error;
        return data || [];
    },

    async getSystemLogs(page = 1, limit = 10): Promise<{ data: SystemLog[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await supabase
            .from('system_logs')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (error) return { data: [], count: 0 };
        const logs = (data || []).map((l: any) => ({
            id: l.id,
            timestamp: new Date(l.created_at).getTime(),
            level: l.level,
            source: l.source,
            message: l.message,
            projectId: l.project_id,
            meta: l.meta
        }));
        return { data: logs, count: count || 0 };
    },

    async getFinancialStats(): Promise<FinancialStats | null> {
        const { data: ledger } = await supabase.from('credit_ledger').select('credits_deducted, raw_cost_usd, input_tokens, output_tokens');
        const { data: transactions } = await supabase.from('credit_transactions').select('amount').eq('type', 'purchase');
        if (!ledger || !transactions) return null;

        const totalRevenueCredits = ledger.reduce((sum, row) => sum + (Number(row.credits_deducted) || 0), 0);
        const totalCostUsd = ledger.reduce((sum, row) => sum + (Number(row.raw_cost_usd) || 0), 0);
        const totalCreditsPurchased = transactions.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
        const revenueUsd = totalRevenueCredits / 10;
        const netProfitUsd = revenueUsd - totalCostUsd;
        const totalInput = ledger.reduce((sum, row) => sum + (Number(row.input_tokens) || 0), 0);
        const totalOutput = ledger.reduce((sum, row) => sum + (Number(row.output_tokens) || 0), 0);

        return {
            totalRevenueCredits,
            totalCostUsd,
            netProfitUsd,
            totalCreditsPurchased,
            currentMargin: 50, 
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            totalRequestCount: ledger.length
        };
    },

    async getLedger(page = 1, limit = 10): Promise<{ data: CreditLedgerEntry[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await supabase
            .from('credit_ledger')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (error) return { data: [], count: 0 };
        const ledger = (data || []).map((row: any) => ({
            id: row.id,
            userId: row.user_id,
            projectId: row.project_id,
            operationType: row.operation_type,
            model: row.model,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            rawCostUsd: row.raw_cost_usd,
            profitMargin: row.profit_margin,
            creditsDeducted: row.credits_deducted,
            createdAt: new Date(row.created_at).getTime(),
            meta: row.meta 
        }));
        return { data: ledger, count: count || 0 };
    },

    async getSystemSetting(key: string): Promise<string | null> {
        const { data } = await supabase.from('system_settings').select('value').eq('key', key).single();
        return data?.value || null;
    },

    async getSystemSettings(keys: string[]) {
        const { data, error } = await supabase.from('system_settings').select('key, value').in('key', keys);
        if (error) throw error;
        return data;
    },

    async setSystemSetting(key: string, value: string): Promise<void> {
        const { error } = await supabase.from('system_settings').upsert({ key, value });
        if (error) throw error;
    },

    async getWebhookLogs(page = 1, limit = 10): Promise<{ data: WebhookLog[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        const { data, count, error } = await supabase
            .from('webhook_logs')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to);
        if (error) return { data: [], count: 0 };
        return { data: data as WebhookLog[], count: count || 0 };
    },

    async getUserCredits(userId: string): Promise<number> {
        const { data } = await supabase.from('user_settings').select('credits_balance').eq('user_id', userId).single();
        return data?.credits_balance !== undefined ? data.credits_balance : 0;
    },

    async getUserFinancialOverview(userId: string) {
        const { data: txs } = await supabase.from('credit_transactions').select('amount').eq('user_id', userId).eq('type', 'purchase');
        const { data: usage } = await supabase.from('credit_ledger').select('credits_deducted, raw_cost_usd').eq('user_id', userId);
        const totalPurchased = txs?.reduce((sum, t) => sum + Number(t.amount), 0) || 0;
        const totalSpent = usage?.reduce((sum, u) => sum + Number(u.credits_deducted), 0) || 0;
        const totalCost = usage?.reduce((sum, u) => sum + Number(u.raw_cost_usd), 0) || 0;
        const revenueUsd = totalSpent / 10;
        const profitGenerated = revenueUsd - totalCost;
        return { totalPurchased, totalSpent, totalCost, profitGenerated };
    },

    async getUserTransactions(userId: string): Promise<CreditTransaction[]> {
        const { data, error } = await supabase.from('credit_transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (error) return [];
        return data.map((t: any) => ({
            id: t.id,
            userId: t.user_id,
            amount: Number(t.amount),
            type: t.type,
            currency: t.currency,
            exchangeRate: Number(t.exchange_rate),
            paymentId: t.payment_id,
            description: t.description,
            createdAt: new Date(t.created_at).getTime()
        }));
    },

    async adminAdjustCredit(userId: string, amount: number, note: string): Promise<void> {
        const { error } = await supabase.rpc('admin_adjust_balance', {
            p_target_user_id: userId,
            p_amount: amount,
            p_description: note
        });
        if (error) throw error;
    },

    mapProject(p: any): Project {
        return {
            id: p.id,
            userId: p.user_id,
            name: p.name,
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
            rafieiCloudProject: p.rafiei_cloud_project ? {
                id: p.rafiei_cloud_project.id,
                userId: p.rafiei_cloud_project.user_id || p.rafiei_cloud_project.userId,
                projectRef: p.rafiei_cloud_project.project_ref || p.rafiei_cloud_project.projectRef,
                projectName: p.rafiei_cloud_project.project_name || p.rafiei_cloud_project.projectName,
                status: p.rafiei_cloud_project.status,
                region: p.rafiei_cloud_project.region,
                dbPassword: p.rafiei_cloud_project.db_pass || p.rafiei_cloud_project.dbPassword,
                publishableKey: p.rafiei_cloud_project.publishable_key || p.rafiei_cloud_project.publishableKey,
                secretKey: p.rafiei_cloud_project.secret_key || p.rafiei_cloud_project.secretKey,
                createdAt: new Date(p.rafiei_cloud_project.created_at || Date.now()).getTime()
            } : undefined,
            vercelConfig: p.vercel_config
        };
    }
};
