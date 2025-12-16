
import React, { useEffect, useRef, useState, useMemo } from 'react';
import { GeneratedCode, ProjectFile, Project } from '../types';
import { constructFullDocument } from '../utils/codeGenerator';
import { Loader2, RefreshCw, Eye, ExternalLink } from 'lucide-react';

interface PreviewCanvasProps {
  code: GeneratedCode | null;
  files?: ProjectFile[];
  className?: string;
  isGenerating?: boolean;
  isUpdating?: boolean;
  onRuntimeError?: (error: string) => void;
  projectId?: string; // Optional: Used for context-aware routing injection
  active?: boolean; // Optimization: Pause updates when hidden
  externalUrl?: string; // Optional: External deployment URL (Vercel)
  project?: Project | null; // Pass full project for context injection
}

const fixingMessages = [
  "Cooking up a fix...",
  "Noodling on the solution...",
  "Investigating the glitch...",
  "Rewiring the mainframe...",
  "Exterminating bugs...",
  "Applying digital duct tape...",
  "Consulting the oracle...",
  "De-greasing the gears...",
  "Sanitizing the inputs...",
  "Re-calibrating the flux capacitor..."
];

const PreviewCanvas: React.FC<PreviewCanvasProps> = ({ 
    code, 
    files, 
    className, 
    isGenerating = false, 
    isUpdating = false, 
    onRuntimeError, 
    projectId, 
    active = true, 
    externalUrl,
    project
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasRuntimeError, setHasRuntimeError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  
  // Memoize document string matching Dashboard logic exactly
  const docString = useMemo(() => {
    // If we are showing external URL, we don't need to generate the blob
    if (externalUrl && !isGenerating && !isUpdating) return undefined;

    // Use strict fallback to ensure constructFullDocument always has data to work with
    const codeData = code || { html: '', javascript: '', css: '', explanation: '' };
    return constructFullDocument(codeData, projectId, files, project);
  }, [code, files, projectId, externalUrl, isGenerating, isUpdating, project]);

  // Pick a random message when the error state changes
  const activeFixingMessage = useMemo(() => {
      return fixingMessages[Math.floor(Math.random() * fixingMessages.length)];
  }, [hasRuntimeError, isUpdating]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        if (event.data && event.data.type === 'RUNTIME_ERROR') {
            setHasRuntimeError(true);
            if (onRuntimeError) {
                onRuntimeError(event.data.message);
            }
        }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRuntimeError]);

  useEffect(() => {
      if ((isGenerating || isUpdating) && active) {
          setIsLoading(true);
          setHasRuntimeError(false);
          setShowErrorDetails(false);
      }
  }, [isGenerating, isUpdating, active]);

  const handleReload = () => {
    setIsLoading(true);
    setReloadKey(prev => prev + 1);
    setHasRuntimeError(false);
    setShowErrorDetails(false);
  };

  // Optimization: If inactive (tab switched), unmount heavy iframe or return null
  if (!active) return null;

  // Determine iframe props
  // 1. If external URL is active and we are NOT building, use `src`.
  // 2. Otherwise use `srcDoc` with the generated HTML.
  const srcProp = (externalUrl && !isGenerating && !isUpdating) ? externalUrl : undefined;
  const srcDocProp = srcProp ? undefined : (docString || undefined);

  return (
    <div className={`w-full h-full bg-[#0f172a] rounded-lg overflow-hidden shadow-xl border border-gray-700 relative group ${className}`}>
      
      <style>
        {`
            @keyframes loading-scan {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
            }
            .loading-bar-shim {
                animation: loading-scan 1.5s infinite linear;
                background: linear-gradient(90deg, transparent, #6366f1, transparent);
            }
        `}
      </style>

      {(isLoading || isGenerating || isUpdating) && (
          <div className="absolute top-0 left-0 right-0 h-1 z-30 bg-transparent overflow-hidden pointer-events-none">
              <div className="w-full h-full loading-bar-shim"></div>
          </div>
      )}

      {!isGenerating && !isUpdating && (
        <div className="absolute top-4 right-4 z-20 flex gap-2">
            {externalUrl && (
                <a 
                    href={externalUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg backdrop-blur-sm border border-slate-600/50 shadow-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                    title="Open in new tab"
                >
                    <ExternalLink size={16} />
                </a>
            )}
            <button 
                onClick={handleReload}
                className="p-2 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg backdrop-blur-sm border border-slate-600/50 shadow-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100"
                title="Reload Preview"
            >
                <RefreshCw size={16} />
            </button>
        </div>
      )}

      {/* Deployment Status Indicator */}
      {externalUrl && !isGenerating && !isUpdating && (
          <div className="absolute bottom-4 right-4 z-20 px-3 py-1 bg-emerald-500/90 backdrop-blur-sm text-white text-xs font-bold rounded-full shadow-lg pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity">
              Live Preview
          </div>
      )}

      <iframe
        ref={iframeRef}
        key={`${reloadKey}-${externalUrl || 'local'}`}
        title="App Preview"
        className="w-full h-full bg-white"
        sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
        loading="lazy"
        src={srcProp}
        srcDoc={srcDocProp}
        onLoad={() => setIsLoading(false)}
      />
      
      {isUpdating && hasRuntimeError && !showErrorDetails && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-200">
            <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-3 bg-slate-800 px-6 py-4 rounded-full shadow-xl border border-slate-700">
                    <Loader2 className="animate-spin text-indigo-400" size={20} />
                    <span className="font-medium text-slate-200">{activeFixingMessage}</span>
                </div>
                <button 
                    onClick={() => setShowErrorDetails(true)}
                    className="flex items-center gap-2 text-xs text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 px-3 py-1.5 rounded-full transition-colors border border-transparent hover:border-slate-600"
                >
                    <Eye size={12} />
                    Show Error
                </button>
            </div>
        </div>
      )}
    </div>
  );
};

export default PreviewCanvas;
