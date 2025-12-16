
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User, Project, RafieiCloudProject, ProjectFile } from '../types';
import { cloudService } from '../services/cloudService';
import { rafieiCloudService } from '../services/rafieiCloudService';
import { useTranslation, setLanguage } from '../utils/translations';
import { useTheme } from '../utils/theme';
import { constructFullDocument } from '../utils/codeGenerator';
import PreviewCanvas from './PreviewCanvas';
import PromptInputBox from './PromptInputBox';
import GitHubImportModal from './GitHubImportModal';
import CreditBalanceModal from './CreditBalanceModal';
import SqlSetupModal from './SqlSetupModal';
import { 
    Rocket, Wallet, Github, Shield, Cloud, Loader2, Trash2, Sun, Moon, LogOut, 
    Sparkles, Recycle, LayoutGrid, Undo2, X, LayoutTemplate, ChevronDown
} from 'lucide-react';

interface DashboardProps {
  user: User;
  onLogout: () => void;
  view: 'active' | 'trash';
}

const timeAgo = (timestamp: number): string => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const getProjectGradient = (id: string) => {
    const colors = [
        'from-blue-500/20 to-cyan-500/20',
        'from-indigo-500/20 to-purple-500/20',
        'from-fuchsia-500/20 to-pink-500/20',
        'from-emerald-500/20 to-teal-500/20',
        'from-orange-500/20 to-amber-500/20',
        'from-rose-500/20 to-red-500/20'
    ];
    let hash = 0;
    for(let i=0; i<id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
};

const ProjectSkeleton = () => (
    <div className="flex flex-col gap-3 p-1 animate-pulse">
        <div className="aspect-[16/10] bg-slate-200 dark:bg-slate-800 rounded-xl"></div>
        <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800"></div>
            <div className="flex-1 space-y-2">
                <div className="h-3 w-24 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-2 w-16 bg-slate-200 dark:bg-slate-800 rounded"></div>
            </div>
        </div>
    </div>
);

const CloudDetailsModal: React.FC<{
    onClose: () => void;
    rafieiProject?: RafieiCloudProject;
    customConfig?: any;
    onDisconnect: () => void;
    navigate: (path: string) => void;
}> = ({ onClose, rafieiProject, customConfig, onDisconnect, navigate }) => {
    if (!rafieiProject && !customConfig) return null;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
             <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Cloud size={20} className="text-emerald-500" />
                        {rafieiProject ? 'Rafiei Cloud' : 'Custom Backend'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white"><X size={20}/></button>
                </div>

                <div className="space-y-4">
                    <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                         {rafieiProject ? (
                             <>
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-xs text-slate-500 font-medium uppercase">Status</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full border ${rafieiProject.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-yellow-100 text-yellow-600 border-yellow-200'}`}>{rafieiProject.status}</span>
                                </div>
                                <div className="space-y-2">
                                    <div><div className="text-xs text-slate-500">Project Name</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300">{rafieiProject.projectName}</div></div>
                                    <div><div className="text-xs text-slate-500">Region</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 uppercase">{rafieiProject.region}</div></div>
                                </div>
                             </>
                         ) : (
                             <div><div className="text-xs text-slate-500">URL</div><div className="text-sm font-mono text-slate-700 dark:text-slate-300 truncate">{customConfig.url}</div></div>
                         )}
                    </div>
                </div>

                <div className="mt-8 flex flex-col gap-3">
                     <button onClick={onDisconnect} className="w-full px-4 py-2 text-sm bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-lg flex items-center justify-center gap-2"><Trash2 size={16} /> Disconnect</button>
                </div>
             </div>
        </div>
    );
};

// Intersection Observer Hook for Lazy Loading
const useInView = (options: IntersectionObserverInit) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                observer.disconnect();
            }
        }, options);

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        return () => {
            if (containerRef.current) observer.unobserve(containerRef.current);
        };
    }, [options]);

    return [containerRef, isVisible] as const;
};

