
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GeneratedCode, ProjectFile } from '../types';
import { 
    Copy, Check, Loader2, ChevronDown, ChevronRight, 
    FileCode, FileJson, FileType, Folder, FolderOpen, 
    Sparkles, RefreshCw, LayoutTemplate
} from 'lucide-react';

interface CodeEditorProps {
  code: GeneratedCode | null;
  files?: ProjectFile[];
  isThinking?: boolean;
  active?: boolean; // Optimization prop
}

// --- Virtual File System Types ---
type FileNodeType = 'file' | 'folder';

interface FileNode {
  id: string;
  name: string;
  type: FileNodeType;
  language?: 'javascript' | 'html' | 'css' | 'json' | 'typescript' | 'markdown' | 'plaintext';
  content?: string;
  parentId?: string;
  children?: FileNode[];
  isReadOnly?: boolean;
}

// --- Syntax Highlighting Logic ---
const highlightLine = (line: string, lang: string | undefined): string => {
  if (!line) return '';
  
  let html = line
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  if (lang === 'javascript' || lang === 'typescript' || lang === 'jsx' || lang === 'tsx') {
    if (html.trim().startsWith('//')) return `<span class="text-slate-500 italic">${html}</span>`;
    html = html.replace(/(\/\/.*)/g, '<span class="text-slate-500 italic">$1</span>');
    html = html.replace(/\b(const|let|var|function|return|if|else|for|while|import|export|from|default|class|extends|=>|async|await|try|catch|switch|case|break|new|interface|type)\b/g, '<span class="text-pink-400 font-medium">$1</span>');
    html = html.replace(/\b(useState|useEffect|useRef|useCallback|useMemo|React|ReactDOM|console|window|document)\b/g, '<span class="text-cyan-400">$1</span>');
    html = html.replace(/([a-zA-Z0-9_]+)(?=\()/g, '<span class="text-yellow-300">$1</span>');
    html = html.replace(/(['"`])(.*?)\1/g, '<span class="text-emerald-400">$1$2$1</span>');
    html = html.replace(/(&lt;\/?)(\w+)/g, '$1<span class="text-blue-400">$2</span>');
  }

  if (lang === 'css') {
    html = html.replace(/([a-zA-Z-0-9]+):/g, '<span class="text-cyan-300">$1</span>:');
    html = html.replace(/:(.*?);/g, ':<span class="text-emerald-300">$1</span>;');
    html = html.replace(/(\.|#)([a-zA-Z0-9_-]+)/g, '<span class="text-yellow-300">$1$2</span>');
    html = html.replace(/(\/\*.*?\*\/)/g, '<span class="text-slate-500 italic">$1</span>');
  }

  if (lang === 'html') {
    html = html.replace(/(&lt;\/?)(\w+)/g, '$1<span class="text-blue-400">$2</span>');
    html = html.replace(/\b([a-zA-Z-0-9]+)=/g, '<span class="text-sky-300">$1</span>=');
    html = html.replace(/(['"])(.*?)\1/g, '<span class="text-emerald-400">$1$2$1</span>');
    html = html.replace(/(&lt;!--.*?--&gt;)/g, '<span class="text-slate-500 italic">$1</span>');
  }

  return html;
};

// --- Tree Builder Helper ---
const buildTreeFromFiles = (files: ProjectFile[]): FileNode[] => {
    const root: FileNode = { id: 'root', name: 'root', type: 'folder', children: [] };
    
    // Sort files to ensure folders are created before files if needed, though strictly not necessary with this logic
    const sortedFiles = [...files].sort((a, b) => a.path.localeCompare(b.path));

    sortedFiles.forEach(file => {
        const parts = file.path.split('/');
        let currentLevel = root.children!;
        let parentId = 'root';

        parts.forEach((part, index) => {
            const isFile = index === parts.length - 1;
            const id = parentId + '/' + part;
            
            let existing = currentLevel.find(n => n.name === part);
            
            if (!existing) {
                const newNode: FileNode = {
                    id,
                    name: part,
                    type: isFile ? 'file' : 'folder',
                    parentId,
                    children: isFile ? undefined : [],
                    language: isFile ? (file.language as any) || 'plaintext' : undefined,
                    content: isFile ? file.content : undefined
                };
                currentLevel.push(newNode);
                existing = newNode;
            }
            
            if (!isFile && existing.children) {
                currentLevel = existing.children;
                parentId = id;
            }
        });
    });
    
    return root.children || [];
};

// --- Default Structure for empty/new projects ---
const INITIAL_FILE_TREE: FileNode[] = [
    {
        id: 'root',
        name: 'project',
        type: 'folder',
        children: [
            {
                id: 'public',
                name: 'public',
                type: 'folder',
                parentId: 'root',
                children: [
                    { id: 'index.html', name: 'index.html', type: 'file', language: 'html', parentId: 'public' },
                    { id: 'manifest.json', name: 'manifest.json', type: 'file', language: 'json', parentId: 'public', isReadOnly: true, content: '{\n  "name": "Rafiei App",\n  "start_url": "."\n}' }
                ]
            },
            {
                id: 'src',
                name: 'src',
                type: 'folder',
                parentId: 'root',
                children: [
                    { id: 'App.tsx', name: 'App.tsx', type: 'file', language: 'javascript', parentId: 'src' },
                    { id: 'index.css', name: 'index.css', type: 'file', language: 'css', parentId: 'src' },
                    { id: 'vite-env.d.ts', name: 'vite-env.d.ts', type: 'file', language: 'typescript', parentId: 'src', isReadOnly: true, content: '/// <reference types="vite/client" />' }
                ]
            },
            { id: 'package.json', name: 'package.json', type: 'file', language: 'json', parentId: 'root', isReadOnly: true, content: '{\n  "name": "rafiei-app",\n  "version": "1.0.0",\n  "dependencies": {\n    "react": "^18.2.0",\n    "react-dom": "^18.2.0",\n    "lucide-react": "latest"\n  }\n}' },
            { id: 'vite.config.ts', name: 'vite.config.ts', type: 'file', language: 'typescript', parentId: 'root', isReadOnly: true, content: 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\n\nexport default defineConfig({\n  plugins: [react()]\n});' },
        ]
    }
];

const CodeEditor: React.FC<CodeEditorProps> = ({ code, files, isThinking = false, active = true }) => {
  // --- State ---
  const [fileTree, setFileTree] = useState<FileNode[]>(INITIAL_FILE_TREE);
  const [activeFileId, setActiveFileId] = useState<string>('App.tsx');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['root', 'src', 'public']));
  const [fileContentMap, setFileContentMap] = useState<Record<string, string>>({});
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  
  // Streaming Animation State
  const [displayedContent, setDisplayedContent] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const streamRequestRef = useRef<number>(null);
  const prevCodeRef = useRef<GeneratedCode | null>(null);

  // Detect Mobile
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;

  // --- Initialize Tree & Content ---
  useEffect(() => {
      if (files && files.length > 0) {
          // Imported Project Mode
          const tree = buildTreeFromFiles(files);
          setFileTree(tree);
          
          const contentMap: Record<string, string> = {};
          // Flatten for easier lookup
          const traverse = (nodes: FileNode[]) => {
              nodes.forEach(node => {
                  if (node.type === 'file' && node.content) {
                      contentMap[node.id] = node.content;
                  }
                  if (node.children) traverse(node.children);
              });
          };
          traverse(tree);
          setFileContentMap(contentMap);
          
          // Set initial active file (prefer App.tsx or index.html)
          const appFile = files.find(f => f.path.endsWith('App.tsx') || f.path.endsWith('App.js') || f.path.endsWith('main.tsx'));
          if (appFile) {
              setActiveFileId('root/' + appFile.path); // path from buildTree includes parts
          } else if (files.length > 0) {
              setActiveFileId('root/' + files[0].path);
          }
          
          // Auto-expand src if it exists
          if (files.some(f => f.path.startsWith('src/'))) {
              setExpandedFolders(prev => new Set([...prev, 'root/src']));
          }

      } else if (code) {
          // AI Generated / Default Mode
          // Reset to default tree
          if (fileTree !== INITIAL_FILE_TREE) setFileTree(INITIAL_FILE_TREE);

          setFileContentMap(prev => ({
              ...prev,
              'App.tsx': code.javascript,
              'index.html': code.html,
              'index.css': code.css
          }));
      }
  }, [files, code]);

  // --- Sync Code Prop Updates (AI Streaming) ---
  useEffect(() => {
    // Optimization: Skip if not active
    if (!active) return;

    if (!code || (files && files.length > 0)) return; // Skip if in file mode

    // Detect which file is changing primarily (Legacy Mode)
    let newEditingId = null;
    
    if (isThinking) {
        if (prevCodeRef.current) {
            if (code.javascript.length !== prevCodeRef.current.javascript.length) newEditingId = 'App.tsx';
            else if (code.css.length !== prevCodeRef.current.css.length) newEditingId = 'index.css';
            else if (code.html.length !== prevCodeRef.current.html.length) newEditingId = 'index.html';
        } else {
            newEditingId = 'App.tsx';
        }
    }

    setEditingFileId(newEditingId);
    
    if (newEditingId && isThinking && activeFileId !== newEditingId) {
        setActiveFileId(newEditingId);
        setAutoScroll(true);
    }

    prevCodeRef.current = code;
  }, [code, isThinking, files, activeFileId, active]);

  // --- Content Streaming Logic ---
  useEffect(() => {
    // Skip if not active
    if (!active) return;

    const targetContent = fileContentMap[activeFileId] || '';
    
    // Performance: Disable typing animation on mobile or for large files to prevent crashes
    const shouldAnimate = isThinking && activeFileId === editingFileId && !isMobile && targetContent.length < 5000;

    // If not thinking or should not animate, show content immediately
    if (!shouldAnimate) {
        setDisplayedContent(targetContent);
        return;
    }

    // Smooth typing effect
    const animate = () => {
      setDisplayedContent(current => {
        if (current === targetContent) return current;
        if (!targetContent.startsWith(current)) return targetContent; // Handle rewrites
        
        const diff = targetContent.length - current.length;
        if (diff <= 0) return current;
        
        // Dynamic speed
        const chunk = Math.max(1, Math.ceil(diff / 5));
        return targetContent.slice(0, current.length + chunk);
      });
      streamRequestRef.current = requestAnimationFrame(animate);
    };

    streamRequestRef.current = requestAnimationFrame(animate);
    return () => { if (streamRequestRef.current) cancelAnimationFrame(streamRequestRef.current); };
  }, [fileContentMap, activeFileId, isThinking, editingFileId, active, isMobile]);

  // --- Auto Scroll ---
  useEffect(() => {
    if (active && autoScroll && contentEndRef.current && isThinking && activeFileId === editingFileId) {
        contentEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [displayedContent, autoScroll, isThinking, activeFileId, editingFileId, active]);

  // --- Event Handlers ---
  const toggleFolder = (folderId: string) => {
      const newSet = new Set(expandedFolders);
      if (newSet.has(folderId)) newSet.delete(folderId);
      else newSet.add(folderId);
      setExpandedFolders(newSet);
  };

  const handleFileClick = (fileId: string) => {
      setActiveFileId(fileId);
      setAutoScroll(false); // User took control
  };

  const handleCopy = () => {
      navigator.clipboard.writeText(displayedContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

  // --- File Icons Helper ---
  const getFileIcon = (name: string) => {
      if (name.endsWith('.tsx') || name.endsWith('.ts')) return <FileCode size={14} className="text-blue-400" />;
      if (name.endsWith('.css')) return <FileType size={14} className="text-sky-300" />;
      if (name.endsWith('.html')) return <LayoutTemplate size={14} className="text-orange-400" />;
      if (name.endsWith('.json')) return <FileJson size={14} className="text-yellow-400" />;
      return <FileCode size={14} className="text-slate-400" />;
  };

  // --- Recursive Tree Component ---
  const renderTree = (nodes: FileNode[], depth = 0) => {
      return nodes.map(node => {
          const isExpanded = expandedFolders.has(node.id);
          const isActive = activeFileId === node.id;
          const isEditing = editingFileId === node.id && isThinking;
          const paddingLeft = `${depth * 12 + 12}px`;

          if (node.type === 'folder') {
              return (
                  <div key={node.id}>
                      <div 
                          className="flex items-center gap-1.5 py-1 px-2 hover:bg-slate-800/50 cursor-pointer text-slate-400 hover:text-slate-200 select-none transition-colors"
                          style={{ paddingLeft }}
                          onClick={() => toggleFolder(node.id)}
                      >
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {isExpanded ? <FolderOpen size={14} className="text-indigo-400" /> : <Folder size={14} className="text-indigo-400" />}
                          <span className="text-xs font-medium">{node.name}</span>
                      </div>
                      {isExpanded && node.children && renderTree(node.children, depth + 1)}
                  </div>
              );
          }

          return (
              <div 
                  key={node.id}
                  className={`
                      flex items-center justify-between py-1.5 pr-2 cursor-pointer text-xs select-none border-l-2 transition-all
                      ${isActive ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500' : 'text-slate-400 border-transparent hover:bg-slate-800/50 hover:text-slate-200'}
                  `}
                  style={{ paddingLeft }}
                  onClick={() => handleFileClick(node.id)}
              >
                  <div className="flex items-center gap-2 overflow-hidden">
                      {getFileIcon(node.name)}
                      <span className="truncate">{node.name}</span>
                  </div>
                  {isEditing && (
                      <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                  )}
              </div>
          );
      });
  };

  // --- Current File Metadata ---
  const activeNode = useMemo(() => {
      const findNode = (nodes: FileNode[]): FileNode | undefined => {
          for (const node of nodes) {
              if (node.id === activeFileId) return node;
              if (node.children) {
                  const found = findNode(node.children);
                  if (found) return found;
              }
          }
      };
      // Search in current fileTree
      const actualRoot = fileTree.length === 1 && fileTree[0].id === 'root' ? fileTree[0].children! : fileTree;
      return findNode(actualRoot);
  }, [activeFileId, fileTree]);

  // Optimization: Do not split and render if not active
  const lines = useMemo(() => active ? displayedContent.split('\n') : [], [displayedContent, active]);

  if (!active) return null; // Or return simplified placeholder

  return (
    <div className="flex h-full bg-[#020617] text-slate-300 font-mono text-sm border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
      
      {/* --- LEFT PANEL: EXPLORER --- */}
      <div className="w-64 bg-[#0f172a] border-r border-slate-800 flex flex-col shrink-0">
          <div className="h-9 flex items-center px-4 border-b border-slate-800 bg-[#0f172a]">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Explorer</span>
          </div>
          <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
              {/* If root wrapper exists, render children, else render root nodes */}
              {renderTree(fileTree[0]?.children || fileTree)}
          </div>
          {isThinking && editingFileId && (
              <div className="p-3 border-t border-slate-800 bg-indigo-500/5">
                  <div className="flex items-center gap-2 text-xs text-indigo-300 mb-1">
                      <Loader2 size={12} className="animate-spin" />
                      <span className="font-semibold">AI Generating...</span>
                  </div>
                  <div className="text-[10px] text-indigo-400/70 truncate">
                      Writing to {editingFileId}
                  </div>
              </div>
          )}
      </div>

      {/* --- MAIN PANEL: EDITOR --- */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#020617]">
          
          {/* Editor Header */}
          <div className="h-9 flex items-center justify-between bg-[#0f172a] border-b border-slate-800 px-0">
              <div className="flex h-full">
                  <div className="px-4 h-full flex items-center gap-2 bg-[#020617] border-r border-slate-800 border-t-2 border-t-indigo-500 min-w-[120px]">
                      {activeNode && getFileIcon(activeNode.name)}
                      <span className="text-xs text-slate-200">{activeNode?.name}</span>
                      {isThinking && activeFileId === editingFileId && (
                          <Sparkles size={10} className="text-amber-400 ml-2 animate-pulse" />
                      )}
                  </div>
              </div>
              <div className="flex items-center px-2 gap-2">
                  {activeNode?.isReadOnly && (
                      <span className="text-[10px] bg-slate-800 text-slate-500 px-2 py-0.5 rounded border border-slate-700">Read Only</span>
                  )}
                  <button onClick={handleCopy} className="p-1.5 hover:bg-slate-800 rounded text-slate-400 hover:text-white transition-colors">
                      {copied ? <Check size={14} className="text-emerald-500"/> : <Copy size={14}/>}
                  </button>
              </div>
          </div>

          {/* Editor Content */}
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-auto relative custom-scrollbar scroll-smooth"
          >
            {(!code && !files && !isThinking) ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-600">
                    <div className="w-16 h-16 rounded-xl bg-slate-900 flex items-center justify-center mb-4 border border-slate-800">
                        <FileCode size={32} className="opacity-50" />
                    </div>
                    <p>Select a file to view code</p>
                </div>
            ) : (
                <div className="flex min-h-full">
                    {/* Line Numbers */}
                    <div className="bg-[#0f172a]/30 text-right py-4 px-3 select-none border-r border-slate-800/50 sticky left-0 z-10 w-[50px] shrink-0">
                        {lines.map((_, i) => (
                            <div key={i} className="text-slate-600 text-xs leading-6 font-mono h-6">{i + 1}</div>
                        ))}
                    </div>

                    {/* Code */}
                    <div className="flex-1 py-4 px-6 overflow-x-auto">
                        {lines.map((line, i) => (
                            <div key={i} className="leading-6 whitespace-pre h-6 w-full">
                                <code dangerouslySetInnerHTML={{ __html: highlightLine(line, activeNode?.language) }} />
                            </div>
                        ))}
                        
                        {/* Cursor */}
                        {isThinking && activeFileId === editingFileId && (
                            <div className="inline-block w-2 h-4 bg-indigo-500 align-middle animate-pulse ml-0.5 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
                        )}
                        
                        <div ref={contentEndRef} />
                    </div>
                </div>
            )}
          </div>

          {/* Footer Status Bar */}
          <div className="h-6 bg-[#0f172a] border-t border-slate-800 flex items-center justify-between px-3 text-[10px] text-slate-500 select-none">
                <div className="flex gap-3">
                    <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-indigo-500"></div> Master</span>
                    <span>0 errors</span>
                    <span>0 warnings</span>
                </div>
                <div className="flex gap-4">
                    <span>Ln {lines.length}, Col {lines[lines.length - 1]?.length || 0}</span>
                    <span>UTF-8</span>
                    <span className="uppercase">{activeNode?.language || 'TXT'}</span>
                </div>
          </div>
      </div>
    </div>
  );
};

export default CodeEditor;
