
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Project, Message, ViewMode, User, Suggestion, BuildState, VercelConfig, AIDebugLog } from '../types';
import { generateProjectTitle, generateSuggestions, handleUserIntent } from '../services/geminiService';
import { cloudService } from '../services/cloudService';
import { rafieiCloudService } from '../services/rafieiCloudService';
import { vercelService } from '../services/vercelService';
import { useTranslation } from '../utils/translations';
import { useTheme } from '../utils/theme';
import PreviewCanvas from './PreviewCanvas';
import ChatInterface from './ChatInterface';
import CodeEditor from './CodeEditor';
import PublishDropdown from './PublishDropdown';
import ManageDomainsModal from './ManageDomainsModal';
import ProjectLogModal, { LogEntry, LogTab } from './ProjectLogModal';
import { 
    Loader2, ArrowLeft, PanelLeft, Monitor, Tablet, Smartphone, 
    Check, Cloud, MessageSquare, Eye, Globe, X, LayoutDashboard, 
    ExternalLink, Power, FileText, Rocket, AlertTriangle, Bug
} from 'lucide-react';

interface ProjectBuilderProps {
    user: User;
}

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const MAX_AUTO_REPAIRS = 3;
const ADMIN_DEBUG_EMAIL = 'rezarafeie13@gmail.com';

