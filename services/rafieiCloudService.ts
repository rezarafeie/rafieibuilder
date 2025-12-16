
import { RafieiCloudProject, User, Project } from '../types';
import { cloudService } from './cloudService';
import { webhookService } from './webhookService';

// SECURITY WARNING: In a production environment, this key should NEVER be exposed on the client.
// Updated Key provided by user
const SUPABASE_MANAGEMENT_KEY = 'sbp_a3f692cb403185ff2a4d2ff35da699bb0977c988';
const MANAGEMENT_API_URL = 'https://api.supabase.com/v1';

/**
 * --- STRICT API ROUTER ---
 * Prevents Token Mismatch by enforcing strict separation of Management vs Project concerns.
 */

// 1. Management API Surface (Requires PAT)
const requestManagement = async (path: string, method: string, body?: any) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    let url = `${MANAGEMENT_API_URL}${cleanPath}`;
    
    // Add cache buster to prevent proxy from serving stale "not ready" responses
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}ts=${Date.now()}`;
    
    // Strict Proxy Logic for Browser Environments
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

    const response = await fetch(proxyUrl, {
        method,
        headers: {
            'Authorization': `Bearer ${SUPABASE_MANAGEMENT_KEY}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        // Parse JSON error if possible for cleaner messages
        let errorDetails = text;
        try {
            const json = JSON.parse(text);
            errorDetails = json.message || json.error || text;
        } catch (e) {} // ignore json parse error

        throw new Error(`Management API Error (${response.status}): ${errorDetails}`);
    }

    if (response.status === 204) return {};
    return await response.json();
};