const ProjectCard = React.memo(({ project, view, actionId, onSoftDelete, onRestore, onPermanentDelete, user, t }: any) => {
    const [ref, isVisible] = useInView({ rootMargin: '200px' });

    const srcDoc = React.useMemo(() => {
        const hasFiles = project.files && project.files.length > 0;
        const hasCode = project.code?.html || project.code?.javascript;
        
        if (!isVisible || (!hasCode && !hasFiles)) return null;
        
        return constructFullDocument(project.code, project.id, project.files);
    }, [project.code, project.files, project.id, isVisible]);

    return (
        <Link 
            to={view === 'active' ? `/project/${project.id}` : '#'}
            className={`group flex flex-col gap-3 p-1 ${actionId === project.id ? 'opacity-50 pointer-events-none' : ''}`}
        >
            <div ref={ref} className="relative aspect-[16/10] bg-white dark:bg-[#1e293b] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 group-hover:border-slate-400 dark:group-hover:border-slate-600 transition-all shadow-sm group-hover:shadow-lg" dir="ltr">
                {srcDoc ? (
                    <div className="absolute inset-0 w-[400%] h-[400%] origin-top-left transform scale-[0.25] pointer-events-none select-none bg-white">
                        <iframe 
                            srcDoc={srcDoc}
                            className="w-full h-full border-none"
                            tabIndex={-1}
                            scrolling="no"
                            loading="lazy"
                            title={`Preview of ${project.name}`}
                            sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups" 
                        />
                    </div>
                ) : (
                    <>
                        <div className={`absolute inset-0 bg-gradient-to-br ${getProjectGradient(project.id)} opacity-20 group-hover:opacity-30 transition-opacity`}></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="bg-white/50 dark:bg-black/20 p-4 rounded-full backdrop-blur-sm border border-white/20 shadow-sm">
                                <LayoutTemplate size={32} className="text-slate-600 dark:text-slate-300 opacity-80" />
                            </div>
                        </div>
                    </>
                )}

                <div className="absolute inset-0 bg-transparent z-10" />

                {project.status === 'generating' && (
                    <div className="absolute inset-0 z-20 bg-slate-900/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-4">
                        <div className="bg-white/10 p-2 rounded-full mb-2 border border-white/20 shadow-lg">
                            <Loader2 size={20} className="animate-spin text-indigo-400" />
                        </div>
                        <span className="text-xs font-bold text-white tracking-wider uppercase drop-shadow-md">Building...</span>
                        {project.buildState?.plan && (
                                <div className="w-24 h-1 bg-white/20 rounded-full mt-3 overflow-hidden">
                                <div 
                                    className="h-full bg-indigo-500 transition-all duration-1000 ease-out" 
                                    style={{ width: `${Math.round(((project.buildState.currentStep || 0) / (project.buildState.plan.length || 1)) * 100)}%` }}
                                />
                            </div>
                        )}
                    </div>
                )}

                {project.publishedUrl && (
                        <div className="absolute bottom-3 left-3 z-20 px-2 py-0.5 bg-white/90 dark:bg-black/60 backdrop-blur-md text-slate-800 dark:text-white text-[10px] font-medium rounded-full border border-slate-200 dark:border-white/10 flex items-center gap-1 shadow-sm">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        {t('live')}
                        </div>
                )}

                {actionId === project.id && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-20">
                        <Loader2 size={32} className="animate-spin text-indigo-600 dark:text-white" />
                    </div>
                )}
            </div>

            <div className="flex items-start justify-between px-1">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold border border-indigo-100 dark:border-indigo-500/20 shrink-0">
                        {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors truncate pr-2">{project.name}</h3>
                        <p className="text-[11px] text-slate-500 truncate">Edited {timeAgo(project.updatedAt)}</p>
                    </div>
                </div>
                
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {view === 'active' ? (
                        <button 
                            onClick={(e) => onSoftDelete(project.id, e)}
                            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
                            title={t('moveToTrash')}
                        >
                            <Trash2 size={16} />
                        </button>
                    ) : (
                        <div className="flex gap-1">
                            <button 
                                onClick={(e) => onRestore(project.id, e)}
                                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-md transition-colors"
                                title={t('restore')}
                            >
                                <Undo2 size={16} />
                            </button>
                            <button 
                                onClick={(e) => onPermanentDelete(project.id, e)}
                                className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md transition-colors"
                                title={t('deleteForever')}
                            >
                                <X size={16} />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
});

const Dashboard: React.FC<DashboardProps> = ({ user, onLogout, view }) => {
  const navigate = useNavigate();
  const { t, dir, lang } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [projects, setProjects] = useState<Project[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isConnectingCloud, setIsConnectingCloud] = useState(false);
  const [isSystemOnline, setIsSystemOnline] = useState(true);
  
  // Pagination State
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const PROJECTS_PER_PAGE = 6;
  
  const [currentBalance, setCurrentBalance] = useState(user.credits_balance);
  const [actionId, setActionId] = useState<string | null>(null);
  
  const [showImportModal, setShowImportModal] = useState(false);
  const [showCloudDetails, setShowCloudDetails] = useState(false);
  const [showCreditModal, setShowCreditModal] = useState(false);
  const [showSqlWizard, setShowSqlWizard] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const pending = sessionStorage.getItem('rafiei_pending_prompt');
    if (pending) {
        sessionStorage.removeItem('rafiei_pending_prompt');
        try {
            const { content, images } = JSON.parse(pending);
            handleCreateProject(content, images);
        } catch(e) {}
    }
  }, []);

  const fetchData = async (isLoadMore = false) => {
    if (!isLoadMore) {
        setIsSyncing(true);
    } else {
        setIsLoadingMore(true);
    }

    try {
        const loadPromise = async () => {
            const offset = isLoadMore ? projects.length : 0;
            let fetched: Project[] = [];
            
            if (view === 'active') {
                fetched = await cloudService.getProjects(user.id, PROJECTS_PER_PAGE, offset);
            } else {
                fetched = await cloudService.getTrashedProjects(user.id, PROJECTS_PER_PAGE, offset);
            }
            
            if (isLoadMore) {
                setProjects(prev => [...prev, ...fetched]);
            } else {
                setProjects(fetched);
            }
            
            setHasMore(fetched.length === PROJECTS_PER_PAGE);

            // Always verify global stats on initial load or re-sync
            if (!isLoadMore) {
                const count = await cloudService.getTrashCount(user.id);
                setTrashCount(count);
                if (currentBalance === -1) {
                    const balance = await cloudService.getUserCredits(user.id);
                    setCurrentBalance(balance);
                }
            }
        };

        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Dashboard Load Timeout')), 10000));
        await Promise.race([loadPromise(), timeoutPromise]);
        
        setIsSystemOnline(true);
    } catch (e: any) {
        console.error("Dashboard Load Error:", e);
        setIsSystemOnline(false);
        if (e.name === 'DatabaseSetupError' || e.message.includes('TABLE_MISSING') || e.message.includes('RPC')) {
            setSqlError(e.message);
            setShowSqlWizard(true);
        }
    } finally {
        if (!isLoadMore) setIsSyncing(false);
        else setIsLoadingMore(false);
    }
  };

  // Reset on view change
  useEffect(() => {
    setProjects([]);
    setHasMore(true);
    fetchData(false);
  }, [user.id, view]);

  // Subscription for updates (Realtime)
  useEffect(() => {
    const { unsubscribe } = cloudService.subscribeToUserProjects(user.id, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            // Re-fetch only the first page to ensure fresh data at the top, or refresh current list.
            // For simplicity and correctness with "latest at top", we refresh from scratch.
            fetchData(false);
        }, 1000);
    });
    return () => {
        unsubscribe();
        if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [user.id, view]);

  const handleCreateProject = async (content: string, images: { url: string; base64: string }[]) => {
      setIsCreating(true);
      try {
          const projectId = await cloudService.createProjectSkeleton(user, content, images);
          navigate(`/project/${projectId}`);
      } catch (e) {
          alert("Failed to create project");
          setIsCreating(false);
      }
  };

  const handleImportProject = async (name: string, files: ProjectFile[]) => {
      setIsCreating(true);
      setShowImportModal(false);
      try {
          const projectId = await cloudService.createImportedProject(user, name, files);
          navigate(`/project/${projectId}`);
      } catch(e) {
          alert("Failed to import project");
          setIsCreating(false);
      }
  };

  const handleSoftDelete = async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActionId(id);
      try {
          await cloudService.softDeleteProject(id);
      } catch (e) {
          console.error(e);
      } finally {
          setActionId(null);
      }
  };

  const handleRestore = async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActionId(id);
      try {
          await cloudService.restoreProject(id);
      } catch (e) {
          console.error(e);
      } finally {
          setActionId(null);
      }
  };

  const handlePermanentDelete = async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!window.confirm(t('deleteForever') + "?")) return;
      setActionId(id);
      try {
          await cloudService.deleteProject(id);
      } catch (e) {
          console.error(e);
      } finally {
          setActionId(null);
      }
  };

  const handleDisconnect = async () => {
      setShowCloudDetails(false);
  };

  const handleToggleLanguage = () => {
      const newLang = lang === 'en' ? 'fa' : 'en';
      setLanguage(newLang);
      cloudService.saveUserLanguage(user.id, newLang).catch(console.error);
  };

  const rafieiCloudProject: RafieiCloudProject | undefined = undefined; 
  const customBackendConfig: any = undefined; 

  const greeting = (() => {
      const hour = new Date().getHours();
      if (hour < 12) return t('goodMorning');
      if (hour < 18) return t('goodAfternoon');
      return t('goodEvening');
  })();
  
  const isAdmin = user.isAdmin || user.email === 'rezarafeie13@gmail.com';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#020617] text-slate-800 dark:text-slate-200 font-sans selection:bg-indigo-500/30 pb-20 transition-colors duration-300 overflow-x-hidden" dir={dir}>
        {showImportModal && (
            <GitHubImportModal 
                onClose={() => setShowImportModal(false)}
                onImport={handleImportProject}
            />
        )}

        {showCloudDetails && (
            <CloudDetailsModal 
                onClose={() => setShowCloudDetails(false)}
                rafieiProject={rafieiCloudProject}
                customConfig={customBackendConfig}
                onDisconnect={handleDisconnect}
                navigate={navigate}
            />
        )}

        {showCreditModal && (
            <CreditBalanceModal 
                user={{ ...user, credits_balance: currentBalance }} 
                onClose={() => setShowCreditModal(false)} 
            />
        )}

        {showSqlWizard && (
            <SqlSetupModal 
                isOpen={true} 
                errorType={sqlError || "DASHBOARD_TRIGGER"} 
                onRetry={() => fetchData(false)} 
                onClose={() => setShowSqlWizard(false)} 
            />
        )}
        
        <header className="sticky top-0 z-30 w-full backdrop-blur-xl bg-white/80 dark:bg-[#020617]/80 border-b border-slate-200 dark:border-slate-800/50 transition-colors duration-300">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link to="/dashboard" className="flex items-center gap-2">
                        <div className="bg-indigo-50 dark:bg-indigo-600/10 p-1.5 rounded-lg border border-indigo-100 dark:border-indigo-500/20">
                            <Rocket size={20} className="text-indigo-600 dark:text-indigo-400" />
                        </div>
                        <span className="font-semibold text-slate-900 dark:text-white tracking-tight text-lg">{t('appName')}</span>
                        <div 
                            className={`w-2 h-2 rounded-full ml-1 ${isSystemOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} 
                            title={isSystemOnline ? "System Online" : "System Offline"}
                        ></div>
                    </Link>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={() => setShowCreditModal(true)} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/10 rounded-full border border-emerald-200 dark:border-emerald-500/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors w-[100px] justify-center">
                        <Wallet size={14} className="text-emerald-600 dark:text-emerald-400" />
                        {currentBalance === -1 ? (
                            <div className="h-4 w-12 bg-emerald-200/50 dark:bg-emerald-900/50 rounded animate-pulse"></div>
                        ) : (
                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                {Number(currentBalance).toFixed(2)}
                            </span>
                        )}
                    </button>

                    <button onClick={() => setShowImportModal(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700">
                        <Github size={12} /> <span className="hidden sm:inline">Import</span>
                    </button>

                    {isAdmin && (
                        <Link to="/admin" className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold hover:opacity-90 transition-all shadow-sm">
                            <Shield size={12} /> {t('admin')}
                        </Link>
                    )}
                    
                    <Link to={view === 'trash' ? '/dashboard' : '/dashboard/trash'} className={`p-2 rounded-lg transition-colors relative ${view === 'trash' ? 'text-indigo-600 dark:text-white bg-indigo-50 dark:bg-slate-800' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'}`} title={t('trash')}>
                        <Trash2 size={18} />
                        {trashCount > 0 && view !== 'trash' && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>}
                    </Link>

                    <button onClick={toggleTheme} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>

                    <button onClick={handleToggleLanguage} className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors uppercase font-bold text-xs">
                        {lang}
                    </button>

                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>
                    
                    <div className="flex items-center gap-3 group relative cursor-pointer">
                        <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold overflow-hidden border-2 border-white dark:border-slate-800 shadow-md">
                            {user.avatar ? <img src={user.avatar} alt="avatar" className="w-full h-full object-cover"/> : user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="absolute top-full right-0 rtl:right-auto rtl:left-0 mt-2 w-32 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-1 opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-all duration-200 z-50">
                            <button onClick={() => setShowCreditModal(true)} className="w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 rounded flex items-center gap-2">
                                <Wallet size={12} /> {t('manageCredits')}
                            </button>
                            <button onClick={onLogout} className="w-full text-left px-3 py-2 text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 rounded flex items-center gap-2 border-t border-slate-100 dark:border-slate-700">
                                <LogOut size={12} /> {t('logout')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 flex flex-col gap-10">
            {view === 'active' ? (
                <div className="flex flex-col items-center justify-center space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h1 className="text-3xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-slate-900 via-slate-700 to-slate-500 dark:from-white dark:via-slate-200 dark:to-slate-400 text-center tracking-tight">
                        {greeting}, {user.name.split(' ')[0]}
                    </h1>
                    <div className="w-full max-w-2xl">
                        <PromptInputBox 
                            onSendMessage={handleCreateProject}
                            isThinking={isCreating}
                        />
                    </div>
                </div>
            ) : (
                <div className="flex flex-col items-center justify-center space-y-4 py-8">
                    <div className="p-4 bg-red-500/10 rounded-full border border-red-500/20">
                        <Trash2 size={32} className="text-red-500 dark:text-red-400" />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('trash')}</h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm max-w-md text-center">{t('trashDesc')}</p>
                </div>
            )}

            <div className="space-y-6">
                <div className="flex items-center justify-between pb-2">
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                        {view === 'active' ? <Sparkles size={18} className="text-indigo-500 dark:text-indigo-400"/> : <Recycle size={18} className="text-red-500 dark:text-red-400"/>}
                        {view === 'active' ? t('projects') : t('trash')}
                    </h3>
                    {isSyncing && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> {t('syncing')}</div>}
                </div>

                {isSyncing && projects.length === 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[1, 2, 3, 4, 5, 6].map((i) => (
                            <ProjectSkeleton key={i} />
                        ))}
                    </div>
                ) : projects.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 rounded-2xl bg-slate-100 dark:bg-slate-900/30 border border-dashed border-slate-300 dark:border-slate-800/50">
                        <div className="p-4 bg-slate-200 dark:bg-slate-800/50 rounded-full mb-3">
                            {view === 'trash' ? <Trash2 size={24} className="text-slate-500 dark:text-slate-600"/> : <LayoutGrid size={24} className="text-slate-500 dark:text-slate-600"/>}
                        </div>
                        <p className="text-slate-500 text-sm font-medium">{view === 'trash' ? t('emptyTrash') : t('noProjectsYet')}</p>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {projects.map((project) => (
                                <ProjectCard
                                    key={project.id}
                                    project={project}
                                    view={view}
                                    actionId={actionId}
                                    onSoftDelete={handleSoftDelete}
                                    onRestore={handleRestore}
                                    onPermanentDelete={handlePermanentDelete}
                                    user={user}
                                    t={t}
                                />
                            ))}
                        </div>
                        {hasMore && (
                            <div className="flex justify-center pt-4">
                                <button 
                                    onClick={() => fetchData(true)} 
                                    disabled={isLoadingMore}
                                    className="flex items-center gap-2 px-6 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                                >
                                    {isLoadingMore ? <Loader2 size={16} className="animate-spin" /> : <ChevronDown size={16} />}
                                    Load More Projects
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </main>
    </div>
  );
};

export default Dashboard;
