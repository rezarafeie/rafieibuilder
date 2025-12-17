import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Project, Message, ViewMode, User, Suggestion, BuildState, VercelConfig } from '../types';
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
import ProjectLogModal, { LogEntry } from './ProjectLogModal';
import { 
    Loader2, ArrowLeft, PanelLeft, Monitor, Tablet, Smartphone, 
    Check, Cloud, MessageSquare, Eye, Globe, X, LayoutDashboard, 
    ExternalLink, Power, FileText, Rocket, AlertTriangle
} from 'lucide-react';

interface ProjectBuilderProps {
    user: User;
}

type DeviceMode = 'desktop' | 'tablet' | 'mobile';

const MAX_AUTO_REPAIRS = 3;

const ProjectBuilder: React.FC<ProjectBuilderProps> = ({ user }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [buildState, setBuildState] = useState<BuildState | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isSuggestionsLoading, setIsSuggestionsLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  
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
  const [isAutoDeploying, setIsAutoDeploying] = useState(false); // For auto-deploy after AI build (Disabled now, kept for manual hooks if needed)
  const [isManualDeploying, setIsManualDeploying] = useState(false); // For user-triggered publish
  const [manualDeployError, setManualDeployError] = useState<string | null>(null);
  const [fallbackToLocalPreview, setFallbackToLocalPreview] = useState(false); // New state to force local preview on deploy failure

  const projectRef = useRef<Project | null>(null);
  const lastSuggestionMessageIdRef = useRef<string | null>(null);
  const failedSuggestionAttemptsRef = useRef<Record<string, number>>({});
  
  const connectingRef = useRef(false);
  const autoRepairAttemptsRef = useRef(0);
  const isAutoFixingRef = useRef(false);
  const isUserStoppedRef = useRef(false);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStartRef = useRef(false); // To prevent double triggers
  
  const [viewMode, setViewMode] = useState<ViewMode>('preview');
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview'>('chat');
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  
  // State for sidebar resizing
  const [isResizing, setIsResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(400); // Initial sidebar width
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Sidebar open/close state
  
  const [showPublishDropdown, setShowPublishDropdown] = useState(false);
  const [showManageDomains, setShowManageDomains] = useState(false);
  
  const [showCloudDetails, setShowCloudDetails] = useState(false);
  const [localCloudError, setLocalCloudError] = useState<string | null>(null);

  // Log State
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [previewLogs, setPreviewLogs] = useState<LogEntry[]>([]);// Clear the preview logs
  const [cloudLogs, setCloudLogs] = useState<LogEntry[]>([]);
  const [vercelLogs, setVercelLogs] = useState<LogEntry[]>([]);

  // Refs for Repair Loop Bridge
  const repairResolverRef = useRef<((result: {success: boolean, error?: string}) => void) | null>(null);

  const desktopPublishRef = useRef<HTMLDivElement>(null);
  const mobilePublishRef = useRef<HTMLDivElement>(null);

  const { t, dir } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  
  const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
  
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

  // Unified Deployment state for overlay
  const isDeployingAnywhere = isAutoDeploying || isManualDeploying;

  // FORCE LOCAL PREVIEW: We always return undefined for externalUrl to ensure the iframe uses srcDoc (generated code).
  // The Vercel URL is still accessible via the Publish Dropdown.
  const previewUrl = undefined; 

  // Safe wrapper for runtime errors to prevent flashing on initial load
  const handleRuntimeError = (error: string) => {
      // Check if we are in an active repair loop
      if (repairResolverRef.current) {
          // If error occurs during repair validation wait, reject the promise with the error
          repairResolverRef.current({ success: false, error });
          repairResolverRef.current = null; // Clear resolver
          return;
      }

      // If the project code is effectively empty (fresh skeleton), suppress errors
      // as they are likely due to the empty state being rendered by the iframe.
      if (project && (!project.code.html && !project.files?.length)) return;
      if (isFirstGeneration) return;
      
      setRuntimeError(error);
  };

  // Persist pendingPrompt to localStorage
  useEffect(() => {
      if (projectId) {
          if (pendingPrompt) {
              localStorage.setItem(`pending_prompt_${projectId}`, JSON.stringify(pendingPrompt));
          } else {
              localStorage.removeItem(`pending_prompt_${projectId}`);
          }
      }
  }, [pendingPrompt, projectId]);

  const startResizing = useCallback(() => { setIsResizing(true); }, []);
  const stopResizing = useCallback(() => { setIsResizing(false); }, []);

  const resize = useCallback((mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
          const newWidth = mouseMoveEvent.clientX;
          if (newWidth > 300 && newWidth < 800) {
              setSidebarWidth(newWidth);
          }
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
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
      };
  }, [isResizing, resize, stopResizing]);

  // Log Message Listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'PREVIEW_LOG' && event.data.payload) {
            setPreviewLogs(prev => [...prev.slice(-200), event.data.payload]);
        }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // SAFETY WATCHDOG
  useEffect(() => {
      // This watchdog prevents the build from getting stuck in the initial analysis phase.
      // The condition checks if the build is running but no build 'phases' have been created yet.
      if (isBuilding && buildState && (!buildState.phases || buildState.phases.length === 0)) {
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
          watchdogRef.current = setTimeout(() => {
              console.warn("Watchdog triggered: Stuck in analysis phase. Forcing restart...");
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
                  if (lastUserMsg) {
                      handleSendMessage(lastUserMsg.content || '', [], updated, true);
                  }
              }
          }, 240000); // 4-minute timeout
      } else {
          // If a plan exists or the build isn't running, clear any existing timeout.
          if (watchdogRef.current) clearTimeout(watchdogRef.current);
      }
      return () => { if (watchdogRef.current) clearTimeout(watchdogRef.current); };
  }, [isBuilding, buildState?.phases]); // Depend on the phases array itself.


  useEffect(() => {
      projectRef.current = project;
      
      // Auto-start build for fresh skeleton projects
      if (project && project.status === 'idle' && project.messages.length === 1 && project.messages[0].role === 'user' && !project.code.javascript && !autoStartRef.current) {
          autoStartRef.current = true;
          const prompt = project.messages[0].content || '';
          const images = project.messages[0].images?.map(url => ({ url, base64: '' })) || [];
          console.log("Auto-triggering initial build for new project...");
          handleSendMessage(prompt, images, project, true); 
      }

      // Check if project became active and we have a pending prompt to execute
      if (project?.rafieiCloudProject?.status === 'ACTIVE' && pendingPrompt) {
          const promptToExecute = { ...pendingPrompt };
          setPendingPrompt(null); // Clear pending

          const successMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            type: 'build_status', // Use new type
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
          console.error("Failed to load project:", err);
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
    setFallbackToLocalPreview(false); // Reset on project load
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    const { unsubscribe } = cloudService.subscribeToProjectChanges(projectId, (updatedProject) => {
      setProject(updatedProject);
      setBuildState(updatedProject.buildState || null);
    });
    return () => { unsubscribe(); }; // Explicit void return to fix TS error
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
            type: 'build_status', // Use new type
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
  
  const handleAutoFix = () => {
      if (project) {
          isAutoFixingRef.current = true;
          setRuntimeError(null);

          // Clear any previous resolver to avoid leaks
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
                  // Set the resolver that handleRuntimeError will call if an error occurs
                  repairResolverRef.current = resolve;
                  
                  // Set a timeout to assume success if no error occurs
                  setTimeout(() => {
                      if (repairResolverRef.current === resolve) { // Check if still the active resolver
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
              waitForPreview
          ).catch(e => {
              console.error("Repair loop failed:", e);
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
            type: 'build_error', // Use new type
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

      // 1. Try to recover intent from pending prompt if available
      if (pendingPrompt) {
          previousIntent = pendingPrompt.content;
          previousImages = pendingPrompt.images || [];
      } else {
          // 2. Fallback: find the last user message to provide context
          const lastUserMsg = [...project.messages].reverse().find(m => m.role === 'user');
          if (lastUserMsg) {
              previousIntent = lastUserMsg.content || "";
              // Recover images attached to the last prompt so the AI can still see them
              if (lastUserMsg.images && lastUserMsg.images.length > 0) {
                  // Map URL back to object. Base64 is likely lost from memory but URL persists in DB.
                  // The service layer (geminiService) handles fetching from URL if base64 is missing.
                  previousImages = lastUserMsg.images.map(url => ({ url, base64: '' }));
              }
          }
      }

      // Explicitly reference the previous intent so the AI knows what to build
      const skipMessage = `I want to continue with my previous request: "${previousIntent}". \n\nHowever, please skip the backend connection for now. Proceed with a frontend-only implementation using mock data.`;
      
      // Clear pending state
      setPendingPrompt(null);
      
      // Send message invisibly (isHidden=true) so it doesn't clutter the UI with the system prompt, 
      // but still triggers the build process with the full context (text + images).
      await handleSendMessage(skipMessage, previousImages, project, false, false, true);
  };

  // --- MANUAL DEPLOYMENT HANDLERS (for PublishDropdown) ---
  const handleManualDeployStart = () => {
      setIsManualDeploying(true);
      setManualDeployError(null);
      setFallbackToLocalPreview(false); // Reset fallback on new attempt
  };

  const handleManualDeployComplete = useCallback(async (vercelConfig: VercelConfig | null, error: string | null) => {
      if (error) {
          setManualDeployError(error);
          setIsManualDeploying(false);
          setFallbackToLocalPreview(true); // Force local preview if deploy failed (e.g. rate limit)
      } else if (vercelConfig) {
          // Wait 2 seconds before showing the live URL to allow overlay to show completion state
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Update project state with new vercel config locally (realtime subscription will also update)
          setProject(prev => {
              if (prev) {
                  return { ...prev, vercelConfig, publishedUrl: vercelConfig.productionUrl };
              }
              return prev;
          });

          setIsManualDeploying(false);
          setShowPublishDropdown(false); // Close dropdown
      }
  }, []);

  // --- MAIN SEND MESSAGE ---
  const handleSendMessage = async (
      content: string, 
      images: { url: string; base64: string }[], 
      projectOverride?: Project, 
      isInitialAutoStart = false, 
      isAutoFix = false,
      isHidden = false // New parameter to send prompts without showing in UI
  ) => {
    const currentProject = projectOverride || projectRef.current;
    
    if (!currentProject || !user || (currentProject.status === 'generating' && !projectOverride && !isInitialAutoStart)) return;

    setSuggestions([]);
    handleClearCloudConnectionState();
    setRuntimeError(null);
    isUserStoppedRef.current = false;
    setFallbackToLocalPreview(false); // Reset fallback when starting new build

    if (!isAutoFix && !isInitialAutoStart) {
        autoRepairAttemptsRef.current = 0;
        isAutoFixingRef.current = false;
    }

    let updatedProject = currentProject;

    // Only add user message to UI if NOT hidden and NOT initial auto-start
    if (!isInitialAutoStart && !isHidden) {
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

    // Using translation keys for logs instead of hardcoded English
    const initialLogs = [
        t('initBuild'),
        t('analyzingReq'),
        t('preparingEnv')
    ];
    
    setBuildState({
        plan: [],
        phases: [],
        currentPhaseIndex: 0,
        currentStep: 0,
        lastCompletedStep: -1,
        error: null,
        logs: initialLogs
    });

    try {
        let projectToBuild = { ...updatedProject };
        
        if (projectToBuild.messages.filter(m => m.role === 'user').length === 1) {
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
            // This is the new handleLocalStateUpdate
            setProject(prev => {
                if (!prev || prev.id !== updatedState.id) return prev;
                return updatedState;
            });
            setBuildState(updatedState.buildState || null);

            // FIX: Clear runtime errors if the build finished successfully with a passing audit
            if (updatedState.status === 'idle' && updatedState.buildState?.audit?.passed) {
                setRuntimeError(null);
            }

            if (meta?.requires_database && !pendingPrompt) {
                console.log("Database connection required, saving pending prompt.");
                setPendingPrompt({ content, images });
            }

            // --- AUTO DEPLOYMENT REMOVED ---
            // Deployment is now exclusively manual via the Publish Dropdown.
        };

        cloudService.triggerBuild(projectToBuild, content, images, onUpdateCallback);

    } catch (e: any) {
        console.error("Handle Message Error", e);
        setBuildState(prev => prev ? ({...prev, error: `Error: ${e.message}`}) : null);
        const errorMsg: Message = { 
            id: crypto.randomUUID(), 
            role: 'assistant', 
            type: 'build_error', // Use new type
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
  
  // Log Handlers
  const handleOpenLogs = async () => {
      if (!project) return;
      setIsLogModalOpen(true);
      // Fetch fresh logs on open
      try {
          const logs = await cloudService.getProjectLogs(project.id);
          setCloudLogs(logs.map(l => ({
              timestamp: new Date(l.timestamp).toISOString(),
              level: l.level as LogEntry['level'],
              message: `${l.source}: ${l.message}`
          })));
      } catch (e) {}

      // Synthesize Vercel logs
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

  const handleClearLogs = (logType: 'preview' | 'all') => {
      if (logType === 'preview') setPreviewLogs([]);
      // could add 'all' case if needed
  };

  const builderLogs = project?.buildState?.logs?.map(log => ({
      timestamp: new Date().toISOString(),
      level: 'info' as 'info',
      message: log
  })) || [];


  if (loading) return <div className="h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0f172a] text-slate-800 dark:text-white"><Loader2 className="animate-spin" size={32} /></div>;
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
            onClear={handleClearLogs}
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
                {hasCloudProject && <button onClick={() => navigate(`/cloud/${project.id}`)} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full text-xs font-medium hover:bg-emerald-100 dark:hover:bg-emerald-900/20 transition-colors"><Cloud size={12} fill="currentColor" /><span className="hidden lg:inline">Cloud Active</span></button>}
                <button onClick={handleOpenLogs} className="p-2 text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Project Logs">
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
                <button onClick={() => setMobileTab('chat')} className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${mobileTab === 'chat' ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>Chat</button>
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
                    onAutoFix={handleAutoFix}
                    onClearBuildState={handleClearBuildState}
                    onConnectDatabase={() => handleConnectCloud()}
                    onSkipBackend={handleSkipBackend}
                    isThinking={isThinking}
                    isAutoRepairing={isAutoRepairing}
                    suggestions={suggestions}
                    isSuggestionsLoading={isSuggestionsLoading}
                    runtimeError={runtimeError}
                    cloudConnectionStatus={uiCloudStatus}
                    cloudConnectionError={localCloudError}
                    onCloudConnectRetry={handleCloudConnectRetry}
                    onClearCloudConnectionState={handleClearCloudConnectionState}
                />
                {!isMobile && <div className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10" onMouseDown={startResizing} />}
            </div>

            <div className={`flex-1 bg-slate-100 dark:bg-black/50 relative overflow-hidden flex flex-col items-center justify-center ${isMobile && mobileTab !== 'preview' ? 'hidden' : 'flex'}`}>
                
                {/* Deployment Overlay */}
                {isDeployingAnywhere && (
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
                        <div className="flex flex-col items-center gap-6">
                            <div className="relative">
                                <Rocket className="w-16 h-16 text-indigo-500 animate-bounce" />
                                <div className="absolute inset-0 bg-indigo-500/30 blur-2xl rounded-full"></div>
                            </div>
                            
                            <div className="flex flex-col items-center gap-2">
                                <h3 className="text-xl font-bold tracking-tight">
                                    {isManualDeploying ? "Deploying to Web..." : "Launching to Web..."}
                                </h3>
                                <p className="text-slate-400 text-sm">Validating assets and pushing to Vercel edge network</p>
                            </div>

                            <div className="w-64 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 w-1/2 animate-[shimmer_1.5s_infinite] rounded-full relative overflow-hidden">
                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12 animate-[slide_1s_infinite]"></div>
                                </div>
                            </div>
                            
                            <style>
                                {`
                                    @keyframes shimmer {
                                        0% { transform: translateX(-100%); width: 20%; }
                                        50% { width: 80%; }
                                        100% { transform: translateX(200%); width: 20%; }
                                    }
                                    @keyframes slide {
                                        from { transform: translateX(-100%); }
                                        to { transform: translateX(200%); }
                                    }
                                `}
                            </style>
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
                            onRuntimeError={handleRuntimeError} // Use the robust handler
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