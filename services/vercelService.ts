
import { Project, VercelConfig } from '../types';
import { constructFullDocument } from '../utils/codeGenerator';

// Vercel API Configuration
const VERCEL_TOKEN = 'NR3XD76b2MgSftyCNA7D6Ofk';
const PROXY_URL = 'https://corsproxy.io/?';
const BASE_URL = 'https://api.vercel.com';

// Helper for proxy requests
const api = async (path: string, method: string = 'GET', body?: any) => {
    const url = `${PROXY_URL}${encodeURIComponent(`${BASE_URL}${path}`)}`;
    
    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${VERCEL_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
        const text = await response.text();
        // Try parsing JSON error
        try {
            const json = JSON.parse(text);
            throw new Error(json.error?.message || `Vercel API Error: ${response.status}`);
        } catch (e: any) {
            if (e.message.includes('Vercel API')) throw e;
            throw new Error(`Vercel API Error: ${text}`);
        }
    }

    return response.json();
};

export const vercelService = {
    
    /**
     * Create or Get existing Vercel Project
     */
    async ensureProject(project: Project): Promise<{ id: string; name: string }> {
        if (project.vercelConfig?.projectId) {
            return { 
                id: project.vercelConfig.projectId, 
                name: project.vercelConfig.projectName 
            };
        }

        // Sanitize project name to be a valid slug
        let slug = project.name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-') // Replace non-alphanumeric with hyphen
            .replace(/-+/g, '-')       // Collapse multiple hyphens
            .replace(/^-|-$/g, '')       // Trim leading/trailing hyphens
            .substring(0, 45);          // Max length for slug part

        // If slug is empty after sanitization (e.g., name was "!!"), use a default prefix.
        if (!slug) {
            slug = 'project';
        }
            
        const uniqueName = `${slug}-${project.id.substring(0, 6)}`;

        try {
            const res = await api('/v10/projects', 'POST', {
                name: uniqueName,
                framework: null // Static site
            });
            return { id: res.id, name: res.name };
        } catch (e: any) {
            // If project with that name already exists, find it and return its ID.
            if (e.message && (e.message.includes('already exists') || e.message.includes('already taken'))) {
                console.log(`Vercel project '${uniqueName}' already exists. Fetching its ID directly.`);
                try {
                    // Use direct fetch by name, which is more reliable than search.
                    const existingProject = await api(`/v9/projects/${uniqueName}`, 'GET');
                    if (existingProject && existingProject.id) {
                        console.log(`Found existing project with ID: ${existingProject.id}`);
                        return { id: existingProject.id, name: existingProject.name };
                    }
                    throw new Error(`Project name conflict for '${uniqueName}', but could not fetch the existing project directly.`);
                } catch (findErr: any) {
                    throw new Error(`Failed to resolve Vercel project conflict for '${uniqueName}': ${findErr.message}`);
                }
            }
            // Re-throw other errors
            throw e;
        }
    },

    /**
     * Deploy the current project state to Vercel
     */
    async deploy(project: Project, vercelProjectId: string): Promise<{ deploymentId: string; url: string }> {
        // 1. Construct single-file content (Bundles multi-file structure into one HTML file)
        const htmlContent = constructFullDocument(project.code, project.id, project.files);
        
        // 2. Create Deployment
        // Vercel API v13 requires `files` array
        const res = await api('/v13/deployments', 'POST', {
            name: project.name.substring(0, 100),
            project: vercelProjectId,
            files: [
                {
                    file: 'index.html',
                    data: htmlContent
                }
            ],
            target: 'production' // Direct to production for this builder
        });

        return {
            deploymentId: res.id,
            url: `https://${res.url}` // Vercel returns host without protocol
        };
    },

    /**
     * Assign a domain to the project
     */
    async assignDomain(projectId: string, domain: string): Promise<any> {
        try {
            return await api(`/v10/projects/${projectId}/domains`, 'POST', { name: domain });
        } catch (e: any) {
            // Ignore errors indicating the domain is already configured. This is expected on updates.
            const msg = e.message.toLowerCase();
            if (msg.includes('already exists') || msg.includes('already in use')) {
                console.log(`Domain ${domain} already assigned, which is expected. Continuing.`);
                return; // Suppress the error and continue.
            }
            // Re-throw unexpected errors.
            console.error(`Failed to assign domain ${domain}:`, e);
            throw e;
        }
    },

    /**
     * High-level orchestration for Publish/Update
     */
    async publishProject(project: Project): Promise<VercelConfig> {
        // 1. Ensure Project
        const vProject = await this.ensureProject(project);
        
        // 2. Deploy
        const deployment = await this.deploy(project, vProject.id);
        
        // 3. Configure Domains
        // Standard Pattern: {slug}.built.bnets.co
        // Note: 'built.bnets.co' must be configured in the Vercel Team associated with the Token
        const stableSlug = vProject.name; // Use the Vercel project name as the unique slug
        const stableDomain = `${stableSlug}.built.bnets.co`;
        
        await this.assignDomain(vProject.id, stableDomain);
        
        // Custom Domain (if present in local project settings)
        if (project.customDomain) {
            await this.assignDomain(vProject.id, project.customDomain);
        }

        return {
            projectId: vProject.id,
            projectName: vProject.name,
            productionUrl: `https://${stableDomain}`,
            latestDeploymentId: deployment.deploymentId,
            latestDeploymentUrl: deployment.url,
            targetDomain: project.customDomain,
            lastDeployedAt: Date.now()
        };
    }
};
