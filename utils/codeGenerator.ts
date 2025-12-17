
import { GeneratedCode, ProjectFile, Project } from "../types";
import { getCurrentLanguage } from './translations';

// Silence false positive for 'require' inside template strings if parsed incorrectly
declare var require: any;

// --- CONSTANTS & TEMPLATES ---

const DEFAULT_MAIN_TSX = `
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const el = document.getElementById("root");
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </HashRouter>
  );
} else {
  console.error("Critical: #root element missing in index.html");
}
`.trim();

const DEFAULT_APP_TSX = `
import React from "react";

export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-900">
      <div className="p-8 rounded-2xl shadow bg-white">
        <h1 className="text-3xl font-bold">Hello World</h1>
        <p className="mt-2 text-slate-600">Preview is ready.</p>
      </div>
    </div>
  );
}
`.trim();

const DEFAULT_INDEX_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Vazirmatn:wght@400;500;600;700&display=swap');
body { 
  font-family: 'Vazirmatn', 'Inter', system-ui, -apple-system, sans-serif; 
  margin: 0;
  padding: 0;
}
`.trim();

const DEFAULT_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ['Vazirmatn', 'Inter', 'sans-serif'],
            }
          }
        }
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

// --- SANITIZATION HELPERS ---

const stripMarkdownFences = (content: string): string => {
    if (!content) return "";
    let clean = content.trim();
    
    // Remove wrapping ```...``` with optional language tag
    const match = clean.match(/^[\s\n]*```(?:[\w-]*)\n?([\s\S]*?)```[\s\n]*$/);
    if (match) return match[1].trim();
    
    clean = clean.replace(/^```[\w-]*\n?/, '');
    clean = clean.replace(/\n?```$/, '');
    
    return clean.trim();
};

const decodeEscapes = (content: string): string => {
    let clean = content;
    if (clean.length > 2 && clean.startsWith('"') && clean.endsWith('"')) {
        try {
            const parsed = JSON.parse(clean);
            if (typeof parsed === 'string') return parsed;
        } catch (e) {}
    }
    if (clean.includes('\\n')) clean = clean.replace(/\\n/g, '\n');
    if (clean.includes('\\t')) clean = clean.replace(/\\t/g, '\t');
    if (clean.includes('\\"')) clean = clean.replace(/\\/g, '"');
    if (clean.includes("\\'")) clean = clean.replace(/\\'/g, "'");
    if (clean.includes('\\\\')) clean = clean.replace(/\\\\/g, '\\');
    return clean;
};

const removeTailwindDirectives = (content: string): string => {
    return content
        .split('\n')
        .filter(line => !line.trim().startsWith('@tailwind'))
        .join('\n');
};

/**
 * AUTO-RECOVERY: If AI generates loose HTML instead of React, wrap it.
 */
const ensureReactComponent = (content: string, path: string): string => {
    if (!path.endsWith('.tsx') && !path.endsWith('.jsx')) return content;
    
    const trimmed = content.trim();
    const hasExport = trimmed.includes('export default') || trimmed.includes('module.exports');
    const hasReact = trimmed.includes('import React') || trimmed.includes('React.') || trimmed.includes('<') && trimmed.includes('>');

    if (!hasExport && hasReact && trimmed.startsWith('<')) {
        return `import React from 'react';\n\nexport default function Component() {\n  return (\n    <>\n      ${content}\n    </>\n  );\n}`;
    }
    return content;
};

export const sanitizeFileContent = (content: string, path: string): string => {
    if (!content) return "";
    let clean = content;

    clean = stripMarkdownFences(clean);
    if (clean.includes('\\n') || clean.includes('\\"')) {
        clean = decodeEscapes(clean);
    }

    if (path.match(/\.(tsx|jsx|ts|js|html|css|json|md)$/)) {
        if (clean.includes('&lt;') || clean.includes('&gt;') || clean.includes('&amp;')) {
            clean = clean
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
        }
    }

    if (path.endsWith('.css')) {
        clean = removeTailwindDirectives(clean);
    }

    clean = ensureReactComponent(clean, path);

    return clean.trim();
};

export const validateProjectSafety = (files: ProjectFile[]): string | null => {
    for (const f of files) {
        if (f.content.includes('```')) {
            return `Sanitization Failed: File '${f.path}' still contains Markdown fences.`;
        }
        if (f.content.includes('[object Object]')) {
            return `Sanitization Failed: File '${f.path}' contains '[object Object]'.`;
        }
    }
    return null;
};

