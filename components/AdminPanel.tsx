
import React, { useState, useEffect } from 'react';
import { User, Project, SystemLog, AdminMetric, FinancialStats, CreditLedgerEntry, WebhookLog, AIProviderConfig, AIProviderId } from '../types';
import { cloudService, supabase } from '../services/cloudService';
import { billingService } from '../services/billingService';
import { webhookService, EventType } from '../services/webhookService';
import { PROMPT_KEYS, DEFAULTS } from '../services/geminiService';
import { aiProviderService } from '../services/aiProviderService';
import SqlSetupModal from './SqlSetupModal';
import { 
    Activity, Users, Box, Brain, AlertTriangle, Terminal, 
    Shield, Settings, RefreshCw, X, Database, Loader2, 
    DollarSign, TrendingUp, CreditCard, Check, Search, 
    Clock, Calendar, FileText, ChevronRight, Save, Menu, Zap, Scale, BarChart3, Radio, Send, ToggleLeft, ToggleRight, Lock, Key, Filter,
    FileJson, MessageSquare, Eye, EyeOff, Copy, ChevronLeft, ChevronRight as ArrowRightIcon, Trash2
} from 'lucide-react';

interface AdminPanelProps {
    user: User;
    onClose: () => void;
}

type AdminView = 'dashboard' | 'financials' | 'users' | 'projects' | 'ai' | 'webhooks' | 'errors' | 'settings' | 'database';

