import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Message, Suggestion, BuildState, User } from '../types';
import { Send, Sparkles, Square, RefreshCw, Wrench, Lightbulb, Paperclip, X, Image as ImageIcon, Loader2, AlertTriangle, Cloud, Wand2, Copy, MoreHorizontal, Clock, Check, Coins, CheckCircle2, XCircle, FileCode, CheckSquare, Circle, Info, ArrowRight, Play, Brain, ChevronDown, ChevronUp } from 'lucide-react';
import CloudConnectionTerminal from './CloudConnectionTerminal';
import { useTranslation } from '../utils/translations';
import { fileToBase64 } from '../services/cloudService';

interface ImageUpload {
  id: string;
  file: File;
  previewUrl: string;
  serverUrl?: string;
  base64?: string;
  uploading: boolean;
  error?: boolean;
}

interface ChatInterfaceProps {
  user: User;
  messages: Message[];
  onSendMessage: (content: string, images: { url: string; base64: string }[]) => void;
  onUploadImage?: (file: File) => Promise<string>;
  onStop: () => void;
  onRetry: (prompt: string) => void;
  onContinue?: () => void;
  onAutoFix: () => void;
  onClearBuildState?: () => void;
  onConnectDatabase?: () => void;
  onSkipBackend?: () => void;
  isThinking: boolean;
  isAutoRepairing?: boolean;
  isResumable?: boolean;
  suggestions: Suggestion[];
  isSuggestionsLoading: boolean;
  runtimeError?: string | null;
  cloudConnectionStatus?: 'idle' | 'provisioning' | 'waking' | 'success' | 'error';
  cloudConnectionError?: string | null;
  onCloudConnectRetry?: () => void;
  onClearCloudConnectionState?: () => void;
}

const SUCCESS_SOUND_URL = 'https://cdn.pixabay.com/audio/2022/03/15/audio_2b28b1e36c.mp3';

