
// ... existing imports
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Project, RafieiCloudProject, ProjectFile, Domain, CreditLedgerEntry, FinancialStats, WebhookLog, SystemLog, CreditTransaction, AdminMetric, BuildState, BuildAudit, GeneratedCode, Message } from '../types';
import { GenerationSupervisor } from './geminiService';
import { translations, getCurrentLanguage, Language } from '../utils/translations';

type SupabaseUser = any;
type Session = any;

// ... (existing helper functions and setup) ...
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

    // ... (AUTH METHODS same as before) ...
    async getCurrentUser(): Promise<User | null> {
        try {
            // 1. Quick check for network
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                console.warn("Offline detected");
                return null;
            }

            const sessionPromise = (supabase.auth as any).getSession();
            // Increased timeout to 15s to handle slow connections
            const timeoutPromise = new Promise<{data: {session: null}, error: {message: string}}>((resolve) => 
                setTimeout(() => resolve({ data: { session: null }, error: { message: 'Timeout' } }), 15000)
            );

            const { data, error } = await Promise.race([sessionPromise, timeoutPromise]);
            
            if (error) {
                console.warn("Supabase session error:", error);
                // Do NOT disconnect session here. It causes a loop.
                // Just return null to indicate "could not verify user".
                return null;
            }
            return mapSupabaseUser(data.session?.user || null);
        } catch (e) {
            console.error("Critical Supabase Client Error in getCurrentUser:", e);
            // Only clear token if it's strictly a parsing error to recover
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
                    // Non-blocking credit fetch
                    this.getUserCredits(user.id).then(balance => {
                        user.credits_balance = balance;
                        callback({ ...user }); // Trigger update with balance
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

    // Fast creation for immediate feedback
    async createProjectSkeleton(user: User, prompt: string, images: {url: string, base64: string}[]): Promise<string> {
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
                type: 'user_input', // Set specific type
                content: prompt, // Content is now optional in Message, but provided here
                timestamp: Date.now(),
                images: images.map(i => i.url)
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
    async triggerBuild(
        project: Project, 
        prompt: string, 
        images: { url: string; base64: string }[], 
        onUpdate: (p: Project, meta?: any) => void
    ) {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const supervisorImgs = images.map(i => i.base64 || i.url);
        let currentProject = { ...project };

        const userLang = getCurrentLanguage();
        const isFarsiPrompt = /[\u0600-\u06FF]/.test(prompt);
        const lang: Language = isFarsiPrompt ? 'fa' : userLang;
        
        const t = (key: keyof typeof translations['en'], vars?: Record<string, string>) => {
            let str = (translations[lang] || translations['en'])[key] || key;
            if (vars) {
                Object.entries(vars).forEach(([k, v]) => {
                    str = str.replace(`{${k}}`, v ?? '');
                });
            }
            return str;
        };

        // This map keeps track of the actual message IDs for each logical key, preventing duplication
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
                // Update existing message
                const existingMsg = updatedMessages[existingMessageIndex];
                updatedMessages[existingMessageIndex] = {
                    ...existingMsg,
                    ...message,
                    id: msgId, // Ensure ID is consistent
                    timestamp: Date.now(), // Update timestamp to show recency
                    role: 'assistant', // Always assistant for build messages
                    type: message.type || existingMsg.type // Keep existing type if not overridden
                };
            } else {
                // Create new message
                const newMsg: Message = {
                    id: msgId,
                    role: 'assistant',
                    timestamp: Date.now(),
                    status: 'pending',
                    // Default content for new message if not explicitly provided (important with optional `content`)
                    content: message.content || '', 
                    ...message,
                };
                updatedMessages.push(newMsg);
            }
            messageMap[logicalKey] = msgId; // Store/update mapping

            // Ensure we pass meta if this is a blocking action
            let meta = {};
            if (message.requiresAction === 'CONNECT_DATABASE') {
                meta = { requires_database: true };
            }

            const updated = updateLocalState({ messages: updatedMessages }, meta);
            try { 
                await this.saveProject(updated); 
            } catch(e) { 
                console.warn("Background save failed (Build Message):", e); 
            }
            return updatedMessages.find(m => m.id === msgId)!; // Return the full updated message
        };

        // --- Initial Build Intro Message ---
        await createOrUpdateBuildMessage('build_intro', {
            type: 'build_status',
            content: t('buildIntro'),
            status: 'working',
            icon: 'sparkles'
        });

        // Ensure the project state (especially cloud connection status) is persisted
        // before starting the supervisor. This is CRITICAL for the supervisor to get the latest info.
        await this.saveProject(currentProject);

        const supervisor = new GenerationSupervisor(
            currentProject,
            prompt,
            supervisorImgs,
            {
                onPlanUpdate: async (phases) => {
                    if (signal.aborted) return;
                    const bs = currentProject.buildState || {} as any;
                    const updated = updateLocalState({ 
                        buildState: { ...bs, phases, plan: phases.map(p => p.title) } 
                    });
                    
                    await createOrUpdateBuildMessage('build_plan', {
                        type: 'build_plan',
                        content: t('buildPlanTitle'),
                        planData: phases.map(p => ({ title: p.title, status: 'pending' })),
                        status: 'completed',
                        icon: 'check',
                        isExpandable: true,
                        details: JSON.stringify(phases, null, 2)
                    });

                    try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Plan Update):", e); }
                },
                onMessage: async (msg) => {
                    if (signal.aborted) return;
                    let meta = {};
                    if (msg.requiresAction === 'CONNECT_DATABASE') {
                        meta = { requires_database: true };
                    }
                    // This is for custom one-off messages, e.g., action_required
                    const updatedMessages = [...currentProject.messages, msg];
                    const updated = updateLocalState({ messages: updatedMessages }, meta);
                    try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Narrator Message):", e); }
                },
                onBuildMessage: createOrUpdateBuildMessage, // Pass the new helper
                onPhaseStart: async (index, phase) => {
                    if (signal.aborted) return;
                    const phaseTitle = phase.key ? t(phase.key as any) : phase.text || 'Untitled Phase';
                    const bs = currentProject.buildState || {} as any;
                    if(bs.phases && bs.phases[index]) bs.phases[index].status = 'active';
                    updateLocalState({ 
                        buildState: { ...bs, currentPhaseIndex: index, currentStep: 0 } // Reset step counter for new phase
                    });
                    
                    // Create/update phase message
                    await createOrUpdateBuildMessage(`phase_${index}`, {
                        type: 'build_phase',
                        content: t('buildPhaseStart', { phaseTitle: phaseTitle }),
                        status: 'working',
                        icon: 'loader',
                        // Fix: Changed 'progress' to 'currentStepProgress'
                        currentStepProgress: { current: 0, total: 1, stepName: "Starting..." }
                    });
                },
                onPhaseComplete: async (index) => {
                    if (signal.aborted) return;
                    const bs = currentProject.buildState || {} as any;
                    if(bs.phases && bs.phases[index]) bs.phases[index].status = 'completed';
                    const updated = updateLocalState({ buildState: bs });
                    
                    // Update phase message to completed
                    await createOrUpdateBuildMessage(`phase_${index}`, {
                        type: 'build_phase',
                        content: bs.phases?.[index]?.title ? `${bs.phases[index].title} completed.` : "Phase completed.",
                        status: 'completed',
                        icon: 'check',
                        // Fix: Changed 'progress' to 'currentStepProgress'
                        currentStepProgress: { current: 1, total: 1, stepName: "Completed" }
                    });

                    try { await this.saveProject(updated); } catch(e) { console.warn("Background save failed (Phase Complete):", e); }
                },
                onStepStart: async (phaseIndex, step) => {
                    if (signal.aborted) return;
                    const stepName = step.key ? t(step.key as any, step.vars) : step.text || 'Untitled Step';
                    const bs = currentProject.buildState || {} as any;
                    const logs = bs.logs || [];
                    updateLocalState({ buildState: { ...bs, logs: [...logs, stepName] } });
                    
                    // Update the current phase message with step progress
                    await createOrUpdateBuildMessage(`phase_${phaseIndex}`, {
                        type: 'build_phase', // Keep type as phase
                        // Content will be updated by supervisor directly
                        currentStepProgress: { // New field to track current step in phase
                            current: bs.currentStep,
                            total: bs.totalSteps, // supervisor will update total steps
                            stepName: stepName
                        },
                        status: 'working',
                        icon: 'loader'
                    });
                },
                onStepComplete: async (phaseIndex, stepKeyOrName) => {
                    if (signal.aborted) return;
                    const stepName = t(stepKeyOrName as any) || stepKeyOrName;
                    const bs = currentProject.buildState || {} as any;
                    updateLocalState({ buildState: { ...bs, lastCompletedStep: phaseIndex, currentStep: (bs.currentStep || 0) + 1 } });
                    
                    // Update the current phase message with step progress
                    await createOrUpdateBuildMessage(`phase_${phaseIndex}`, {
                        type: 'build_phase', // Keep type as phase
                        // Content will be updated by supervisor directly
                        currentStepProgress: { // New field to track current step in phase
                            current: (bs.currentStep || 0) + 1,
                            total: bs.totalSteps,
                            stepName: stepName
                        },
                        status: 'working', // Still working on the phase
                        icon: 'loader'
                    });
                },
                onChunkComplete: async (code, explanation, meta) => {
                    if (signal.aborted) return;
                    const updates: Partial<Project> = { code, status: 'generating' as const };
                    if (meta?.files) updates.files = meta.files;
                    updateLocalState(updates);
                    // This no longer sends a chat message
                },
                onSuccess: async (code, explanation, audit, meta) => {
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
                        content: explanation, // Use the dynamic summary passed from supervisor
                        status: 'completed',
                        icon: 'check',
                        isExpandable: true,
                        details: JSON.stringify(audit, null, 2)
                    });

                    try { await this.saveProject(currentProject); } catch(e) { console.warn("Background save failed (Success):", e); }
                },
                onError: async (error, retries) => {
                    if (signal.aborted) return;
                    const bs = currentProject.buildState || {} as any;
                    const currentLogs = bs.logs || [];
                    
                    updateLocalState({ 
                        buildState: { ...bs, error: `Error: ${error} (Retrying... ${retries} attempts left)` } as any 
                    });

                    const retryMsg = retries > 0 ? `\n🔄 Retrying step (${4 - retries} of 3)...` : '';
                    await createOrUpdateBuildMessage('build_warning', {
                        type: 'build_status',
                        content: t('buildWarning', { retryMsg }),
                        status: 'working', // Keep working for retries
                        icon: 'warning',
                        isExpandable: true,
                        details: error
                    });
                },
                onFinalError: async (error, audit) => {
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
                }
            },
            signal,
            lang // Pass the determined language to the supervisor
        );

        supervisor.start().catch(console.error);
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

    // ... (rest of methods)
    
    // --- DOMAINS ---
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
        
        if (status === 'verified') {
            await supabase.from('projects').update({ custom_domain: data.domain }).eq('id', data.project_id);
        }

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

    // --- RAFIEI CLOUD ---
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

    // --- ADMIN & SYSTEM (Paginated) ---
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
        if (error) {
            if (error.code === '42P01') return false; 
        }
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
        return { 
            data: (data || []).map(this.mapProject), 
            count: count || 0 
        };
    },

    async getAdminUsers(page = 1, limit = 10): Promise<{ data: any[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        
        // Use RPC with range for pagination if supported, otherwise fallback to simple fetch logic
        // Assuming 'get_all_users' returns a setof record/table which allows chaining range
        const { data, count, error } = await supabase
            .rpc('get_all_users', {}, { count: 'exact' })
            .range(from, to);
            
        if (error) throw error;
        return { data: data || [], count: count || 0 };
    },

    // New method for searching users by email (admin only)
    async searchUsers(query: string): Promise<any[]> {
        const { data, error } = await supabase
            .rpc('get_all_users')
            .ilike('email', `%${query}%`)
            .limit(5);
            
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
        // This still requires aggregate data, so we don't paginate here.
        // It's a summary endpoint.
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

    // New helper to fetch multiple settings efficiently
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

    // Fixed: Removed 'adminEmail' param to match updated SQL
    async adminAdjustCredit(userId: string, amount: number, note: string): Promise<void> {
        const { error } = await supabase.rpc('admin_adjust_balance', {
            p_target_user_id: userId,
            p_amount: amount,
            p_description: note
        });
        
        if (error) {
            console.error("RPC admin_adjust_balance failed:", error);
            throw error;
        }
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
                // Handle both snake_case (DB row) and camelCase (JSONB object) keys
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
