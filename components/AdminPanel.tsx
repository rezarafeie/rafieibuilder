import React, { useState, useEffect } from 'react';
import { User, Project, SystemLog, AdminMetric, FinancialStats, CreditLedgerEntry, WebhookLog, AIProviderConfig, AIProviderId } from '../types';
import { cloudService, supabase } from '../services/cloudService';
import { aiProviderService } from '../services/aiProviderService';
import SqlSetupModal from './SqlSetupModal';
import { PROMPT_KEYS } from '../services/geminiService';
import { 
    Activity, Users, Box, Brain, AlertTriangle, Terminal, 
    Shield, Settings, RefreshCw, X, Database, Loader2, 
    DollarSign, TrendingUp, CreditCard, Check, Search, 
    Clock, Calendar, FileText, ChevronRight, Save, Menu, Zap, Scale, BarChart3, Radio, Send, ToggleLeft, ToggleRight, Lock, Key, Filter,
    FileJson, MessageSquare, Eye, EyeOff, Copy, ChevronLeft, ChevronRight as ArrowRightIcon, Trash2,
    TrendingDown,
    Cpu,
    ExternalLink
} from 'lucide-react';

interface AdminPanelProps {
    user: User;
    onClose: () => void;
}

type AdminView = 'dashboard' | 'financials' | 'users' | 'projects' | 'ai' | 'webhooks' | 'errors' | 'settings';

const getErrorMessage = (e: any): string => {
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    return String(e);
};

const PaginationControls: React.FC<{ 
    currentPage: number, 
    totalItems: number, 
    itemsPerPage: number, 
    onPageChange: (p: number) => void 
}> = ({ currentPage, totalItems, itemsPerPage, onPageChange }) => {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (totalPages <= 1) return null;

    return (
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/50 border-t border-slate-700/50">
            <span className="text-xs text-slate-400">
                Showing <span className="font-medium text-white">{(currentPage - 1) * itemsPerPage + 1}</span> to <span className="font-medium text-white">{Math.min(currentPage * itemsPerPage, totalItems)}</span> of <span className="font-medium text-white">{totalItems}</span> results
            </span>
            <div className="flex gap-1">
                <button 
                    onClick={() => onPageChange(currentPage - 1)} 
                    disabled={currentPage === 1}
                    className="p-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={16} />
                </button>
                <button 
                    onClick={() => onPageChange(currentPage + 1)} 
                    disabled={currentPage === totalPages}
                    className="p-1.5 rounded-md bg-slate-800 border border-slate-700 text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ArrowRightIcon size={16} />
                </button>
            </div>
        </div>
    );
};