const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`|\*\*[^*]+\*\*|• .*)/g);
  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {parts.map((part, index) => {
        if (!part) return null;
        if (part.startsWith('```') && part.endsWith('```')) {
          const code = part.slice(3, -3);
          return <pre key={index} className="bg-black/5 dark:bg-black/20 text-slate-800 dark:text-gray-300 p-2 rounded-md my-1.5 overflow-x-auto text-[11px] font-mono border border-black/5 dark:border-white/5"><code>{code}</code></pre>;
        }
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="bg-black/5 dark:bg-white/10 text-indigo-600 dark:text-indigo-300 px-1 py-0.5 rounded text-xs font-mono">{part.slice(1, -1)}</code>;
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-slate-900 dark:text-white">{part.slice(2, -2)}</strong>;
        if (part.startsWith('• ')) return <div key={index} className="flex items-start gap-2 ml-2 my-1"><span className="mt-1.5 text-indigo-400">•</span><span>{part.substring(2)}</span></div>
        return <span key={index}>{part}</span>;
      })}
    </div>
  );
};

const formatTime = (ms: number | undefined) => {
  if (ms === undefined) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

const formatCredits = (credits: number | undefined) => {
  if (credits === undefined) return null;
  if (credits === 0) return '0';
  return credits < 0.01 ? '< 0.01' : credits.toFixed(2);
};

const ThinkingHeader: React.FC<{ msg: Message }> = ({ msg }) => {
    const [elapsed, setElapsed] = useState(0);
    const { t } = useTranslation();

    useEffect(() => {
        if (msg.status !== 'working' || !msg.startTime) return;
        
        const interval = setInterval(() => {
            setElapsed(Date.now() - (msg.startTime || 0));
        }, 1000);
        
        return () => clearInterval(interval);
    }, [msg.status, msg.startTime]);

    const displayElapsed = formatTime(elapsed);
    const thoughtTime = formatTime(msg.thoughtDurationMs);

    if (msg.status === 'completed' && msg.thoughtDurationMs) {
        return <span className="font-medium text-slate-400 dark:text-slate-500">Thought for {thoughtTime}</span>;
    }

    if (msg.status === 'working') {
        return (
            <div className="flex items-center gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">thinking ....</span>
                <span className="text-[10px] text-indigo-500 dark:text-indigo-400 font-mono tabular-nums opacity-80">
                    {displayElapsed}
                </span>
            </div>
        );
    }

    return <span>{msg.content && <MarkdownRenderer content={msg.content} />}</span>;
};

const MessageActions: React.FC<{ msg: Message }> = ({ msg }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        if (msg.content) {
            navigator.clipboard.writeText(msg.content);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    if (msg.role === 'user' || msg.role === 'system') return null;

    return (
        <div className="flex items-center gap-3 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={handleCopy} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors" title="Copy">
                {copied ? <Check size={12} className="text-emerald-500"/> : <Copy size={12}/>}
            </button>
            {(msg.executionTimeMs || msg.creditsUsed) && (
                <div className="flex items-center gap-2 text-[10px] text-slate-400 select-none">
                    {msg.executionTimeMs && <span className="flex items-center gap-0.5"><Clock size={10}/> {formatTime(msg.executionTimeMs)}</span>}
                    {msg.creditsUsed && <span className="flex items-center gap-0.5"><Coins size={10}/> {formatCredits(msg.creditsUsed)} cr</span>}
                </div>
            )}
        </div>
    );
};

const ChatMessageContent: React.FC<{ 
    msg: Message, 
    onRetry?: () => void, 
    onContinue?: () => void,
    onConnectDatabase?: () => void, 
    onSkipBackend?: () => void, 
    cloudConnectionStatus?: string,
    isLastMessage: boolean
}> = ({ msg, onRetry, onContinue, onConnectDatabase, onSkipBackend, cloudConnectionStatus, isLastMessage }) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const isThinkingMessage = msg.content?.toLowerCase().includes('thinking ....') || msg.status === 'working' || msg.thoughtDurationMs;
    const hasDetails = msg.planData || msg.currentStepProgress || msg.details || (msg.type === 'build_phase' && msg.content);

    const getIcon = (status: Message['status'], icon?: string) => {
        if (status === 'working') return <Loader2 size={14} className="animate-spin text-indigo-500" />;
        if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500" />;
        if (status === 'failed') return <XCircle size={14} className="text-red-500" />;
        if (status === 'pending') return <Circle size={14} className="text-slate-400" />;
        if (icon === 'warning') return <AlertTriangle size={14} className="text-amber-500" />;
        if (icon === 'wrench') return <Wrench size={14} className="text-amber-500" />;
        if (icon === 'sparkles') return <Sparkles size={14} className="text-indigo-500" />;
        return <Info size={14} className="text-slate-500" />;
    };

    const toggleExpand = () => {
        if (isThinkingMessage || hasDetails) {
            setIsExpanded(!isExpanded);
        }
    };

    const messageContent = (msg.type === 'user_input' || msg.type === 'assistant_response') 
        ? (msg.content && <MarkdownRenderer content={msg.content} />) 
        : (
            <div 
                className={`flex flex-col select-none ${(isThinkingMessage || hasDetails) ? 'cursor-pointer group/thought' : ''}`}
                onClick={toggleExpand}
            >
                <div className="flex items-center gap-2 text-sm transition-colors">
                    {getIcon(msg.status, msg.icon)}
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <ThinkingHeader msg={msg} />
                        {(isThinkingMessage || hasDetails) && (
                            <div className="opacity-0 group-hover/thought:opacity-100 transition-opacity">
                                {isExpanded ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
                            </div>
                        )}
                    </div>
                </div>
                {/* NARRATION CAPTION: Shows what is currently happening under the thinking status */}
                {msg.status === 'working' && msg.content && !msg.content.includes('thinking ....') && (
                    <div className="ml-5.5 pl-0.5 text-[11px] text-slate-500 dark:text-slate-400 animate-in fade-in slide-in-from-left-1 duration-300 truncate">
                        {msg.content}
                    </div>
                )}
            </div>
        );

    return (
        <>
            {msg.images && msg.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, idx) => (
                        <img key={idx} src={img} alt="attachment" className="h-20 w-auto rounded-lg object-cover border border-slate-200 dark:border-slate-700" />
                    ))}
                </div>
            )}
            
            {messageContent}

            {isExpanded && (
                <div className="mt-2 ml-6 space-y-2 animate-in slide-in-from-top-1 duration-200 border-l-2 border-slate-100 dark:border-slate-800 pl-4 py-1">
                    {/* Narration in dropdown */}
                    {msg.content && !msg.content.includes('thinking ....') && (
                        <div className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 mb-1">
                             {msg.content}
                        </div>
                    )}
                    
                    {msg.type === 'build_plan' && msg.planData && (
                        <div className="space-y-1.5">
                            <h4 className="font-semibold text-slate-800 dark:text-slate-200 text-xs mb-2 uppercase tracking-wider">{t('buildPlanTitle')}</h4>
                            {msg.planData.map((item, i) => (
                                <div key={i} className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    {item.status === 'completed' ? <Check size={10} className="text-emerald-500" /> : <Circle size={10} className="text-slate-300 dark:text-slate-600" />}
                                    <span className={item.status === 'completed' ? 'line-through opacity-60' : ''}>{item.title}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {msg.type === 'build_phase' && (
                        <div className="space-y-2">
                             {msg.currentStepProgress && (
                                <div className="space-y-1">
                                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                                        <span>Progress</span>
                                        <span>{msg.currentStepProgress.current}/{msg.currentStepProgress.total} steps</span>
                                    </div>
                                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1">
                                        <div
                                            className="bg-indigo-500 h-1 rounded-full transition-all duration-500 ease-out"
                                            style={{ width: `${(msg.currentStepProgress.current / (msg.currentStepProgress.total || 1)) * 100}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-1 italic">
                                        Working on: {msg.currentStepProgress.stepName}
                                    </p>
                                </div>
                             )}
                        </div>
                    )}

                    {msg.details && (
                        <div className="bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/5 rounded p-2">
                             <pre className="text-[10px] text-slate-500 dark:text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed">
                                {msg.details}
                            </pre>
                        </div>
                    )}
                </div>
            )}

            {isLastMessage && msg.type === 'build_error' && (
                <div className="flex flex-wrap gap-2 mt-2">
                    {onRetry && (
                        <button onClick={onRetry} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center gap-1 text-xs"><RefreshCw size={12} /> {t('retryBuild')}</button>
                    )}
                    {onContinue && (
                        <button onClick={onContinue} className="text-emerald-600 dark:text-emerald-400 font-medium hover:underline flex items-center gap-1 ml-2 text-xs"><Play size={12} /> {t('continueBuild')}</button>
                    )}
                </div>
            )}

            {msg.requiresAction === 'CONNECT_DATABASE' && onConnectDatabase && (
                cloudConnectionStatus === 'provisioning' || cloudConnectionStatus === 'waking' ? (
                    <button disabled className="mt-3 flex items-center gap-2 bg-indigo-500 text-white text-[11px] font-medium px-4 py-1.5 rounded-lg opacity-70 cursor-not-allowed">
                        <Loader2 size={12} className="animate-spin" /> {t('connectingCloud')}
                    </button>
                ) : cloudConnectionStatus === 'success' ? (
                    <button disabled className="mt-3 flex items-center gap-2 bg-emerald-600 text-white text-[11px] font-medium px-4 py-1.5 rounded-lg opacity-80">
                        <Check size={12} /> {t('cloudConnected')}
                    </button>
                ) : (
                    <div className="flex flex-wrap gap-2 mt-3 animate-in fade-in slide-in-from-bottom-1">
                        <button onClick={onConnectDatabase} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-medium px-4 py-1.5 rounded-lg transition-all shadow-sm">
                            <Cloud size={12} /> {t('connectCloud')}
                        </button>
                        {onSkipBackend && (
                            <button onClick={onSkipBackend} className="flex items-center gap-2 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-[11px] font-medium px-4 py-1.5 rounded-lg transition-all">
                                Skip <ArrowRight size={10} />
                            </button>
                        )}
                    </div>
                )
            )}
        </>
    );
};


