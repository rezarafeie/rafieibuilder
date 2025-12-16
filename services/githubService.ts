import { ProjectFile } from '../types';

interface GitHubTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
  url: string;
}

export const githubService = {
  
  parseUrl(url: string): { owner: string; repo: string } | null {
    try {
      const u = new URL(url);
      if (u.hostname !== 'github.com') return null;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2) return null;
      return { owner: parts[0], repo: parts[1] };
    } catch (e) {
      return null;
    }
  },

  async fetchRepoTree(owner: string, repo: string, branch: string = 'main', token?: string): Promise<GitHubTreeItem[]> {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
        if (response.status === 404) throw new Error('Repository or branch not found. If private, please provide a token.');
        if (response.status === 401) throw new Error('Invalid GitHub token.');
        throw new Error(`GitHub API Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    if (data.truncated) {
        console.warn('Repository tree is too large and was truncated.');
    }
    return data.tree;
  },

  async fetchFileContent(url: string, token?: string): Promise<string> {
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3.raw', 
    };
    if (token) {
        headers['Authorization'] = `token ${token}`;
    }
    
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`Failed to fetch file content: ${response.statusText}`);
    return await response.text();
  },

  async importProject(owner: string, repo: string, branch: string, token?: string, onProgress?: (msg: string, progress: number) => void): Promise<{ files: ProjectFile[], framework: string, libraries: string[] }> {
    
    if (onProgress) onProgress('Fetching repository structure...', 10);
    const tree = await this.fetchRepoTree(owner, repo, branch, token);
    
    const relevantFiles = tree.filter(item => 
        item.type === 'blob' && 
        !item.path.startsWith('.git/') &&
        !item.path.includes('node_modules') &&
        !item.path.endsWith('.png') && 
        !item.path.endsWith('.jpg') && 
        !item.path.endsWith('.ico') &&
        !item.path.endsWith('.lock') &&
        !item.path.endsWith('-lock.json')
    );

    if (relevantFiles.length === 0) {
        throw new Error("No readable files found in repository.");
    }

    const files: ProjectFile[] = [];
    const totalFiles = relevantFiles.length;
    let completed = 0;

    const BATCH_SIZE = 5; 
    
    for (let i = 0; i < relevantFiles.length; i += BATCH_SIZE) {
        const batch = relevantFiles.slice(i, i + BATCH_SIZE);
        
        // Parallel execution within batch
        await Promise.all(batch.map(async (item) => {
            // STRICT MODE: If any file fails, the whole import fails.
            try {
                let content = '';
                if (!token) {
                    // Try public raw URL first
                    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${item.path}`;
                    const res = await fetch(rawUrl);
                    if (res.ok) {
                        content = await res.text();
                    } else {
                        // Fallback to API
                        content = await this.fetchFileContent(item.url, token);
                    }
                } else {
                    content = await this.fetchFileContent(item.url, token);
                }

                // POSTGRES COMPATIBILITY FIX: Remove null bytes
                content = content.replace(/\u0000/g, '');

                if (content.length === 0) {
                    console.warn(`Empty file detected: ${item.path}`);
                }

                files.push({
                    path: item.path,
                    content: content,
                    type: 'file',
                    language: this.detectLanguage(item.path)
                });
            } catch (e: unknown) {
                // Safely extract message from unknown error
                const errorMessage = e instanceof Error ? e.message : String(e);
                throw new Error(`Failed to import ${item.path}: ${errorMessage}`);
            } finally {
                completed++;
                if (onProgress) onProgress(`Importing ${item.path}...`, 10 + Math.round((completed / totalFiles) * 80));
            }
        }));
    }

    if (files.length === 0) {
        throw new Error("Import failed: No files were successfully downloaded.");
    }

    // Analysis
    if (onProgress) onProgress('Analyzing project structure...', 95);
    const analysis = this.analyzeProject(files);

    return {
        files,
        framework: analysis.framework,
        libraries: analysis.libraries
    };
  },

  detectLanguage(path: string): string {
      if (path.endsWith('.js') || path.endsWith('.jsx')) return 'javascript';
      if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript';
      if (path.endsWith('.css')) return 'css';
      if (path.endsWith('.html')) return 'html';
      if (path.endsWith('.json')) return 'json';
      if (path.endsWith('.md')) return 'markdown';
      return 'plaintext';
  },

  analyzeProject(files: ProjectFile[]) {
      let framework = 'Unknown';
      const libraries: string[] = [];

      const packageJsonFile = files.find(f => f.path === 'package.json');
      if (packageJsonFile) {
          try {
              const pkg = JSON.parse(packageJsonFile.content);
              const deps = { ...pkg.dependencies, ...pkg.devDependencies };
              
              if (deps['react']) framework = 'React';
              if (deps['next']) framework = 'Next.js';
              if (deps['vue']) framework = 'Vue';
              if (deps['svelte']) framework = 'Svelte';
              
              if (deps['tailwindcss']) libraries.push('Tailwind CSS');
              if (deps['framer-motion']) libraries.push('Framer Motion');
              if (deps['lucide-react']) libraries.push('Lucide Icons');
              if (deps['@supabase/supabase-js']) libraries.push('Supabase');
              if (deps['date-fns']) libraries.push('date-fns');
          } catch (e) {}
      }

      if (framework === 'Unknown') {
          if (files.some(f => f.path.endsWith('.tsx'))) framework = 'React (TS)';
          else if (files.some(f => f.path.endsWith('.jsx'))) framework = 'React (JS)';
      }

      return { framework, libraries };
  }
};