// --- NORMALIZATION & REPAIR ---

export const normalizeFiles = (files: ProjectFile[]): { files: ProjectFile[], entryPoint: string | null } => {
    const fileMap = new Map<string, ProjectFile>();
    let entryPoint: string | null = null;

    files.forEach(f => {
        let path = f.path.trim().replace(/^\.\//, '').replace(/^\//, '');
        
        if (['main.tsx', 'main.jsx', 'index.tsx', 'index.jsx'].includes(path)) path = 'src/main.tsx';
        if (['App.tsx', 'App.jsx', 'app.tsx'].includes(path)) path = 'src/App.tsx';
        if (['index.css', 'styles.css'].includes(path)) path = 'src/index.css';

        if ((path.endsWith('.tsx') || path.endsWith('.ts') || path.endsWith('.css')) && 
            !path.startsWith('src/') && 
            !path.includes('config') && 
            !path.includes('.d.ts')) {
            path = `src/${path}`;
        }

        const content = sanitizeFileContent(f.content, path);
        fileMap.set(path, { ...f, path, content });
    });

    if (fileMap.has('src/main.tsx')) entryPoint = 'src/main.tsx';
    else if (fileMap.has('src/index.tsx')) entryPoint = 'src/index.tsx';
    else if (fileMap.has('src/main.jsx')) entryPoint = 'src/main.jsx';
    else if (fileMap.has('src/index.jsx')) entryPoint = 'src/index.jsx';

    if (entryPoint) {
        const mainFile = fileMap.get(entryPoint);
        if (!mainFile || !mainFile.content.includes('createRoot') || !mainFile.content.includes('.render(')) {
            fileMap.set(entryPoint, { 
                path: entryPoint, 
                content: DEFAULT_MAIN_TSX, 
                type: 'file', 
                language: 'typescript' 
            });
        }

        const appFile = fileMap.get('src/App.tsx') || fileMap.get('src/App.jsx');
        if (!appFile || appFile.content.trim().length < 20) {
             fileMap.set('src/App.tsx', {
                 path: 'src/App.tsx', 
                 content: DEFAULT_APP_TSX, 
                 type: 'file', 
                 language: 'typescript' 
             });
        }
        
        fileMap.set('index.html', {
            path: 'index.html',
            content: DEFAULT_INDEX_HTML,
            type: 'file',
            language: 'html'
        });
    } else {
        const htmlFile = fileMap.get('index.html');
        let isValidHtml = false;

        if (htmlFile && htmlFile.content) {
            const trimmed = htmlFile.content.trim();
            const startsWithTag = trimmed.startsWith('<');
            const hasHtmlTags = trimmed.toLowerCase().includes('<html') && trimmed.toLowerCase().includes('<body');
            isValidHtml = startsWithTag && hasHtmlTags;
        }

        if (!isValidHtml) {
            entryPoint = 'src/main.tsx';
            fileMap.set('src/main.tsx', { path: 'src/main.tsx', content: DEFAULT_MAIN_TSX, type: 'file', language: 'typescript' });
            fileMap.set('src/App.tsx', { path: 'src/App.tsx', content: DEFAULT_APP_TSX, type: 'file', language: 'typescript' });
            fileMap.set('index.html', { path: 'index.html', content: DEFAULT_INDEX_HTML, type: 'file', language: 'html' });
        }
    }

    if (!fileMap.has('src/index.css')) {
        fileMap.set('src/index.css', {
            path: 'src/index.css', 
            content: DEFAULT_INDEX_CSS, 
            type: 'file', 
            language: 'css' 
        });
    }

    return { files: Array.from(fileMap.values()), entryPoint };
};

const safeJsonStringify = (obj: any): string => {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
};

export const constructFullDocument = (code: GeneratedCode, projectId?: string, files?: ProjectFile[], project?: Project | null): string => {
    let allFiles = files ? [...files] : [];
    if (allFiles.length === 0 && (code.javascript || code.html)) {
        if (code.javascript) allFiles.push({ path: 'src/App.tsx', content: code.javascript, type: 'file' });
        if (code.css) allFiles.push({ path: 'src/index.css', content: code.css, type: 'file' });
        if (code.html) allFiles.push({ path: 'index.html', content: code.html, type: 'file' });
    }
    return constructMultiFileDocument(allFiles, projectId, project);
};

export const constructMultiFileDocument = (rawFiles: ProjectFile[], projectId?: string, project?: Project | null): string => {
  const appLang = getCurrentLanguage();
  const appDir = appLang === 'fa' ? 'rtl' : 'ltr';

  const { files: processedFiles, entryPoint } = normalizeFiles(rawFiles);
  const safetyError = validateProjectSafety(processedFiles);
  if (safetyError) {
      return `<!DOCTYPE html><html><body style="background:#0f172a;color:#ef4444;display:flex;align-items:center;justify-content:center;height:100vh;padding:2rem;"><div style="text-align:center"><h3 style="margin-bottom:10px">Security Block</h3><pre>${safetyError}</pre></div></body></html>`;
  }

  const indexHtml = processedFiles.find(f => f.path === 'index.html')!;
  let baseHtmlContent = indexHtml.content;

  if (!baseHtmlContent.toLowerCase().includes('<html')) {
      baseHtmlContent = `<!DOCTYPE html><html>${baseHtmlContent}</html>`;
  } else if (!baseHtmlContent.includes('<!DOCTYPE html')) {
      baseHtmlContent = `<!DOCTYPE html>${baseHtmlContent}`;
  }

  baseHtmlContent = baseHtmlContent.replace(/<html[^>]*>/i, (match) => {
    let tag = match;
    if (!tag.includes('lang=')) tag = tag.replace('<html', `<html lang="${appLang}"`);
    if (!tag.includes('dir=')) tag = tag.replace('<html', `<html dir="${appDir}"`);
    return tag;
  });

  baseHtmlContent = baseHtmlContent.replace(/<script[^>]*type="module"[^>]*src=".*?"[\s\S]*?<\/script>/g, '');
  baseHtmlContent = baseHtmlContent.replace(/<script[^>]*type="importmap"[\s\S]*?<\/script>/g, '');

  const projectIdInjection = projectId ? `window.__PROJECT_ID__ = "${projectId}";` : 'window.__PROJECT_ID__ = null;';
  
  let envInjection = `window.process = { env: { NODE_ENV: 'development' } };`;

  if (project?.rafieiCloudProject?.status === 'ACTIVE' && project.rafieiCloudProject.projectRef && project.rafieiCloudProject.publishableKey) {
      const url = `https://${project.rafieiCloudProject.projectRef}.supabase.co`;
      const key = project.rafieiCloudProject.publishableKey;
      envInjection = `window.process = { env: { NODE_ENV: 'development', SUPABASE_URL: '${url}', SUPABASE_ANON_KEY: '${key}', VITE_SUPABASE_URL: '${url}', VITE_SUPABASE_ANON_KEY: '${key}' } };`;
  }

  const fileMap: Record<string, string> = {};
  processedFiles.forEach(f => {
      fileMap[f.path] = f.content;
      if (f.path.startsWith('src/')) fileMap[f.path.substring(4)] = f.content;
  });

  const styles = processedFiles.filter(f => f.path.endsWith('.css')).map(f => f.content).join('\n');
  const styleTag = `<style>${styles}</style>`;
  baseHtmlContent = baseHtmlContent.replace('</head>', `${styleTag}\n</head>`);

  const safeFileMapJson = safeJsonStringify(fileMap);
  const entryScript = entryPoint ? `__require('${entryPoint}');` : '';

  const injectedScripts = `
    <script>
      ${envInjection}
      ${projectIdInjection}
      window.onerror = function(msg, url, line, col, error) {
          window.parent.postMessage({ type: 'RUNTIME_ERROR', message: msg + (error ? '\\n' + error.stack : '') }, '*');
      };
    </script>
    <script crossorigin src="https://unpkg.com/react@18.2.0/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18.2.0/umd/react-dom.development.js"></script>
    <script crossorigin src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
    <script crossorigin src="https://unpkg.com/history@5.3.0/umd/history.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-router@6.3.0/umd/react-router.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-router-dom@6.3.0/umd/react-router-dom.development.js"></script>
    <script src="https://unpkg.com/lucide-react@0.294.0/dist/umd/lucide-react.min.js"></script>
    <script src="https://unpkg.com/clsx@2.0.0/dist/clsx.min.js"></script>
    <script src="https://unpkg.com/tailwind-merge@2.2.0/dist/bundle.min.js"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      window.__SOURCES__ = ${safeFileMapJson};
      window.__MODULES__ = {};
      function resolvePath(base, relative) {
          if (!relative.startsWith('.')) return relative;
          const stack = base.split('/'); stack.pop();
          const parts = relative.split('/');
          for (let i = 0; i < parts.length; i++) {
              if (parts[i] === '.') continue;
              if (parts[i] === '..') stack.pop();
              else stack.push(parts[i]);
          }
          return stack.join('/');
      }
      function __require(path, base = 'src/main.tsx') {
          const cleanPath = path.replace(/^node:/, '').trim();
          if (cleanPath === 'react') return window.React;
          if (cleanPath === 'react-dom') return window.ReactDOM;
          if (cleanPath === 'react-dom/client') return window.ReactDOM;
          if (cleanPath === 'react-router-dom') {
              const lib = window.ReactRouterDOM;
              return { ...lib, BrowserRouter: lib.HashRouter };
          }
          if (cleanPath === '@supabase/supabase-js') return window.supabase;
          if (cleanPath === 'lucide-react') return window.lucideReact || window.lucide;
          if (cleanPath === 'clsx') return { clsx: window.clsx, default: window.clsx };
          if (cleanPath === 'tailwind-merge') return { twMerge: window.twMerge, default: window.twMerge };

          let resolved = resolvePath(base, cleanPath);
          const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '.css', '.json'];
          let finalPath = null;
          if (window.__SOURCES__[resolved]) finalPath = resolved;
          else {
              for (const ext of extensions) { if (window.__SOURCES__[resolved + ext]) { finalPath = resolved + ext; break; } }
              if (!finalPath) { if (window.__SOURCES__['src/' + cleanPath]) return __require('src/' + cleanPath, base); }
          }
          if (!finalPath) return {};
          if (window.__MODULES__[finalPath]) return window.__MODULES__[finalPath].exports;
          const source = window.__SOURCES__[finalPath];
          const module = { exports: {} };
          window.__MODULES__[finalPath] = module;
          if (finalPath.endsWith('.css')) return {};
          try {
              const presets = [['env', { modules: 'commonjs' }], 'react'];
              if (finalPath.endsWith('.ts') || finalPath.endsWith('.tsx')) presets.push('typescript');
              const code = Babel.transform(source, { presets, filename: finalPath, retainLines: true }).code;
              const func = new Function('require', 'module', 'exports', 'React', code);
              func((p) => __require(p, finalPath), module, module.exports, window.React);
          } catch (e) { throw e; }
          return module.exports;
      }
      window.addEventListener('DOMContentLoaded', () => { ${entryScript} });
    </script>
  `;

  if (/<\/body>/i.test(baseHtmlContent)) return baseHtmlContent.replace(/<\/body>/i, `${injectedScripts}</body>`);
  return `${baseHtmlContent}\n${injectedScripts}`;
};