// 2. Project Data API Surface (Requires Project Secret/Anon Key)
const requestProject = async (projectRef: string, path: string, method: string, apiKey: string, body?: any) => {
    // Guardrail: Never send PAT to project endpoint
    if (apiKey.startsWith('sbp_')) throw new Error("SECURITY VIOLATION: Attempted to use Management Token on Project API.");

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const url = `https://${projectRef}.supabase.co${cleanPath}`;
    
    const response = await fetch(url, {
        method,
        headers: {
            'apikey': apiKey,
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Project API Error (${response.status}): ${text}`);
    }
    
    return await response.json();
};

const generateStrongPassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < 16; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
};

// Singleton map to track active monitoring loops in memory to prevent duplicate polling
const activeMonitors: Record<string, boolean> = {};

// Helper to handle inconsistent API return types for SQL queries
const parseSqlResult = (res: any) => {
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.result)) return res.result;
    return [];
};

export const rafieiCloudService = {
    
    // --- BACKGROUND JOBS (PROVISIONING) ---

    /**
     * Creates a standalone cloud project for the user (Global Backend).
     */
    async createProject(user: User): Promise<RafieiCloudProject> {
        const dbPass = generateStrongPassword();
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        const projectName = `RafieiGlobal-${uniqueSuffix}`;

        try {
            // 1. Get Org ID
            const orgs = await requestManagement('/organizations', 'GET');
            if (!orgs || orgs.length === 0) throw new Error("No Supabase Organizations found for this account.");
            const orgId = orgs[0].id;

            // 2. Create Project via Management API
            const projectData = await requestManagement('/projects', 'POST', {
                name: projectName,
                organization_id: orgId,
                db_pass: dbPass,
                plan: 'free',
                region: 'us-east-1'
            });

            if (!projectData || !projectData.id) {
                throw new Error("Failed to receive valid project ID from Supabase API.");
            }

            const newCloudProject: RafieiCloudProject = {
                id: crypto.randomUUID(),
                userId: user.id,
                projectRef: projectData.id, 
                projectName: projectData.name,
                region: projectData.region,
                status: 'CREATING',
                dbPassword: dbPass,
                createdAt: Date.now()
            };

            // 3. Save initial state to DB
            await cloudService.saveRafieiCloudProject(newCloudProject);

            // 4. Start Background Monitoring
            this.monitorProvisioning(newCloudProject).catch(console.error);

            return newCloudProject;
        } catch (error: any) {
            console.error("Create Global Project Failed:", error);
            if (error.message && error.message.includes('402')) {
                throw new Error("Organization limit reached. Supabase Free Plan allows only 2 projects. Please pause/delete an old project.");
            }
            throw error;
        }
    },

    /**
     * Initiates the provisioning process and returns immediately.
     * The monitoring happens in the background.
     */
    async provisionProject(user: User, mainProject: Project): Promise<RafieiCloudProject> {
        const dbPass = generateStrongPassword();
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        const projectName = `RafieiApp-${uniqueSuffix}`;
        
        webhookService.send('cloud.connection_requested', {}, { project_id: mainProject.id }, user);

        try {
            // 1. Get Org ID
            const orgs = await requestManagement('/organizations', 'GET');
            if (!orgs || orgs.length === 0) throw new Error("No Supabase Organizations found for this account.");
            const orgId = orgs[0].id;

            // 2. Create Project via Management API
            const projectData = await requestManagement('/projects', 'POST', {
                name: projectName,
                organization_id: orgId,
                db_pass: dbPass,
                plan: 'free',
                region: 'us-east-1'
            });

            if (!projectData || !projectData.id) {
                throw new Error("Failed to receive valid project ID from Supabase API.");
            }

            const newCloudProject: RafieiCloudProject = {
                id: crypto.randomUUID(),
                userId: user.id,
                projectRef: projectData.id, 
                projectName: projectData.name,
                region: projectData.region,
                status: 'CREATING',
                dbPassword: dbPass,
                createdAt: Date.now()
            };

            // 3. Save initial state to DB
            const updatedProject = { ...mainProject, rafieiCloudProject: newCloudProject };
            await cloudService.saveRafieiCloudProject(newCloudProject);
            await cloudService.saveProject(updatedProject);

            // 4. Start Background Monitoring (Do not await this)
            this.monitorProvisioning(newCloudProject, mainProject.id).catch(console.error);

            return newCloudProject;
        } catch (error: any) {
            console.error("Create Project Failed:", error);
            webhookService.send('cloud.connection_failed', { error: error.message }, { project_id: mainProject.id }, user);
            if (error.message.includes('402')) {
                throw new Error("Organization limit reached. Supabase Free Plan allows only 2 projects. Please pause/delete an old project.");
            }
            throw error;
        }
    },

    /**
     * Stop monitoring a specific project ID.
     * This effectively cancels the background wait loop.
     */
    cancelMonitoring(cloudProjectId: string) {
        if (activeMonitors[cloudProjectId]) {
            delete activeMonitors[cloudProjectId];
            console.log(`[Background Job] Cancellation requested for ${cloudProjectId}`);
        }
    },

    /**
     * Background looper that checks status and updates DB.
     * Resilient to navigation (keeps running in JS context) and Tab Closure (can be restarted on mount).
     */
    async monitorProvisioning(cloudProject: RafieiCloudProject, mainProjectId?: string): Promise<void> {
        if (activeMonitors[cloudProject.id]) return; // Already monitoring
        activeMonitors[cloudProject.id] = true;

        console.log(`[Background Job] Starting provisioning monitor for ${cloudProject.projectName} (${cloudProject.projectRef})`);

        const startTime = Date.now();
        const timeout = 600000; // 10 minutes (Increased to account for cold starts/DNS)
        let currentStatus = { ...cloudProject };

        try {
            while (Date.now() - startTime < timeout) {
                // Check Cancellation
                if (!activeMonitors[cloudProject.id]) {
                    console.log(`[Background Job] Monitoring stopped/cancelled for ${cloudProject.id}`);
                    return;
                }

                // Sync status from Supabase Management API
                // synced contains status='ACTIVE' if keys are found, BUT we don't trust it yet for the UI.
                const synced = await this.syncProjectStatus(currentStatus);
                
                // If keys appeared, update our local object
                if (synced.secretKey) currentStatus.secretKey = synced.secretKey;
                if (synced.publishableKey) currentStatus.publishableKey = synced.publishableKey;

                // --- CHECK API READINESS (DNS & SERVER) ---
                if (currentStatus.secretKey && currentStatus.publishableKey) {
                    console.log(`[Background Job] Keys found. Verifying Data API Reachability...`);
                    
                    const apiReady = await this.waitForPostgrest(currentStatus.projectRef, currentStatus.secretKey);
                    
                    if (apiReady) {
                        console.log(`[Background Job] Data API is ready. Configuring Auth...`);
                        
                        // --- CRITICAL AUTH BOOTSTRAP ---
                        try {
                            await this.configureAuthDefaults(currentStatus.projectRef);
                            console.log(`[Background Job] Auth defaults configured.`);
                        } catch (authError: any) {
                             console.warn(`[Background Job] Auth config warning (non-fatal):`, authError);
                        }
                        
                        // --- SUCCESS STATE ---
                        currentStatus.status = 'ACTIVE';
                        
                        // Save Final ACTIVE State
                        await cloudService.saveRafieiCloudProject(currentStatus);
                        if (mainProjectId) {
                            const mainProject = await cloudService.getProject(mainProjectId);
                            if (mainProject) {
                                await cloudService.saveProject({ ...mainProject, rafieiCloudProject: currentStatus });
                            }
                        }

                        console.log(`[Background Job] Project ${currentStatus.projectName} is fully active.`);
                        break; // Exit loop
                    } else {
                        console.log(`[Background Job] Data API not reachable yet. Waiting for DNS propagation...`);
                    }
                }

                // If keys are found but not ready yet, update DB with keys but KEEP status 'CREATING'
                // This prevents UI from showing "Cloud Connected" prematurely.
                if (currentStatus.secretKey && currentStatus.status !== 'ACTIVE') {
                    // We save the keys so they persist, but we keep status CREATING so the UI shows spinner.
                    const intermediateState = { ...currentStatus, status: 'CREATING' };
                    await cloudService.saveRafieiCloudProject(intermediateState);
                }

                // Stop if Supabase reports failure explicitly
                if (synced.status === 'FAILED') {
                    throw new Error("Supabase reported project creation failed (FAILED status).");
                }

                // Wait 10 seconds before next check
                await new Promise(r => setTimeout(r, 10000));
            }

            // Timeout Handling
            if (Date.now() - startTime >= timeout) {
                throw new Error("Provisioning timed out. The project took too long to become reachable.");
            }

        } catch (error: any) {
            console.error(`[Background Job] Monitoring failed:`, error);
            
            // Update DB with Error State so UI doesn't hang forever
            currentStatus.status = 'FAILED';
            await cloudService.saveRafieiCloudProject(currentStatus);
            if (mainProjectId) {
                const mainProject = await cloudService.getProject(mainProjectId);
                if (mainProject) {
                    await cloudService.saveProject({ ...mainProject, rafieiCloudProject: currentStatus });
                }
            }

        } finally {
            delete activeMonitors[cloudProject.id];
        }
    },

    // --- READINESS & HEALTH ---

    /**
     * Polls the Management API Health endpoint.
     */
    async checkInfrastructureHealth(projectRef: string): Promise<boolean> {
        try {
            const health = await requestManagement(`/projects/${projectRef}/health?services=db&services=auth`, 'GET');
            if (!Array.isArray(health)) return false;
            
            const dbHealthy = health.find((s: any) => s.name === 'db')?.status === 'ACTIVE_HEALTHY';
            const authHealthy = health.find((s: any) => s.name === 'auth')?.status === 'ACTIVE_HEALTHY';
            return dbHealthy && authHealthy;
        } catch (e) {
            return false;
        }
    },

    /**
     * Polls the actual Project Data API (PostgREST).
     */
    async waitForPostgrest(projectRef: string, apiKey: string): Promise<boolean> {
        // Quick check
        try {
            // Using AbortController to enforce timeout on the fetch itself
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 5000);
            
            const res = await fetch(`https://${projectRef}.supabase.co/rest/v1/`, {
                method: 'GET',
                headers: { 'apikey': apiKey },
                signal: controller.signal
            });
            
            clearTimeout(id);
            
            // PostgREST root usually returns documentation or 200 OK
            if (res.ok) return true;
        } catch (e) {
            // Network error (DNS, connection refused, timeout)
        }
        return false;
    },

    async syncProjectStatus(project: RafieiCloudProject): Promise<RafieiCloudProject> {
        // If we are already fully configured locally, just return.
        if (project.status === 'ACTIVE' && project.publishableKey && project.secretKey) return project;

        // 1. Check Infra Health
        const isHealthy = await this.checkInfrastructureHealth(project.projectRef);
        if (!isHealthy) return project; // Still provisioning infra

        // 2. Fetch Keys
        try {
            const keys = await requestManagement(`/projects/${project.projectRef}/api-keys`, 'GET');
            
            const anonKey = keys.find((k: any) => k.name === 'anon' || k.tags?.includes('anon'))?.api_key;
            const serviceKey = keys.find((k: any) => k.name === 'service_role' || k.tags?.includes('service_role'))?.api_key;

            if (anonKey && serviceKey) {
                return {
                    ...project,
                    // Note: We return ACTIVE here as 'platform status', but monitorProvisioning decides when to persist it
                    status: 'ACTIVE', 
                    publishableKey: anonKey,
                    secretKey: serviceKey
                };
            }
        } catch (e) {
            console.error("Failed to sync keys", e);
        }

        return project;
    },

    // --- ADMIN OPERATIONS (Management API - PAT) ---

    async executeSql(projectRef: string, sql: string) {
        return requestManagement(`/projects/${projectRef}/database/query`, 'POST', { query: sql });
    },

    // --- CONFIGURATION OPERATIONS ---
    
    async configureAuthDefaults(projectRef: string) {
        // Disables friction points (email confirmation, etc.) so AI apps work instantly.
        console.log(`[Auth Config] Applying friction-free defaults for ${projectRef}...`);
        const body = {
            enable_confirmations: false,
            enable_email_signup: true,
            enable_email_autoconfirm: true,
            enable_magic_link: false,
            enable_phone_signup: false,
            enable_phone_confirmations: false,
            enable_anonymous_sign_ins: false
        };
        return requestManagement(`/projects/${projectRef}/config/auth`, 'PATCH', body);
    },
    
    async getAuthConfiguration(projectRef: string) {
        return requestManagement(`/projects/${projectRef}/config/auth`, 'GET');
    },

    async updateAuthConfiguration(projectRef: string, config: any) {
        return requestManagement(`/projects/${projectRef}/config/auth`, 'PATCH', config);
    },

    async getProjectHealth(projectRef: string) {
        return requestManagement(`/projects/${projectRef}/health?services=db&services=auth&services=storage`, 'GET');
    },

    async getApiKeys(projectRef: string) {
        return requestManagement(`/projects/${projectRef}/api-keys`, 'GET');
    },

    async getLogs(projectRef: string) {
        try {
            // Simplified Log fetching via Management API if available, 
            // otherwise return mock or basic structure
            return [];
        } catch(e) { return []; }
    },
    
    async getEdgeFunctions(projectRef: string) {
        try {
            return await requestManagement(`/projects/${projectRef}/functions`, 'GET');
        } catch (e) { return []; }
    },

    // --- DATA OPERATIONS (Project API - Service Role) ---

    async getTables(projectRef: string) {
        const sql = `
            SELECT 
                tablename as name, 
                schemaname as schema, 
                rowsecurity as rls_enabled
            FROM pg_tables 
            WHERE schemaname = 'public' 
        `;
        const res = await this.executeSql(projectRef, sql);
        return parseSqlResult(res);
    },
    
    async getTableData(projectRef: string, tableName: string, apiKey: string) {
         // Using REST API via Project Ref
         return requestProject(projectRef, `/rest/v1/${tableName}?select=*&limit=100`, 'GET', apiKey);
    },

    async getAuthUsers(projectRef: string) {
        const sql = `SELECT id, email, created_at, role, last_sign_in_at FROM auth.users ORDER BY created_at DESC`;
        const res = await this.executeSql(projectRef, sql);
        return { users: parseSqlResult(res) };
    },
    
    async deleteUser(projectRef: string, userId: string, serviceKey: string) {
        return requestProject(projectRef, `/auth/v1/admin/users/${userId}`, 'DELETE', serviceKey);
    },

    async createUser(projectRef: string, email: string) {
        // Robust user creation via SQL to avoid "Service Role" auth issues on fresh instances
        const sql = `
            INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_token, sent_token, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_sent_at)
            VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', '${email}', '$2a$10$w8.I..', now(), '', '', null, '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', null);
        `;
        return this.executeSql(projectRef, sql);
    },

    async getStorageBuckets(projectRef: string) {
        const sql = `SELECT id, name, public, created_at FROM storage.buckets`;
        const res = await this.executeSql(projectRef, sql);
        return parseSqlResult(res);
    },

    async createBucket(projectRef: string, name: string, publicBucket: boolean, serviceKey: string) {
        return requestProject(projectRef, `/storage/v1/bucket`, 'POST', serviceKey, {
            name,
            public: publicBucket,
            file_size_limit: null,
            allowed_mime_types: null
        });
    },

    async deleteBucket(projectRef: string, bucketId: string, serviceKey: string) {
         return requestProject(projectRef, `/storage/v1/bucket/${bucketId}`, 'DELETE', serviceKey);
    },
    
    async listBucketFiles(projectRef: string, bucketId: string, serviceKey: string) {
         return requestProject(projectRef, `/storage/v1/object/list/${bucketId}`, 'POST', serviceKey, {
             prefix: '',
             sortBy: { column: 'name', order: 'asc' },
             limit: 100
         });
    },

    async getAiSettings(projectRef: string) {
        return {
             status: "Not Configured",
             provider: "Supabase Vector (pgvector)",
             embedding_model: "text-embedding-ada-002"
        }; 
    },

    async regenerateApiKey(projectRef: string, type: 'secret' | 'anon' = 'secret') {
        return requestManagement(`/projects/${projectRef}/api-keys`, 'POST', { type });
    }
};