// Helper to safely extract error message from unknown catch variable
const getErrorMessage = (e: any): string => {
    if (typeof e === 'string') return e;
    if (e instanceof Error) return e.message;
    if (e && typeof e === 'object') {
        const err = e as any;
        if (err.message) return String(err.message);
        if (err.error_description) return String(err.error_description);
        if (err.code) return `Code: ${err.code} - ${err.message || 'Unknown'}`;
        try {
            return JSON.stringify(e);
        } catch {
            return "Unknown object error";
        }
    }
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

const AdminPanel: React.FC<AdminPanelProps> = ({ user, onClose }) => {
    const [view, setView] = useState<AdminView>('dashboard');
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
    const [editingProviderId, setEditingProviderId] = useState<AIProviderId | null>(null);
    const [tempApiKey, setTempApiKey] = useState('');
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
    const [userSearch, setUserSearch] = useState('');
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');
    const [targetUser, setTargetUser] = useState<any | null>(null);
    const [isAdjusting, setIsAdjusting] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
    const [showSqlWizard, setShowSqlWizard] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        setCurrentPage(1);
        setDataError(null);
    }, [view]);

    useEffect(() => {
        loadViewData();
    }, [view, currentPage]);

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
                const configs = await aiProviderService.getAllConfigs();
                setAiConfigs(configs);
            } else if (view === 'settings') {
                const promptKeys = Object.values(PROMPT_KEYS) as string[];
                const dbSettings = await cloudService.getSystemSettings(promptKeys);
                const dbPrompts: Record<string, string> = {};
                if (dbSettings) dbSettings.forEach((s: any) => dbPrompts[s.key] = String(s.value));
                const loadedPrompts: Record<string, string> = {};
                Object.entries(PROMPT_KEYS).forEach(([key, value]) => {
                    const storageKey = value as string;
                    const defaultVal = (DEFAULTS as Record<string, string>)[key] || '';
                    loadedPrompts[key] = dbPrompts[storageKey] || defaultVal;
                });
                setPrompts(loadedPrompts);
            }
        // @fix: Changed catch(err: unknown) to catch(err: any) to fix "unknown not assignable to string" error on line 202.
        } catch (err: any) {
            console.error("View load failed", getErrorMessage(err));
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
                { label: 'System Health', value: 'Optimal', status: 'good' },
                { label: 'Active Issues', value: errorCount || 0, status: errorCount && errorCount > 0 ? 'warning' : 'good' }
            ]);
        // @fix: Explicitly type catch variable as any to avoid unknown issues during logging.
        } catch (e: any) {
            console.error(getErrorMessage(e));
        }
    };

    const handleSavePrompts = async () => {
        setIsSavingPrompts(true);
        try {
            for (const [key, value] of Object.entries(prompts)) {
                const storageKey = (PROMPT_KEYS as any)[key];
                if (storageKey) {
                    await cloudService.setSystemSetting(storageKey, value);
                }
            }
            alert("Prompts saved successfully!");
        // @fix: Changed catch(err: unknown) to any for simpler string concatenation in alert.
        } catch (err: any) {
            alert("Save failed: " + getErrorMessage(err));
        } finally {
            setIsSavingPrompts(false);
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
        // @fix: Using any in catch to safely concatenate error message.
        } catch (err: any) {
            alert("Adjustment failed: " + getErrorMessage(err));
        } finally {
            setIsAdjusting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-950 text-white flex flex-col z-[60] font-sans">
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
                {/* Sidebar */}
                <nav className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col overflow-y-auto p-4 gap-2 shrink-0">
                    {[
                        { id: 'dashboard', label: 'Dashboard', icon: <Activity size={18} /> },
                        { id: 'financials', label: 'Financials & Credits', icon: <DollarSign size={18} /> },
                        { id: 'users', label: 'User Management', icon: <Users size={18} /> },
                        { id: 'projects', label: 'All Projects', icon: <Box size={18} /> },
                        { id: 'ai', label: 'AI Providers', icon: <Brain size={18} /> },
                        { id: 'settings', label: 'System Prompts', icon: <Settings size={18} /> },
                        { id: 'webhooks', label: 'Webhooks', icon: <Radio size={18} /> },
                        { id: 'errors', label: 'Error Logs', icon: <AlertTriangle size={18} /> }
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

                {/* Content */}
                <main className="flex-1 overflow-y-auto p-8 relative bg-slate-950">
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
                        <div className="space-y-8 animate-in fade-in duration-300">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                                {stats.map((s, i) => (
                                    <div key={i} className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl">
                                        <div className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">{s.label}</div>
                                        <div className="text-2xl font-bold">{s.value}</div>
                                    </div>
                                ))}
                            </div>
                            <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-2xl h-64 flex items-center justify-center text-slate-500 italic">
                                Dashboard Charts Placeholder
                            </div>
                        </div>
                    )}

                    {view === 'users' && (
                        <div className="space-y-6">
                            <div className="flex flex-col md:flex-row gap-6">
                                <div className="flex-1 bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                                    <div className="p-4 border-b border-slate-800 flex justify-between items-center bg-slate-900">
                                        <h3 className="font-bold">User List</h3>
                                    </div>
                                    <div className="flex-1 overflow-x-auto">
                                        <table className="w-full text-left text-sm">
                                            <thead>
                                                <tr className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                                                    <th className="px-6 py-4">User</th>
                                                    <th className="px-6 py-4">Projects</th>
                                                    <th className="px-6 py-4">Balance</th>
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
                                                        <td className="px-6 py-4 text-slate-300">{u.project_count || 0}</td>
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
                                                                Adjust Credit
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
                                            <h3 className="font-bold text-indigo-300">Adjust Balance</h3>
                                            <button onClick={() => setTargetUser(null)}><X size={18} className="text-slate-500" /></button>
                                        </div>
                                        <div className="mb-4">
                                            <div className="text-xs text-slate-500 mb-1">Target User</div>
                                            <div className="text-sm font-medium truncate">{targetUser.email}</div>
                                        </div>
                                        <form onSubmit={handleAdjustCredits} className="space-y-4">
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Amount (+/-)</label>
                                                <input 
                                                    type="number" 
                                                    step="0.01" 
                                                    value={adjustmentAmount} 
                                                    onChange={e => setAdjustmentAmount(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm"
                                                    placeholder="5.00"
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Note</label>
                                                <textarea 
                                                    value={adjustmentNote} 
                                                    onChange={e => setAdjustmentNote(e.target.value)}
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs h-20 resize-none"
                                                    placeholder="Reason for adjustment..."
                                                />
                                            </div>
                                            <button 
                                                type="submit" 
                                                disabled={isAdjusting}
                                                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2.5 rounded-lg text-sm transition-all flex items-center justify-center gap-2"
                                            >
                                                {isAdjusting ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                                Save Adjustment
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
                                    <h2 className="text-2xl font-bold">System Prompts</h2>
                                    <p className="text-slate-400 text-sm">Tune the AI agent's brain for various pipeline stages.</p>
                                </div>
                                <button 
                                    onClick={handleSavePrompts}
                                    disabled={isSavingPrompts}
                                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {isSavingPrompts ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                                    Save All Prompts
                                </button>
                            </div>
                            <div className="space-y-8">
                                {Object.entries(prompts).map(([key, value]) => (
                                    <div key={key} className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
                                        <div className="px-6 py-3 bg-slate-900 border-b border-slate-800 flex justify-between items-center">
                                            <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest">{key}</h4>
                                            <span className="text-[10px] text-slate-500 font-mono">{(PROMPT_KEYS as any)[key]}</span>
                                        </div>
                                        <textarea
                                            value={value}
                                            onChange={e => setPrompts({ ...prompts, [key]: e.target.value })}
                                            className="w-full h-48 bg-transparent p-6 font-mono text-xs leading-relaxed text-slate-300 focus:outline-none resize-y"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Placeholder content for other views to ensure robustness */}
                    {['financials', 'projects', 'ai', 'webhooks', 'errors'].includes(view) && (
                        <div className="bg-slate-900/50 border border-slate-800 p-12 rounded-3xl flex flex-col items-center justify-center text-center gap-4">
                            <Terminal className="text-slate-700" size={64} />
                            <div>
                                <h3 className="text-xl font-bold mb-1">View Implementation Required</h3>
                                <p className="text-slate-500 text-sm max-w-md mx-auto">This administrative module is currently being scaffolded. Data is safe but the UI for this section is pending.</p>
                            </div>
                            <button onClick={() => setView('dashboard')} className="mt-4 text-indigo-400 hover:underline flex items-center gap-2 text-sm font-medium">
                                <ArrowRightIcon size={16} className="rotate-180" /> Return to Dashboard
                            </button>
                        </div>
                    )}
                </main>
            </div>

            {showSqlWizard && <SqlSetupModal isOpen={true} errorType={null} onRetry={loadViewData} onClose={() => setShowSqlWizard(false)} />}
        </div>
    );
};

export default AdminPanel;