const GenerationDetailsModal: React.FC<{ entry: CreditLedgerEntry; onClose: () => void }> = ({ entry, onClose }) => {
    const [activeTab, setActiveTab] = useState<'prompts' | 'response' | 'financials'>('prompts');
    const [copied, setCopied] = useState<string | null>(null);

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopied(label);
        setTimeout(() => setCopied(null), 2000);
    };

    const meta = entry.meta || {};

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-slate-900 border border-slate-700 w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400">
                            <Brain size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">Generation Inspector</h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-slate-500 font-mono">{entry.id}</span>
                                <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded uppercase font-bold tracking-widest">{entry.model}</span>
                            </div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors"><X size={24}/></button>
                </div>

                {/* Body */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Navigation */}
                    <div className="w-52 border-r border-slate-800 p-4 space-y-2 shrink-0">
                        <button onClick={() => setActiveTab('prompts')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'prompts' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>Prompts</button>
                        <button onClick={() => setActiveTab('response')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'response' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>AI Response</button>
                        <button onClick={() => setActiveTab('financials')} className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all ${activeTab === 'financials' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}`}>Transaction Data</button>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 overflow-y-auto p-6 bg-slate-950/50">
                        {activeTab === 'prompts' && (
                            <div className="space-y-8 animate-in slide-in-from-bottom-2">
                                <section>
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">System Instructions</h4>
                                        <button onClick={() => handleCopy(meta.systemPrompt || '', 'sys')} className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1">
                                            {copied === 'sys' ? <Check size={10}/> : <Copy size={10}/>} {copied === 'sys' ? 'Copied' : 'Copy All'}
                                        </button>
                                    </div>
                                    <pre className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap overflow-x-auto min-h-[100px]">
                                        {meta.systemPrompt || 'No instructions captured.'}
                                    </pre>
                                </section>
                                <section>
                                    <div className="flex justify-between items-center mb-3">
                                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">User Request / Step Context</h4>
                                        <button onClick={() => handleCopy(meta.userPrompt || '', 'user')} className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1">
                                            {copied === 'user' ? <Check size={10}/> : <Copy size={10}/>} {copied === 'user' ? 'Copied' : 'Copy All'}
                                        </button>
                                    </div>
                                    <pre className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-mono text-indigo-300 leading-relaxed whitespace-pre-wrap overflow-x-auto min-h-[100px]">
                                        {meta.userPrompt || 'No prompt captured.'}
                                    </pre>
                                </section>
                            </div>
                        )}

                        {activeTab === 'response' && (
                            <div className="h-full flex flex-col animate-in slide-in-from-bottom-2">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Raw Output</h4>
                                    <button onClick={() => handleCopy(meta.aiResponse || '', 'resp')} className="text-[10px] text-indigo-400 hover:underline flex items-center gap-1">
                                        {copied === 'resp' ? <Check size={10}/> : <Copy size={10}/>} {copied === 'resp' ? 'Copied' : 'Copy All'}
                                    </button>
                                </div>
                                <pre className="flex-1 p-6 bg-slate-900 border border-slate-800 rounded-2xl text-xs font-mono text-emerald-400 leading-relaxed whitespace-pre-wrap overflow-auto">
                                    {meta.aiResponse || 'No response captured.'}
                                </pre>
                            </div>
                        )}

                        {activeTab === 'financials' && (
                            <div className="space-y-6 animate-in slide-in-from-bottom-2">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Input Tokens</div>
                                        <div className="text-xl font-bold">{entry.inputTokens.toLocaleString()}</div>
                                    </div>
                                    <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800">
                                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Output Tokens</div>
                                        <div className="text-xl font-bold">{entry.outputTokens.toLocaleString()}</div>
                                    </div>
                                    <div className="bg-red-500/5 p-4 rounded-2xl border border-red-500/20">
                                        <div className="text-[10px] text-red-400/70 font-bold uppercase tracking-widest mb-1">Raw API Cost</div>
                                        <div className="text-xl font-bold text-red-400">${entry.rawCostUsd.toFixed(6)}</div>
                                    </div>
                                    <div className="bg-emerald-500/5 p-4 rounded-2xl border border-emerald-500/20">
                                        <div className="text-[10px] text-emerald-400/70 font-bold uppercase tracking-widest mb-1">User Charged</div>
                                        <div className="text-xl font-bold text-emerald-400">{entry.creditsDeducted.toFixed(4)} CR</div>
                                    </div>
                                </div>
                                
                                <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800">
                                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Metadata Context</h4>
                                    <div className="grid grid-cols-2 gap-y-4 text-sm">
                                        <div className="text-slate-500">Operation Type</div><div className="text-white font-mono">{entry.operationType}</div>
                                        <div className="text-slate-500">Timestamp</div><div className="text-white">{new Date(entry.createdAt).toLocaleString()}</div>
                                        <div className="text-slate-500">Project ID</div><div className="text-indigo-400 font-mono flex items-center gap-2">{entry.projectId || 'N/A'} {entry.projectId && <ExternalLink size={12}/>}</div>
                                        <div className="text-slate-500">User ID</div><div className="text-slate-300 font-mono truncate">{entry.userId}</div>
                                        <div className="text-slate-500">Profit Margin</div><div className="text-slate-300">{entry.profitMargin}%</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const AdminPanel: React.FC<AdminPanelProps> = ({ user, onClose }) => {
    const [view, setView] = useState<AdminView>('dashboard');
    const [aiSubView, setAiSubView] = useState<'config' | 'logs'>('config');
    const [projects, setProjects] = useState<Project[]>([]);
    const [allUsers, setAllUsers] = useState<any[]>([]);
    const [stats, setStats] = useState<AdminMetric[]>([]);
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [prompts, setPrompts] = useState<Record<string, string>>({});
    const [currentPage, setCurrentPage] = useState(1);
    const [totalItems, setTotalItems] = useState(0);
    const ITEMS_PER_PAGE = 10;
    const [isLoading, setIsLoading] = useState(false);
    const [dataError, setDataError] = useState<string | null>(null);
    const [isSavingPrompts, setIsSavingPrompts] = useState(false);
    const [aiConfigs, setAiConfigs] = useState<AIProviderConfig[]>([]);
    
    // Financials
    const [financialStats, setFinancialStats] = useState<FinancialStats>({
        totalRevenueCredits: 0,
        totalCostUsd: 0,
        netProfitUsd: 0,
        totalCreditsPurchased: 0,
        currentMargin: 0.5,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequestCount: 0
    });
    const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
    const [selectedGeneration, setSelectedGeneration] = useState<CreditLedgerEntry | null>(null);
    
    // Users
    const [targetUser, setTargetUser] = useState<any | null>(null);
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');
    const [isAdjusting, setIsAdjusting] = useState(false);
    
    // Webhooks
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
    const [isSavingWebhook, setIsSavingWebhook] = useState(false);

    // AI Editing
    const [editingProviderId, setEditingProviderId] = useState<AIProviderId | null>(null);
    const [tempApiKey, setTempApiKey] = useState('');
    const [tempModel, setTempModel] = useState('');
    const [isSavingAI, setIsSavingAI] = useState(false);

    const [showSqlWizard, setShowSqlWizard] = useState(false);

    useEffect(() => {
        setCurrentPage(1);
        setDataError(null);
    }, [view, aiSubView]);

    useEffect(() => {
        loadViewData();
    }, [view, aiSubView, currentPage]);

    const loadViewData = async () => {
        setIsLoading(true);
        setDataError(null);
        try {
            if (view === 'dashboard') {
                await loadDashboardStats();
            } else if (view === 'projects') {
                const { data, count } = await cloudService.getAdminProjects(currentPage, ITEMS_PER_PAGE);
                setProjects(data);
                setTotalItems(count);
            } else if (view === 'users') {
                const { data, count } = await cloudService.getAdminUsers(currentPage, ITEMS_PER_PAGE);
                setAllUsers(data);
                setTotalItems(count);
            } else if (view === 'errors') {
                const { data, count } = await cloudService.getSystemLogs(currentPage, ITEMS_PER_PAGE);
                setLogs(data);
                setTotalItems(count);
            } else if (view === 'financials') {
                const fStats = await cloudService.getFinancialStats();
                setFinancialStats(fStats);
                const { data, count } = await cloudService.getLedger(currentPage, ITEMS_PER_PAGE);
                setLedger(data);
                setTotalItems(count);
            } else if (view === 'webhooks') {
                const url = await cloudService.getSystemSetting('webhook_url');
                if (url) setWebhookUrl(url);
                const { data, count } = await cloudService.getWebhookLogs(currentPage, ITEMS_PER_PAGE);
                setWebhookLogs(data);
                setTotalItems(count);
            } else if (view === 'ai') {
                if (aiSubView === 'config') {
                    const configs = await aiProviderService.getAllConfigs();
                    setAiConfigs(configs);
                } else {
                    const { data, count } = await cloudService.getLedger(currentPage, ITEMS_PER_PAGE);
                    setLedger(data);
                    setTotalItems(count);
                }
            } else if (view === 'settings') {
                const dbSettings = await cloudService.getSystemSettings(Object.values(PROMPT_KEYS));
                const loaded: Record<string, string> = {};
                dbSettings.forEach(s => loaded[s.key] = s.value);
                setPrompts(loaded);
            }
        } catch (err: unknown) {
            setDataError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const loadDashboardStats = async () => {
        try {
            const { count: userCount } = await supabase.from('user_settings').select('user_id', { count: 'exact', head: true });
            const { count: projectCount } = await supabase.from('projects').select('id', { count: 'exact', head: true });
            const { count: errorCount } = await supabase.from('system_logs').select('id', { count: 'exact', head: true }).eq('level', 'error');

            setStats([
                { label: 'Total Users', value: userCount || 0, status: 'good' },
                { label: 'Active Projects', value: projectCount || 0, status: 'good' },
                { label: 'AI Success Rate', value: '94.2%', status: 'good' },
                { label: 'Active Issues', value: errorCount || 0, status: errorCount && errorCount > 0 ? 'warning' : 'good' }
            ]);
        } catch (e) {
            // Stats load failure is non-fatal for UI
        }
    };

    const handleSaveAI = async (id: AIProviderId, isActive: boolean, isFallback: boolean) => {
        setIsSavingAI(true);
        try {
            await aiProviderService.saveConfig({
                id,
                model: tempModel,
                apiKey: tempApiKey || undefined,
                isActive,
                isFallback
            });
            setEditingProviderId(null);
            setTempApiKey('');
            await loadViewData();
        } catch (err: unknown) {
            alert(getErrorMessage(err));
        } finally {
            setIsSavingAI(false);
        }
    };

    const handleSaveWebhook = async () => {
        setIsSavingWebhook(true);
        try {
            await cloudService.setSystemSetting('webhook_url', webhookUrl);
            alert("Webhook URL updated.");
        } catch (err: unknown) {
            alert(getErrorMessage(err));
        } finally {
            setIsSavingWebhook(false);
        }
    };

    const handleAdjustCredits = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!targetUser || !adjustmentAmount) return;
        setIsAdjusting(true);
        try {
            await cloudService.adminAdjustCredit(targetUser.id, parseFloat(adjustmentAmount), adjustmentNote);
            alert("Credits adjusted successfully!");
            setAdjustmentAmount('');
            setAdjustmentNote('');
            setTargetUser(null);
            loadViewData();
        } catch (err: unknown) {
            alert(getErrorMessage(err));
        } finally {
            setIsAdjusting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-950 text-white flex flex-col z-[60] font-sans">
            {selectedGeneration && <GenerationDetailsModal entry={selectedGeneration} onClose={() => setSelectedGeneration(null)} />}
            
            <header className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-900 shrink-0">
                <div className="flex items-center gap-4">
                    <Shield className="text-indigo-500" size={24} />
                    <h1 className="font-bold text-xl tracking-tight">Admin Control Panel</h1>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={() => setShowSqlWizard(true)} className="p-2 text-slate-400 hover:text-white transition-colors" title="DB Setup">
                        <Database size={20} />
                    </button>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                <nav className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col p-4 gap-2 shrink-0">
                    {[
                        { id: 'dashboard', label: 'Dashboard', icon: <Activity size={18} /> },
                        { id: 'financials', label: 'Financials & Credits', icon: <DollarSign size={18} /> },
                        { id: 'users', label: 'User Management', icon: <Users size={18} /> },
                        { id: 'projects', label: 'All Projects', icon: <Box size={18} /> },
                        { id: 'ai', label: 'AI Providers', icon: <Brain size={18} /> },
                        { id: 'webhooks', label: 'Webhooks', icon: <Radio size={18} /> },
                        { id: 'errors', label: 'Error Logs', icon: <AlertTriangle size={18} /> },
                        { id: 'settings', label: 'System Prompts', icon: <Settings size={18} /> }
                    ].map(item => (
                        <button
                            key={item.id}
                            onClick={() => setView(item.id as AdminView)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                                view === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                            }`}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                </nav>

                <main className="flex-1 overflow-y-auto p-8 relative">
                    {isLoading && (
                        <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm z-50 flex items-center justify-center">
                            <Loader2 className="animate-spin text-indigo-500" size={48} />
                        </div>
                    )}

                    {dataError && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-3 text-red-400">
                            <AlertTriangle size={20} />
                            <p className="text-sm font-medium">{dataError}</p>
                        </div>
                    )}

                    {view === 'dashboard' && (
                        <div className="space-y-8">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {stats.map((s, i) => (
                                    <div key={i} className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                                        <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">{s.label}</div>
                                        <div className="text-2xl font-bold">{s.value}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-slate-500 h-64">
                                <TrendingUp size={48} className="opacity-20 mb-4" />
                                <p>Project Growth Charts arriving soon.</p>
                            </div>
                        </div>
                    )}

                    {view === 'projects' && (
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                            <div className="p-4 bg-slate-900 border-b border-slate-800">
                                <h3 className="font-bold">Project Directory</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                            <th className="px-6 py-4">Project Name</th>
                                            <th className="px-6 py-4">Owner ID</th>
                                            <th className="px-6 py-4">Status</th>
                                            <th className="px-6 py-4">Created</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800">
                                        {projects.map(p => (
                                            <tr key={p.id} className="hover:bg-slate-800/30">
                                                <td className="px-6 py-4">
                                                    <div className="font-medium">{p.name}</div>
                                                    <div className="text-[10px] text-slate-500 font-mono">{p.id}</div>
                                                </td>
                                                <td className="px-6 py-4 text-xs text-slate-400 font-mono">{p.userId}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${p.status === 'generating' ? 'bg-indigo-500/20 text-indigo-400' : p.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                                                        {p.status}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-slate-400 text-xs">{new Date(p.createdAt).toLocaleDateString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
                        </div>
                    )}

                    {view === 'financials' && (
                        <div className="space-y-8">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-emerald-500/5 border border-emerald-500/20 p-6 rounded-2xl">
                                    <div className="flex justify-between items-start mb-4">
                                        <DollarSign className="text-emerald-500" size={24} />
                                        <TrendingUp className="text-emerald-500/50" size={16} />
                                    </div>
                                    <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Est. Revenue</div>
                                    <div className="text-3xl font-bold text-emerald-500">{(financialStats.totalRevenueCredits || 0).toFixed(2)} <span className="text-sm font-medium">Credits</span></div>
                                </div>
                                <div className="bg-red-500/5 border border-red-500/20 p-6 rounded-2xl">
                                    <div className="flex justify-between items-start mb-4">
                                        <Cpu className="text-red-400" size={24} />
                                        <TrendingDown className="text-red-400/50" size={16} />
                                    </div>
                                    <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Total API Cost</div>
                                    <div className="text-3xl font-bold text-red-400">${(financialStats.totalCostUsd || 0).toFixed(4)} <span className="text-sm font-medium">USD</span></div>
                                </div>
                                <div className="bg-indigo-500/5 border border-indigo-500/20 p-6 rounded-2xl">
                                    <div className="flex justify-between items-start mb-4">
                                        <Scale className="text-indigo-400" size={24} />
                                        <Check className="text-indigo-400/50" size={16} />
                                    </div>
                                    <div className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-1">Current Margin</div>
                                    <div className="text-3xl font-bold text-indigo-400">{(financialStats.currentMargin || 0).toFixed(1)}%</div>
                                </div>
                            </div>

                            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                                    <h3 className="font-bold">Transaction Ledger</h3>
                                    <div className="text-xs text-slate-500">Total Tokens Processed: <span className="text-slate-300">{( (financialStats.totalInputTokens || 0) + (financialStats.totalOutputTokens || 0) ).toLocaleString()}</span></div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead>
                                            <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                                <th className="px-6 py-4">Timestamp</th>
                                                <th className="px-6 py-4">User</th>
                                                <th className="px-6 py-4">Model</th>
                                                <th className="px-6 py-4">Tokens</th>
                                                <th className="px-6 py-4">Cost (USD)</th>
                                                <th className="px-6 py-4">Billed (CR)</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                                            {ledger.map(entry => (
                                                <tr key={entry.id} className="hover:bg-slate-800/30">
                                                    <td className="px-6 py-4 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                                                    <td className="px-6 py-4 text-slate-300 truncate max-w-[120px]">{entry.userId}</td>
                                                    <td className="px-6 py-4 text-slate-400">{entry.model}</td>
                                                    <td className="px-6 py-4 text-slate-500">I:{entry.inputTokens} O:{entry.outputTokens}</td>
                                                    <td className="px-6 py-4 text-red-400/80">${(entry.rawCostUsd || 0).toFixed(5)}</td>
                                                    <td className="px-6 py-4 text-emerald-400 font-bold">{(entry.creditsDeducted || 0).toFixed(3)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
                            </div>
                        </div>
                    )}

                    {view === 'ai' && (
                        <div className="space-y-6">
                            <div className="flex flex-col gap-2">
                                <h2 className="text-2xl font-bold">AI Provider Center</h2>
                                <div className="flex gap-2 p-1 bg-slate-900 border border-slate-800 rounded-xl w-fit">
                                    <button onClick={() => setAiSubView('config')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${aiSubView === 'config' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Provider Config</button>
                                    <button onClick={() => setAiSubView('logs')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${aiSubView === 'logs' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-300'}`}>Generation Logs</button>
                                </div>
                            </div>

                            {aiSubView === 'config' ? (
                                <div className="grid gap-6 animate-in fade-in slide-in-from-bottom-2">
                                    {aiConfigs.map(config => {
                                        const isEditing = editingProviderId === config.id;
                                        return (
                                            <div key={config.id} className={`bg-slate-900 border rounded-2xl p-6 transition-all ${config.isActive ? 'border-indigo-500 ring-1 ring-indigo-500/50' : 'border-slate-800'}`}>
                                                <div className="flex justify-between items-start mb-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`p-3 rounded-xl ${config.isActive ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'}`}>
                                                            <Brain size={24} />
                                                        </div>
                                                        <div>
                                                            <h3 className="text-lg font-bold">{config.name}</h3>
                                                            <div className="flex gap-2 mt-1">
                                                                {config.isActive && <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded font-bold uppercase">Primary Active</span>}
                                                                {config.isFallback && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold uppercase">Fallback Mode</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button 
                                                        onClick={() => {
                                                            if (isEditing) handleSaveAI(config.id, config.isActive, config.isFallback);
                                                            else {
                                                                setEditingProviderId(config.id);
                                                                setTempModel(config.model || '');
                                                                setTempApiKey('');
                                                            }
                                                        }}
                                                        className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${isEditing ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
                                                    >
                                                        {isSavingAI ? <Loader2 size={16} className="animate-spin" /> : isEditing ? 'Save Changes' : 'Edit Config'}
                                                    </button>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Model Identifier</label>
                                                        {isEditing ? (
                                                            <input 
                                                                type="text" 
                                                                value={tempModel} 
                                                                onChange={e => setTempModel(e.target.value)}
                                                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-mono focus:border-indigo-500 outline-none"
                                                                placeholder="e.g. gemini-2.5-flash"
                                                            />
                                                        ) : (
                                                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-mono text-slate-300">{config.model}</div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">API Secret Key</label>
                                                        {isEditing ? (
                                                            <input 
                                                                type="password" 
                                                                value={tempApiKey} 
                                                                onChange={e => setTempApiKey(e.target.value)}
                                                                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-mono focus:border-indigo-500 outline-none"
                                                                placeholder="Paste new key (leave empty to keep current)"
                                                            />
                                                        ) : (
                                                            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-mono text-slate-500 flex justify-between items-center">
                                                                <span>••••••••••••••••••••••••</span>
                                                                <Lock size={14} className="opacity-50" />
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {isEditing && (
                                                    <div className="mt-6 pt-6 border-t border-slate-800 flex gap-4">
                                                        <button 
                                                            onClick={() => handleSaveAI(config.id, true, false)}
                                                            className="flex-1 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 p-3 rounded-xl text-xs font-bold transition-all"
                                                        >
                                                            Set as Primary Active
                                                        </button>
                                                        <button 
                                                            onClick={() => handleSaveAI(config.id, false, true)}
                                                            className="flex-1 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 border border-amber-500/30 p-3 rounded-xl text-xs font-bold transition-all"
                                                        >
                                                            Set as Fallback
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
                                    <div className="p-4 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                                        <h3 className="font-bold">Historical Generation Logs</h3>
                                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Context Persisted for All Events</div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                                    <th className="px-6 py-4">Time</th>
                                                    <th className="px-6 py-4">Model</th>
                                                    <th className="px-6 py-4">Operation</th>
                                                    <th className="px-6 py-4">Tokens (I/O)</th>
                                                    <th className="px-6 py-4">Details</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                                                {ledger.map(entry => (
                                                    <tr key={entry.id} className="hover:bg-slate-800/30 transition-colors">
                                                        <td className="px-6 py-4 text-slate-500">{new Date(entry.createdAt).toLocaleString()}</td>
                                                        <td className="px-6 py-4">
                                                            <span className="text-slate-300 font-bold">{entry.model}</span>
                                                        </td>
                                                        <td className="px-6 py-4 text-indigo-400">{entry.operationType}</td>
                                                        <td className="px-6 py-4 text-slate-500">{entry.inputTokens} / {entry.outputTokens}</td>
                                                        <td className="px-6 py-4">
                                                            <button 
                                                                onClick={() => setSelectedGeneration(entry)}
                                                                className="flex items-center gap-2 bg-indigo-600/10 hover:bg-indigo-600 text-indigo-400 hover:text-white px-3 py-1.5 rounded-lg border border-indigo-500/20 transition-all font-bold text-[10px] uppercase"
                                                            >
                                                                <Search size={12}/> Inspect
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
                                </div>
                            )}
                        </div>
                    )}

                    {view === 'webhooks' && (
                        <div className="max-w-4xl space-y-8">
                            <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl">
                                <h3 className="text-lg font-bold mb-4">Event Webhook Configuration</h3>
                                <div className="flex gap-3">
                                    <div className="relative flex-1">
                                        <Radio size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                                        <input 
                                            type="text" 
                                            value={webhookUrl}
                                            onChange={e => setWebhookUrl(e.target.value)}
                                            className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-12 pr-4 py-3 text-sm font-mono focus:border-indigo-500 outline-none"
                                            placeholder="https://hook.make.com/..."
                                        />
                                    </div>
                                    <button 
                                        onClick={handleSaveWebhook}
                                        disabled={isSavingWebhook}
                                        className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                                    >
                                        {isSavingWebhook ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                        Save
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-3 flex items-center gap-1.5 uppercase font-bold tracking-widest"><AlertTriangle size={12} className="text-amber-500" /> Events are fired for project creation, builds, and payments.</p>
                            </div>

                            <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                <div className="p-4 bg-slate-900 border-b border-slate-800">
                                    <h3 className="font-bold">Delivery Logs</h3>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead>
                                            <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                                <th className="px-6 py-4">Timestamp</th>
                                                <th className="px-6 py-4">Event Type</th>
                                                <th className="px-6 py-4">HTTP Status</th>
                                                <th className="px-6 py-4">Response</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                                            {webhookLogs.map(log => (
                                                <tr key={log.id} className="hover:bg-slate-800/30">
                                                    <td className="px-6 py-4 text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
                                                    <td className="px-6 py-4 text-indigo-400 font-bold">{log.event_type}</td>
                                                    <td className="px-6 py-4">
                                                        <span className={`px-2 py-0.5 rounded ${log.status_code === 200 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                                            {log.status_code}
                                                        </span>
                                                    </td>
                                                    <td className="px-6 py-4 text-slate-400 truncate max-w-[200px]">{log.response_body}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
                            </div>
                        </div>
                    )}

                    {view === 'errors' && (
                        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                            <div className="p-4 bg-slate-900 border-b border-slate-800">
                                <h3 className="font-bold">Platform Error Audit</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                            <th className="px-6 py-4">Level</th>
                                            <th className="px-6 py-4">Source</th>
                                            <th className="px-6 py-4">Message</th>
                                            <th className="px-6 py-4">Timestamp</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800 font-mono text-[11px]">
                                        {logs.map(log => (
                                            <tr key={log.id} className="hover:bg-slate-800/30">
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-0.5 rounded font-bold uppercase ${log.level === 'critical' || log.level === 'error' ? 'bg-red-500 text-white' : 'bg-amber-500/20 text-amber-500'}`}>
                                                        {log.level}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-slate-300">{log.source}</td>
                                                <td className="px-6 py-4 text-slate-400 max-w-lg">{log.message}</td>
                                                <td className="px-6 py-4 text-slate-500">{new Date(log.timestamp).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
                        </div>
                    )}

                    {view === 'users' && (
                        <div className="space-y-6">
                            <div className="flex flex-col md:flex-row gap-6">
                                <div className="flex-1 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                                    <div className="p-4 border-b border-slate-800 bg-slate-900">
                                        <h3 className="font-bold">Managed Accounts</h3>
                                    </div>
                                    <div className="flex-1 overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                                    <th className="px-6 py-4">User</th>
                                                    <th className="px-6 py-4 text-center">Projects</th>
                                                    <th className="px-6 py-4">Credits</th>
                                                    <th className="px-6 py-4">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-800">
                                                {allUsers.map((u, i) => (
                                                    <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <div className="font-medium text-white">{u.email}</div>
                                                            <div className="text-[10px] text-slate-500 font-mono">{u.id}</div>
                                                        </td>
                                                        <td className="px-6 py-4 text-slate-300 text-center">{u.project_count || 0}</td>
                                                        <td className="px-6 py-4">
                                                            <span className={`font-mono font-bold ${Number(u.credits_balance) < 2 ? 'text-red-400' : 'text-emerald-400'}`}>
                                                                {Number(u.credits_balance || 0).toFixed(2)}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <button 
                                                                onClick={() => setTargetUser(u)}
                                                                className="text-indigo-400 hover:text-indigo-300 text-xs font-bold hover:underline"
                                                            >
                                                                Adjust Balance
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} />
                                </div>

                                {targetUser && (
                                    <div className="w-full md:w-80 bg-indigo-950/20 border border-indigo-500/20 p-6 rounded-2xl h-fit sticky top-0 animate-in slide-in-from-right-4 duration-300">
                                        <div className="flex justify-between items-start mb-6">
                                            <h3 className="font-bold text-indigo-300">Modify Balance</h3>
                                            <button onClick={() => setTargetUser(null)}><X size={18} className="text-slate-500" /></button>
                                        </div>
                                        <div className="mb-4">
                                            <div className="text-xs text-slate-500 mb-1">Target Account</div>
                                            <div className="text-sm font-medium truncate text-white">{targetUser.email}</div>
                                        </div>
                                        <form onSubmit={handleAdjustCredits} className="space-y-4">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Delta Amount (+/-)</label>
                                                <input 
                                                    type="number" 
                                                    step="0.01" 
                                                    value={adjustmentAmount} 
                                                    onChange={e => setAdjustmentAmount(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-white"
                                                    placeholder="5.00"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">System Note</label>
                                                <textarea 
                                                    value={adjustmentNote} 
                                                    onChange={e => setAdjustmentNote(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs h-20 resize-none text-white"
                                                    placeholder="Reason for adjustment..."
                                                />
                                            </div>
                                            <button 
                                                type="submit" 
                                                disabled={isAdjusting}
                                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2"
                                            >
                                                {isAdjusting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                                Confirm Update
                                            </button>
                                        </form>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {view === 'settings' && (
                        <div className="max-w-4xl space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h2 className="text-2xl font-bold">System Orchestration Prompts</h2>
                                    <p className="text-slate-400 text-sm">Fine-tune the behavior of the Classifier, Designer, and Builder.</p>
                                </div>
                                <button 
                                    onClick={async () => {
                                        setIsSavingPrompts(true);
                                        try {
                                            for (const [key, value] of Object.entries(prompts)) {
                                                await cloudService.setSystemSetting(key, String(value));
                                            }
                                            alert("Global prompts updated.");
                                        } catch (err: unknown) {
                                            alert(getErrorMessage(err)); 
                                        }
                                        finally { setIsSavingPrompts(false); }
                                    }}
                                    disabled={isSavingPrompts}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isSavingPrompts ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                    Save All
                                </button>
                            </div>
                            <div className="space-y-8">
                                {Object.entries(prompts).map(([key, value]) => (
                                    <div key={key} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                                        <div className="px-6 py-3 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                                            <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{key.replace('sys_prompt_', '').replace('_v12', '')}</h4>
                                            <span className="text-[10px] text-slate-500 font-mono">{key}</span>
                                        </div>
                                        <textarea
                                            value={String(value)}
                                            onChange={e => setPrompts({ ...prompts, [key]: e.target.value })}
                                            className="w-full h-48 bg-transparent p-6 font-mono text-xs leading-relaxed text-slate-300 focus:outline-none resize-y"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </main>
            </div>

            {showSqlWizard && <SqlSetupModal isOpen={true} errorType={null} onRetry={loadViewData} onClose={() => setShowSqlWizard(false)} />}
        </div>
    );
};

export default AdminPanel;