const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
    user, messages, onSendMessage, onUploadImage, onStop, onRetry, onContinue, onAutoFix, onClearBuildState, onConnectDatabase, onSkipBackend, isThinking, isAutoRepairing, isResumable,
    suggestions, isSuggestionsLoading, runtimeError,
    cloudConnectionStatus = 'idle',
    cloudConnectionError,
    onCloudConnectRetry,
    onClearCloudConnectionState,
}) => {
  const [input, setInput] = useState('');
  const [stagedImages, setStagedImages] = useState<ImageUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const successSoundRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasThinkingRef = useRef(false);
  const { t, dir } = useTranslation();

  useEffect(() => {
    successSoundRef.current = new Audio(SUCCESS_SOUND_URL);
    successSoundRef.current.volume = 0.5;
    successSoundRef.current.onerror = () => { successSoundRef.current = null; };
  }, []);

  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, runtimeError, cloudConnectionStatus]);

  useEffect(() => {
    if (!isThinking && wasThinkingRef.current) {
        successSoundRef.current?.play().catch(() => {});
    }
    wasThinkingRef.current = isThinking;
  }, [isThinking]);

  const handleFileValidation = (file: File): boolean => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) { alert('Invalid file type'); return false; }
      if (file.size > 10 * 1024 * 1024) { alert('File too large'); return false; }
      return true;
  };

  const addFilesToStage = async (files: File[]) => {
      const validFiles = Array.from(files).filter(handleFileValidation);
      if (validFiles.length === 0) return;
      const newUploads: ImageUpload[] = validFiles.map(file => ({
          id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), uploading: true
      }));
      setStagedImages(prev => [...prev, ...newUploads]);
      for (const upload of newUploads) {
          try {
              const fullBase64 = await fileToBase64(upload.file);
              const pureBase64 = fullBase64; 
              let serverUrl = upload.previewUrl; 
              if (onUploadImage) serverUrl = await onUploadImage(upload.file);
              setStagedImages(prev => prev.map(p => p.id === upload.id ? { ...p, base64: pureBase64, serverUrl, uploading: false } : p));
          } catch (error) {
              setStagedImages(prev => prev.map(p => p.id === upload.id ? { ...p, uploading: false, error: true } : p));
          }
      }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files) addFilesToStage(Array.from(e.target.files)); if (fileInputRef.current) fileInputRef.current.value = ''; };
  const removeStagedImage = (id: string) => { setStagedImages(prev => prev.filter(img => img.id !== id)); };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedImages.some(img => img.uploading)) return;
    if ((input.trim() || stagedImages.length > 0) && !isThinking) {
      const validImages = stagedImages.filter(img => !img.error && img.serverUrl && img.base64).map(img => ({ url: img.serverUrl!, base64: img.base64! }));
      onSendMessage(input.trim(), validImages);
      setInput('');
      setStagedImages([]);
    }
  };

  const dropHandler = useCallback((ev: React.DragEvent<HTMLDivElement>) => { ev.preventDefault(); setIsDragging(false); if (ev.dataTransfer.files) addFilesToStage(Array.from(ev.dataTransfer.files)); }, []);
  const dragOverHandler = (ev: React.DragEvent<HTMLDivElement>) => { ev.preventDefault(); setIsDragging(true); };
  const dragLeaveHandler = () => setIsDragging(false);
  const pasteHandler = useCallback((ev: ClipboardEvent) => { if (ev.clipboardData) { const items = Array.from(ev.clipboardData.items).filter(item => item.type.indexOf('image') !== -1); if (items.length > 0) addFilesToStage(items.map(item => item.getAsFile()).filter(Boolean) as File[]); } }, []);
  useEffect(() => { window.addEventListener('paste', pasteHandler); return () => window.removeEventListener('paste', pasteHandler); }, [pasteHandler]);

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const handleRetryClick = () => lastUserMessage && onRetry(lastUserMessage.content || '');
  const handleSuggestionClick = (prompt: string) => { setInput(prompt); document.getElementById('chat-input')?.focus(); };

  const isUploading = stagedImages.some(img => img.uploading);
  const isWaitingForFirstResponse = isThinking && messages.length > 0 && messages[messages.length - 1].role === 'user';

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#0f172a] relative transition-colors duration-300 font-sans" onDrop={dropHandler} onDragOver={dragOverHandler} onDragLeave={dragLeaveHandler} dir={dir}>
      {isDragging && (
        <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center pointer-events-none">
            <ImageIcon size={48} className="text-indigo-500 mb-4 animate-bounce" />
            <p className="font-semibold text-slate-800 dark:text-white">{t('dropImages')}</p>
        </div>
      )}
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
        {messages.length === 0 && !isThinking && (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-gray-600 opacity-60">
                <Sparkles size={32} strokeWidth={1.5} />
                <p className="mt-4 text-sm font-medium">{t('startBuilding')}</p>
            </div>
        )}
        
        {messages.map((msg, idx) => {
            const isUserInput = msg.type === 'user_input';
            const isAssistantResponse = msg.type === 'assistant_response';
            const isBuildMessage = ['build_plan', 'build_phase', 'build_status', 'build_error', 'action_required', 'final_summary'].includes(msg.type || '');
            const isLastMessage = idx === messages.length - 1;
            
            return (
              <div key={msg.id} className={`flex gap-3 group animate-in fade-in slide-in-from-bottom-2 duration-300 ${isUserInput ? 'flex-row-reverse' : 'flex-row'}`}>
                 {!isBuildMessage && (
                     <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 overflow-hidden shadow-sm ${
                         isUserInput ? 'bg-slate-100 dark:bg-slate-800' : 'bg-indigo-50 dark:bg-indigo-900/10'
                     }`}>
                         {isUserInput ? (
                             user.avatar ? <img src={user.avatar} alt="user" className="w-full h-full object-cover" /> : <div className="text-xs font-bold text-slate-600 dark:text-slate-400">{user.name.charAt(0).toUpperCase()}</div>
                         ) : (
                             <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400" />
                         )}
                     </div>
                 )}

                 <div className={`max-w-[85%] text-sm ${
                     isUserInput 
                     ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 px-4 py-2 rounded-2xl rounded-tr-sm' 
                     : isAssistantResponse ? 'text-slate-700 dark:text-slate-300 pt-1' : 'text-slate-700 dark:text-slate-300 pt-0.5'
                 }`}>
                     <ChatMessageContent 
                        msg={msg} 
                        onRetry={handleRetryClick} 
                        onContinue={onContinue}
                        onConnectDatabase={onConnectDatabase} 
                        onSkipBackend={onSkipBackend}
                        cloudConnectionStatus={cloudConnectionStatus} 
                        isLastMessage={isLastMessage}
                     />
                     {!isBuildMessage && <MessageActions msg={msg} />}
                 </div>
              </div>
            );
        })}

        {isWaitingForFirstResponse && (
            <div className="flex gap-3 animate-in fade-in">
                <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/10 flex items-center justify-center shrink-0">
                    <Brain size={14} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <Loader2 size={14} className="animate-spin" />
                    <span>thinking ....</span>
                </div>
            </div>
        )}

        {isResumable && !isThinking && (
            <div className="flex gap-3 animate-in fade-in">
                <div className="w-full bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl p-4 flex flex-col items-center text-center">
                    <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-3">
                        <Play size={20} fill="currentColor" className="ml-1" />
                    </div>
                    <h4 className="font-bold text-slate-900 dark:text-white text-sm mb-1">Resume Building?</h4>
                    <p className="text-slate-500 dark:text-slate-400 text-xs mb-4">Your project wasn't finished. I can continue where I left off.</p>
                    <button 
                        onClick={onContinue} 
                        className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-6 py-2 rounded-full transition-all shadow-lg shadow-indigo-500/20 flex items-center gap-2"
                    >
                        <Play size={12} fill="currentColor" /> {t('continueBuild')}
                    </button>
                </div>
            </div>
        )}
        
        {cloudConnectionStatus !== 'idle' && (
            <div className="flex gap-3 animate-in fade-in">
                <div className="w-full">
                    <CloudConnectionTerminal
                        status={cloudConnectionStatus}
                        error={cloudConnectionError}
                        onRetry={onCloudConnectRetry}
                        onClose={onClearCloudConnectionState}
                    />
                </div>
            </div>
        )}
        
        {!isThinking && (runtimeError || isAutoRepairing) && (
            <div className="flex gap-3 animate-in fade-in">
                 <div className="w-8 h-8 shrink-0" />
                <div className="p-3 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-lg text-xs max-w-[85%]">
                    <div className="flex items-center gap-2 font-medium text-red-600 dark:text-red-400 mb-1">
                        {isAutoRepairing ? <Wand2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                        {isAutoRepairing ? t('selfHealing') : t('runtimeError')}
                    </div>
                    {!isAutoRepairing && (
                        <>
                            <p className="text-red-500/80 mb-2">{runtimeError}</p>
                            <button onClick={() => onAutoFix()} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline flex items-center gap-1">
                                <Wrench size={12} /> {t('autoFixError')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 sticky bottom-0 z-20 bg-gradient-to-t from-white via-white to-transparent dark:from-[#0f172a] dark:via-[#0f172a] dark:to-transparent">
        {isSuggestionsLoading && !isThinking && suggestions.length === 0 && (
            <div className="mb-2 flex items-center gap-2 px-2 text-xs text-slate-400 animate-pulse">
                <Loader2 size={12} className="animate-spin" /> {t('generatingSuggestions')}
            </div>
        )}

        {suggestions.length > 0 && !isThinking && (
          <div className="mb-3 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-500 shrink-0 px-1"><Lightbulb size={12} /><span>{t('next')}</span></div>
              {suggestions.filter(s => s && s.title).map((s, i) => (
                  <button key={i} onClick={() => handleSuggestionClick(s.prompt)} className="whitespace-nowrap bg-white dark:bg-[#1e293b] hover:border-indigo-300 dark:hover:border-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-slate-700 rounded-full px-3 py-1.5 text-xs transition-all shadow-sm">
                      {s.title}
                  </button>
              ))}
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="relative group bg-white dark:bg-[#1e293b] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500/50 transition-all">
          {stagedImages.length > 0 && (
            <div className="p-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex gap-2 overflow-x-auto">
                    {stagedImages.map((img) => (
                        <div key={img.id} className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                            <img src={img.previewUrl} className={`w-full h-full object-cover ${img.uploading ? 'opacity-50' : ''}`} alt="preview" />
                            {img.uploading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-white" size={16} /></div>}
                            {img.error && <div className="absolute inset-0 flex items-center justify-center bg-red-500/50"><AlertTriangle className="text-white" size={16} /></div>}
                            <button type="button" onClick={() => removeStagedImage(img.id)} className="absolute top-0.5 right-0.5 bg-black/50 hover:bg-red-500 text-white rounded-full p-0.5 transition-colors"><X size={10} /></button>
                        </div>
                    ))}
                </div>
            </div>
          )}
          <div className="flex items-center pl-3 pr-3 py-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-indigo-500 transition-colors rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><Paperclip size={18} /></button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/png, image/jpeg, image/webp" multiple className="hidden" />
            <input id="chat-input" type="text" dir="auto" value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('placeholder')} disabled={isThinking} className="flex-1 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder:text-gray-600 text-sm focus:outline-none px-3 py-2" />
            <div className="">{isThinking ? (<button type="button" onClick={onStop} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Square size={16} fill="currentColor" /></button>) : (<button type="submit" disabled={(!input.trim() && stagedImages.length === 0) || isUploading} className="p-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"><Send size={16} className="rtl:rotate-180" /></button>)}</div>
          </div>
        </form>
      </div>
    </div>
  );
};
export default ChatInterface;