const ProjectBuilder: React.FC<ProjectBuilderProps> = ({ user }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [buildState, setBuildState] = useState<BuildState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  
  // Realtime AI Debug Logs
  const [aiDebugLogs, setAiDebugLogs] = useState<AIDebugLog[]>([]);
  const [hasNewDebugLog, setHasNewDebugLog] = useState(false);
  
  // Persisted Pending Prompt for Build Resumption
  const [pendingPrompt, setPendingPrompt] = useState<{ content: string; images: { url: string; base64: string }[] } | null>(() => {
      if (projectId) {
          const stored = localStorage.getItem(`pending_prompt_${projectId}`);
          if (stored) {
              try { return JSON.parse(stored); } catch(e) {}
          }
      }
      return null;
  });
  
  // Deployment States
  const [isAutoDeploying, setIsAutoDeploying] = useState(false); 
  const [isManualDeploying, setIsManualDeploying] = useState(false); 
  const [manualDeployError, setManualDeployError] = useState<string | null>(null);
  const [fallbackToLocalPreview, setFallbackToLocalPreview] = useState(false); 

  const projectRef = useRef<Project | null>(null);
  const lastSuggestionMessageIdRef = useRef<string | null>(null);
  const failedSuggestionAttemptsRef = useRef<Record<string, number>>({});
  
  const connectingRef = useRef(false);
  const autoRepairAttemptsRef = useRef(0);
  const isAutoFixingRef = useRef(false);
  const isUserStoppedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartRef = useRef(false); 
  
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview'>('chat');
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(400); 
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); 
  
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [showManageDomains, setShowManageDomains] = useState(false);
  
  const [showCloudDetails, setShowCloudDetails] = useState(false);
  const [localCloudError, setLocalCloudError] = useState<string | null>(null);

  // Log State
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [activeLogTab, setActiveLogTab] = useState<LogTab>('builder');
  const [previewLogs, setPreviewLogs] = useState<LogEntry[]>([]);
  const [cloudLogs, setCloudLogs] = useState<LogEntry[]>([]);
  const [vercelLogs, setVercelLogs] = useState<LogEntry[]>([]);
  const [filteredAIDebugLogs, setFilteredAIDebugLogs] = useState<LogEntry[] | null>(null);

  const repairResolverRef = useRef<((result: {success: boolean, error?: string}) => void) | null>(null);

  const desktopPublishRef = useRef<HTMLDivElement>(null);
  const mobilePublishRef = useRef<HTMLDivElement>(null);

  const { t, dir } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  const isAdmin = user.email === ADMIN_DEBUG_EMAIL;
  
  const cloudStatus = project?.rafieiCloudProject?.status || 'idle';
  const isCloudActive = cloudStatus === 'ACTIVE';
  const isConnectingCloud = cloudStatus === 'CREATING';
  
  const uiCloudStatus: 'idle' | 'provisioning' | 'waking' | 'success' | 'error' = 
    localCloudError ? 'error' :
    cloudStatus === 'CREATING' ? 'provisioning' :
    cloudStatus === 'ACTIVE' ? 'success' :
    cloudStatus === 'FAILED' ? 'error' : 
    'idle';

  const isBuilding = project?.status === 'generating';
  const isThinking = isBuilding || isConnectingCloud;
  const isAutoRepairing = isBuilding && isAutoFixingRef.current;
  
  const isFirstGeneration = isBuilding && project ? (!project.code.html && !project.code.javascript) : false;
  const isUpdating = isBuilding && !isFirstGeneration;

  const isDeployingAnywhere = isAutoDeploying || isManualDeploying;

  const isResumable = project && (project.status === 'idle' || project.status === 'failed') && 
                     project.buildState && project.buildState.phases && 
                     project.buildState.phases.some(p => p.status !== 'completed');

  const previewUrl = undefined; 

  const handleRuntimeError = (error: string) => {
      if (repairResolverRef.current) {
          repairResolverRef.current({ success: false, error });
          repairResolverRef.current = null; 
          return;
      }
      if (project && (!project.code.html && !project.files?.length)) return;
      if (isFirstGeneration) return;
      setRuntimeError(error);
  };

  useEffect(() => {
      if (projectId) {
          if (pendingPrompt) localStorage.setItem(`pending_prompt_${projectId}`, JSON.stringify(pendingPrompt));
          else localStorage.removeItem(`pending_prompt_${projectId}`);
      }
  }, [pendingPrompt, projectId]);

  const startResizing = useCallback(() => { setIsResizing(true); }, []);
  const stopResizing = useCallback(() => { setIsResizing(false); }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
          const newWidth = mouseMoveEvent.clientX;
          if (newWidth > 300 && newWidth < 800) setSidebarWidth(newWidth);
      }
  }, [isResizing]);

  useEffect(() => {
      if (isResizing) {
          window.addEventListener("mousemove", resize);
          window.addEventListener("mouseup", stopResizing);
          document.body.style.userSelect = 'none';
          document.body.style.cursor = 'col-resize';
      } else {
          window.removeEventListener("mousemove", resize);
          window.removeEventListener("mouseup", stopResizing);
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
      }
      return () => {
          window.removeEventListener("mousemove", resize);
          window.removeEventListener("mouseup", stopResizing);
      };
  }, [isResizing, resize, stopResizing]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'PREVIEW_LOG' && event.data.payload) {
            setPreviewLogs(prev => [...prev.slice(-200), event.data.payload]);
        }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
      const isPastAnalysis = buildState && (
          (buildState.phases && buildState.phases.length > 0) || 
          (buildState.currentPhaseIndex !== undefined && buildState.currentPhaseIndex > 0) || 
          (buildState.currentStep !== undefined && buildState.currentStep > 0)
      );

      if (isBuilding && buildState && !isPastAnalysis) {
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          watchdogRef.current = setTimeout(() => {
              if (project) {
                  const errorMsg: Message = {
                      id: crypto.randomUUID(),
                      role: 'assistant',
                      type: 'build_error',
                      content: t('analysisTimedOut'),
                      status: 'failed',
                      icon: 'x',
                      timestamp: Date.now()
                  };
                  const updated = { ...project, messages: [...project.messages, errorMsg] };
                  setProject(updated);
                  const lastUserMsg = [...project.messages].reverse().find(m => m.role === 'user');
                  if (lastUserMsg) handleSendMessage(lastUserMsg.content || '', [], updated, true);
              }
          }, 1200000); 
      } else if (watchdogRef.current) {
          clearTimeout(watchdogRef.current);
      }
      return () => { if (watchdogRef.current) clearTimeout(watchdogRef.current); };
  }, [isBuilding, buildState?.phases?.length, buildState?.currentPhaseIndex, buildState?.currentStep]);


  useEffect(() => {
      projectRef.current = project;
      if (project && project.status === 'idle' && project.messages.length === 1 && project.messages[0].role === 'user' && !project.code.javascript && !autoStartRef.current) {
          autoStartRef.current = true;
          const prompt = project.messages[0].content || '';
          const images = project.messages[0].images?.map(url => ({ url, base64: '' })) || [];
          handleSendMessage(prompt, images, project, true); 
      }

      if (project?.rafieiCloudProject?.status === 'ACTIVE' && pendingPrompt) {
          const promptToExecute = { ...pendingPrompt };
          setPendingPrompt(null); 

          const successMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            type: 'build_status', 
            content: t('cloudConnectedAndResuming'),
            status: 'completed',
            icon: 'check',
            timestamp: Date.now()
          };
          
          const updated = { ...project, messages: [...project.messages, successMsg] };
          setProject(updated);
          cloudService.saveProject(updated);

          setTimeout(() => {
              handleSendMessage(promptToExecute.content, promptToExecute.images, updated, true);
          }, 1000);
      }
  }, [project, pendingPrompt]); 

  const fetchProject = async () => {
      if (!projectId) return;
      try {
          const p = await cloudService.getProject(projectId);
          if (p) {
              setProject(p);
              setBuildState(p.buildState || null);
              if (p.rafieiCloudProject && p.rafieiCloudProject.status === 'CREATING') {
                  rafieiCloudService.monitorProvisioning(p.rafieiCloudProject, p.id);
              }
          } else {
              navigate('/dashboard');
          }
      } catch (err) {
          navigate('/dashboard');
      } finally {
          setLoading(false);
      }
  };
  
  useEffect(() => {
    fetchProject();
    setSuggestions([]);
    lastSuggestionMessageIdRef.current = null;
    failedSuggestionAttemptsRef.current = {};
    connectingRef.current = false;
    autoRepairAttemptsRef.current = 0;
    isAutoFixingRef.current = false;
    isUserStoppedRef.current = false;
    autoStartRef.current = false;
    setFallbackToLocalPreview(false); 
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const { unsubscribe } = cloudService.subscribeToProjectChanges(projectId, (updatedProject) => {
      setProject(updatedProject);
      setBuildState(updatedProject.buildState || null);
    });
    return () => { unsubscribe(); }; 
  }, [projectId]);

  const handleStop = async () => {
    isUserStoppedRef.current = true;
    if (isConnectingCloud && project?.rafieiCloudProject) {
        rafieiCloudService.cancelMonitoring(project.rafieiCloudProject.id);
        setPendingPrompt(null);
        connectingRef.current = false;
        const cancelMsg: Message = { 
            id: crypto.randomUUID(), 
            role: 'assistant', 
            type: 'build_status',
            content: t('cloudConnectionCancelled'), 
            status: 'failed',
            icon: 'x',
            timestamp: Date.now() 
        };
        const updated = { ...project, rafieiCloudProject: undefined, messages: [...project.messages, cancelMsg], updatedAt: Date.now() };
        setProject(updated);
        setBuildState(null);
        await cloudService.saveProject(updated);
        return;
    }
    if (isBuilding && project) {
        cloudService.stopBuild(project.id);
        const stopped = { ...project, status: 'idle' as const, updatedAt: Date.now() };
        setProject(stopped);
        cloudService.saveProject(stopped);
    }
  };

  const handleRetry = (prompt: string) => {
      if(project) {
          const updated = { ...project, messages: project.messages.slice(0, -1), updatedAt: Date.now() };
          setProject(updated); 
          cloudService.saveProject(updated).then(() => { handleSendMessage(prompt, []); });
      }
  };

  const handleContinue = () => {
      if (!project) return;
      const lastUserMsg = [...project.messages].reverse().find(m => m.role === 'user');
      const prompt = lastUserMsg?.content || "";
      const images = lastUserMsg?.images?.map(url => ({ url, base64: '' })) || [];
      handleSendMessage(prompt, images, project, false, false, false, true);
  };
  
  const handleAutoFix = () => {
      if (project) {
          isAutoFixingRef.current = true;
          setRuntimeError(null);
          if (repairResolverRef.current) {
              repairResolverRef.current({ success: false, error: "Restarted repair" });
              repairResolverRef.current = null;
          }

          const onUpdateCallback = (updatedState: Project, meta?: any) => {
              setProject(prev => {
                  if (!prev || prev.id !== updatedState.id) return prev;
                  return updatedState;
              });
              setBuildState(updatedState.buildState || null);
          };

          const waitForPreview = (timeoutMs: number) => {
              return new Promise<{success: boolean, error?: string}>((resolve) => {
                  repairResolverRef.current = resolve;
                  setTimeout(() => {
                      if (repairResolverRef.current === resolve) { 
                          resolve({ success: true });
                          repairResolverRef.current = null;
                      }
                  }, timeoutMs);
              });
          };

          cloudService.triggerRepair(
              project, 
              runtimeError || "Unknown runtime error", 
              onUpdateCallback,
              waitForPreview,
              handleAIDebugLog
          ).catch(e => {
              isAutoFixingRef.current = false;
          });
      }
  };
  
  const handleClearBuildState = async () => {
      if (project) {
          const updated = { ...project, buildState: null };
          setProject(updated); setBuildState(null);
          await cloudService.saveProject(updated);
      }
  };
  
  const handleUploadImage = async (file: File): Promise<string> => {
      if (!project) throw new Error("No project context");
      const tempId = crypto.randomUUID(); 
      return await cloudService.uploadChatImage(project.userId, tempId, file);
  };

  const handleClearCloudConnectionState = () => { setLocalCloudError(null); connectingRef.current = false; };
  const handleCloudConnectRetry = () => { connectingRef.current = false; handleConnectCloud(project, pendingPrompt || undefined); };
  
  const handleConnectCloud = async (startProject?: Project, resumePrompt?: any) => {
    const currentProject = startProject || project;
    if (!currentProject || connectingRef.current) return;
    connectingRef.current = true;
    setLocalCloudError(null);
    try {
        await rafieiCloudService.provisionProject(user, currentProject);
    } catch (error: any) {
        connectingRef.current = false;
        setLocalCloudError(error.message);
        const failMsg: Message = { 
            id: crypto.randomUUID(), 
            role: 'assistant', 
            type: 'build_error', 
            content: t('cloudConnectionFailedError', {errorMessage: error.message}), 
            status: 'failed',
            icon: 'x',
            timestamp: Date.now() 
        };
        const withError = { ...currentProject, messages: [...currentProject.messages, failMsg] };
        setProject(withError);
        await cloudService.saveProject(withError);
    }
  };

  const handleSkipBackend = async () => {
      if (!project) return;
      let previousIntent = "";
      let previousImages: { url: string; base64: string }[] = [];
      if (pendingPrompt) {
          previousIntent = pendingPrompt.content;
          previousImages = pendingPrompt.images || [];
      } else {
          const lastUserMsg = [...project.messages].reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
              previousIntent = lastUserMsg.content || "";
              if (lastUserMsg.images && lastUserMsg.images.length > 0) {
                  previousImages = lastUserMsg.images.map(url => ({ url, base64: '' }));
              }
          }
      }
      const skipMessage = `I want to continue with my previous request: "${previousIntent}". \n\nHowever, please skip the backend connection for now. Proceed with a frontend-only implementation using mock data.`;
      setPendingPrompt(null);
      await handleSendMessage(skipMessage, previousImages, project, false, false, true);
  };

  const handleManualDeployStart = () => {
      setIsManualDeploying(true);
      setManualDeployError(null);
      setFallbackToLocalPreview(false); 
  };

  const handleManualDeployComplete = useCallback(async (vercelConfig: VercelConfig | null, error: string | null) => {
      if (error) {
          setManualDeployError(error);
          setIsManualDeploying(false);
          setFallbackToLocalPreview(true); 
      } else if (vercelConfig) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          setProject(prev => {
              if (prev) return { ...prev, vercelConfig, publishedUrl: vercelConfig.productionUrl };
              return prev;
          });
          setIsManualDeploying(false);
          setShowPublishDropdown(false); 
      }
  }, []);

  const handleAIDebugLog = useCallback((log: AIDebugLog, messageId?: string) => {
      setAiDebugLogs(prev => [...prev.slice(-49), log]);
      setHasNewDebugLog(true);
      setTimeout(() => setHasNewDebugLog(false), 2000);
  }, []);

  const handleSendMessage = async (
      content: string, 
      images: { url: string; base64: string }[], 
      projectOverride?: Project, 
      isInitialAutoStart = false, 
      isAutoFix = false,
      isHidden = false, 
      isResume = false
  ) => {
    const currentProject = projectOverride || projectRef.current;
    if (!currentProject || !user || (currentProject.status === 'generating' && !projectOverride && !isInitialAutoStart)) return;

    setSuggestions([]);
    handleClearCloudConnectionState();
    setRuntimeError(null);
    isUserStoppedRef.current = false;
    setFallbackToLocalPreview(false); 

    if (!isAutoFix && !isInitialAutoStart && !isResume) {
        autoRepairAttemptsRef.current = 0;
        isAutoFixingRef.current = false;
    }

    let updatedProject = currentProject;
    if (!isInitialAutoStart && !isHidden && !isResume) {
        const userMsg: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            type: 'user_input',
            content,
            timestamp: Date.now(),
            images: images.map(i => i.url) 
        };
        updatedProject = { 
            ...currentProject, 
            messages: [...currentProject.messages, userMsg],
            updatedAt: Date.now() 
        };
        setProject(updatedProject);
    }

    const initialLogs = isResume 
        ? [...(buildState?.logs || []), "Resuming build process..."]
        : [t('initBuild'), t('analyzingReq'), t('preparingEnv')];
    
    setBuildState({
        plan: buildState?.plan || [],
        phases: buildState?.phases || [],
        currentPhaseIndex: buildState?.currentPhaseIndex || 0,
        currentStep: buildState?.currentStep || 0,
        lastCompletedStep: buildState?.lastCompletedStep || -1,
        error: null,
        logs: initialLogs
    });

    try {
        let projectToBuild = { ...updatedProject };
        if (!isResume && projectToBuild.messages.filter(m => m.role === 'user').length === 1) {
            const title = await generateProjectTitle(content, user, projectToBuild);
            projectToBuild.name = title;
        }
        projectToBuild.status = 'generating';
        projectToBuild.updatedAt = Date.now(); 
        projectToBuild.buildState = {
            ...(buildState || { plan: [], phases: [], currentPhaseIndex: 0, currentStep: 0, lastCompletedStep: -1, error: null }),
            logs: [...initialLogs]
        };
        setProject(projectToBuild); 

        const onUpdateCallback = (updatedState: Project, meta?: any) => {
            setProject(prev => {
                if (!prev || prev.id !== updatedState.id) return prev;
                return updatedState;
            });
            setBuildState(updatedState.buildState || null);
            if (updatedState.status === 'idle' && updatedState.buildState?.audit?.passed) setRuntimeError(null);
            if (meta?.requires_database && !pendingPrompt) setPendingPrompt({ content, images });
        };

        cloudService.triggerBuild(projectToBuild, content, images, onUpdateCallback, isResume, handleAIDebugLog);
    } catch (e: any) {
        setBuildState(prev => prev ? ({...prev, error: `Error: ${e.message}`}) : null);
        const errorMsg: Message = { 
            id: crypto.randomUUID(), 
            role: 'assistant', 
            type: 'build_error', 
            content: `Error: ${e.message}`, 
            status: 'failed',
            icon: 'x',
            timestamp: Date.now() 
        };
        const finalProject = { ...updatedProject, messages: [...updatedProject.messages, errorMsg], status: 'idle' as const };
        setProject(finalProject);
        await cloudService.saveProject(finalProject);
    }
  };
  
  const handleOpenLogs = async (tab: LogTab = 'builder') => {
      if (!project) return;
      setActiveLogTab(tab);
      setFilteredAIDebugLogs(null);
      setIsLogModalOpen(true);
      try {
          const logs = await cloudService.getProjectLogs(project.id);
          setCloudLogs(logs.map(l => ({
              timestamp: new Date(l.timestamp).toISOString(),
              level: l.level as LogEntry['level'],
              message: `${l.source}: ${l.message}`
          })));
      } catch (e) {}

      if (project.vercelConfig) {
          setVercelLogs([
              { timestamp: new Date(project.vercelConfig.lastDeployedAt).toISOString(), level: 'info', message: `Deployment ${project.vercelConfig.latestDeploymentId} created.` },
              { timestamp: new Date(project.vercelConfig.lastDeployedAt + 2000).toISOString(), level: 'info', message: 'Build successful.' },
              { timestamp: new Date(project.vercelConfig.lastDeployedAt + 3000).toISOString(), level: 'info', message: `Assigned domain: ${project.vercelConfig.productionUrl}` },
          ]);
      } else {
          setVercelLogs([]);
      }
  };

  const handleViewTrace = useCallback((interactions: AIDebugLog[]) => {
      const logs: LogEntry[] = interactions.map(log => ({
          timestamp: new Date(log.timestamp).toISOString(),
          level: 'debug',
          message: `[${log.stepKey}] Model: ${log.model}\n\nSYSTEM INSTRUCTION:\n${log.systemInstruction}\n\nPROMPT:\n${log.prompt}\n\nRESPONSE:\n${log.response}`,
      }));
      setFilteredAIDebugLogs(logs);
      setActiveLogTab('aidebug');
      setIsLogModalOpen(true);
  }, []);

  const handleClearLogs = (logType: 'preview' | 'all') => {
      if (logType === 'preview') setPreviewLogs([]);
  };

  const builderLogs = project?.buildState?.logs?.map(log => ({
      timestamp: new Date().toISOString(),
      level: 'info' as 'info',
      message: log
  })) || [];

  const aiLogsForModal: LogEntry[] = aiDebugLogs.map(log => ({
      timestamp: new Date(log.timestamp).toISOString(),
      level: 'debug',
      message: `[${log.stepKey}] Model: ${log.model}\n\nSYSTEM INSTRUCTION:\n${log.systemInstruction}\n\nPROMPT:\n${log.prompt}\n\nRESPONSE:\n${log.response}`,
  }));

  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:white"><Loader2 className="animate-spin" size={32} /></div>;
  if (!project) return null;

  const deviceSizeClass = deviceMode === 'desktop' ? 'w-full h-full' : deviceMode === 'tablet' ? 'w-[768px] h-full max-w-full mx-auto' : 'w-[375px] h-[667px] max-w-full mx-auto';
  const hasCloudProject = project.rafieiCloudProject != null && project.rafieiCloudProject.status === 'ACTIVE';
  
  return (
    <div className="flex flex-col h-screen bg-white dark:bg-[#0f172a] text-slate-900 dark:text-white overflow-hidden transition-colors duration-300" dir={dir}>
        <ProjectLogModal 
            isOpen={isLogModalOpen}
            onClose={() => setIsLogModalOpen(false)}
            builderLogs={builderLogs}
            previewLogs={previewLogs}
            cloudLogs={cloudLogs}
            vercelLogs={vercelLogs}
            aiDebugLogs={filteredAIDebugLogs || (isAdmin ? aiLogsForModal : [])}
            onClear={handleClearLogs}
            defaultTab={activeLogTab}
        />
        
        {/* Header */}
        <div className="hidden md:flex h-14 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-700 items-center justify-between px-4 z-20 shrink-0">
            <div className="flex items-center gap-2">
                <button onClick={() => navigate('/dashboard')} className="p-2 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors flex items-center gap-2">
                    <ArrowLeft size={18} className="rtl:rotate-180" /><span className="text-sm font-medium hidden sm:inline">Dashboard</span>
                </button>
                <div className="h-6 w-px bg-slate-200 dark:bg-gray-700 hidden sm:block"></div>
                <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className={`p-2 rounded-lg transition-colors ${isSidebarOpen ? 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20' : 'text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'}`}><PanelLeft size={18} /></button>
                <h1 className="font-semibold text-slate-800 dark:text-gray-200 truncate max-w-[150px] md:max-w-md hidden sm:block">{project.name}</h1>
                {isAutoDeploying && <span className="text-xs text-indigo-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Auto Deploying...</span>}
            </div>
            <div className="flex-1 flex justify-center items-center gap-4">
                <div className="hidden md:flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 border border-slate-200 dark:border-slate-700">
                    <button onClick={() => setViewMode('preview')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'preview' ? 'bg-white dark:bg-indigo-600 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{t('preview')}</button>
                    <button onClick={() => setViewMode('code')} className={`px-3 py-1.5 rounded-md text-xs font-medium ${viewMode === 'code' ? 'bg-white dark:bg-indigo-600 shadow-sm dark:shadow-none' : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'}`}>{t('code')}</button>
                </div>
            </div>
            <div className="flex items-center gap-3">
                {isAdmin && (
                    <button 
                        onClick={() => handleOpenLogs('aidebug')}
                        className={`flex items-center gap-1.5 px-2 py-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-[10px] font-bold uppercase tracking-wider transition-all hover:scale-105 active:scale-95 ${hasNewDebugLog ? 'animate-pulse ring-2 ring-amber-500/50' : ''}`}
                    >
                        <Bug size={10} /> Debug Mode
                    </button>
                )}
                {hasCloudProject && <button onClick={() => navigate(`/cloud/${project.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/20 transition-colors"><Cloud size={12} fill="currentColor" /><span className="hidden lg:inline">Cloud Active</span></button>}
                <button onClick={() => handleOpenLogs('builder')} className="p-2 text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Project Logs">
                    <FileText size={18} />
                </button>
                <div className="relative" ref={desktopPublishRef}>
                    <button 
                        onClick={() => setShowPublishDropdown(!showPublishDropdown)} 
                        className="flex items-center gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity shadow-sm"
                        disabled={isManualDeploying || isAutoDeploying}
                    >
                        {t('publish')}
                    </button>
                    {showPublishDropdown && <div className={`absolute top-full mt-2 z-50 ${dir === 'rtl' ? 'left-0' : 'right-0'}`}>
                        <PublishDropdown 
                            project={project} 
                            user={user} 
                            onManageDomains={() => { setShowPublishDropdown(false); setShowManageDomains(true); }} 
                            onClose={() => setShowPublishDropdown(false)} 
                            onUpdate={fetchProject}
                            onDeployStart={handleManualDeployStart}
                            onDeployComplete={handleManualDeployComplete}
                        />
                    </div>}
                </div>
            </div>
        </div>

        {/* Mobile Header */}
        <div className="md:hidden h-14 bg-white dark:bg-[#0f172a] border-b border-slate-200 dark:border-slate-700 flex items-center justify-between px-4 shrink-0 z-20">
            <button onClick={() => navigate('/dashboard')}><ArrowLeft size={20} className="text-slate-600 dark:text-slate-300 rtl:rotate-180" /></button>
            <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <button onClick={handleContinue} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'chat' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Chat</button>
                <button onClick={() => setMobileTab('preview')} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'preview' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Preview</button>
            </div>
            <div className="relative" ref={mobilePublishRef}>
                <button 
                    onClick={() => setShowPublishDropdown(!showPublishDropdown)}
                    disabled={isManualDeploying || isAutoDeploying}
                ><ExternalLink size={20} className="text-slate-600 dark:text-slate-300" /></button>
                {showPublishDropdown && <div className={`absolute top-full mt-2 z-50 ${dir === 'rtl' ? 'left-0' : 'right-0'}`}>
                    <PublishDropdown 
                        project={project} 
                        user={user} 
                        onManageDomains={() => { setShowPublishDropdown(false); setShowManageDomains(true); }} 
                        onClose={() => setShowPublishDropdown(false)} 
                        onUpdate={fetchProject}
                        onDeployStart={handleManualDeployStart}
                        onDeployComplete={handleManualDeployComplete}
                    />
                </div>}
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden relative">
            <div className={`${isMobile ? (mobileTab === 'chat' ? 'w-full' : 'hidden') : (isSidebarOpen ? 'flex' : 'hidden')} flex-col border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0f172a] transition-all duration-300 relative`} style={{ width: isMobile ? '100%' : `${sidebarWidth}px` }}>
                <ChatInterface 
                    user={user}
                    messages={project.messages}
                    onSendMessage={(content, images) => handleSendMessage(content, images)}
                    onUploadImage={handleUploadImage}
                    onStop={handleStop}
                    onRetry={handleRetry}
                    onContinue={handleContinue}
                    onAutoFix={handleAutoFix}
                    onClearBuildState={handleClearBuildState}
                    onConnectDatabase={() => handleConnectCloud()}
                    onSkipBackend={handleSkipBackend}
                    isThinking={isThinking}
                    isAutoRepairing={isAutoRepairing}
                    isResumable={isResumable}
                    suggestions={suggestions}
                    isSuggestionsLoading={isSuggestionsLoading}
                    runtimeError={runtimeError}
                    cloudConnectionStatus={uiCloudStatus}
                    cloudConnectionError={localCloudError}
                    onCloudConnectRetry={handleCloudConnectRetry}
                    onClearCloudConnectionState={handleClearCloudConnectionState}
                    onViewTrace={handleViewTrace}
                />
                {!isMobile && <div className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10" onMouseDown={startResizing} />}
            </div>

            <div className={`flex-1 bg-slate-100 dark:bg-black/50 relative overflow-hidden flex flex-col items-center justify-center ${isMobile && mobileTab !== 'preview' ? 'hidden' : 'flex'}`}>
                {isDeployingAnywhere && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
                        <div className="flex flex-col items-center gap-6">
                            <div className="relative">
                                <Rocket className="w-16 h-16 text-indigo-500 animate-bounce" />
                                <div className="absolute inset-0 bg-indigo-500/30 blur-2xl rounded-full"></div>
                            </div>
                            <div className="flex flex-col items-center gap-2">
                                <h3 className="text-xl font-bold tracking-tight">{isManualDeploying ? "Deploying to Web..." : "Launching to Web..."}</h3>
                                <p className="text-slate-400 text-sm">Validating assets and pushing to Vercel edge network</p>
                            </div>
                            <div className="w-64 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 w-1/2 animate-[shimmer_1.5s_infinite] rounded-full relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12 animate-[slide_1s_infinite]"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                <div className={`transition-all duration-300 ${deviceSizeClass} ${deviceMode !== 'desktop' ? 'my-8 shadow-2xl border-8 border-slate-800 rounded-[2rem] overflow-hidden bg-white' : ''}`}>
                    {viewMode === 'preview' ? (
                        <PreviewCanvas 
                            code={project.code} 
                            files={project.files}
                            isGenerating={isThinking}
                            isUpdating={isUpdating}
                            onRuntimeError={handleRuntimeError} 
                            projectId={project.id}
                            active={!isMobile || mobileTab === 'preview'}
                            externalUrl={previewUrl}
                            project={project}
                        />
                    ) : (
                        <CodeEditor 
                            code={project.code} 
                            files={project.files}
                            isThinking={isThinking}
                            active={!isMobile || mobileTab === 'preview'}
                        />
                    )}
                </div>
            </div>
        </div>
        {showManageDomains && <ManageDomainsModal project={project} user={user} onClose={() => setShowManageDomains(false)} onUpdate={fetchProject} />}
    </div>
  );
};

export default ProjectBuilder;
