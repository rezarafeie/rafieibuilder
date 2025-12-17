
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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

const getErrorMessage = (e: unknown): string => {
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
    const [aiFilter, setAiFilter] = useState<string>('all');
    
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
    const [selectedUsageLog, setSelectedUsageLog] = useState<CreditLedgerEntry | null>(null);
    const [newMargin, setNewMargin] = useState('');
    
    const [userSearch, setUserSearch] = useState('');
    const [adjustmentAmount, setAdjustmentAmount] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');
    const [targetUser, setTargetUser] = useState<any | null>(null);
    const [isAdjusting, setIsAdjusting] = useState(false);
    
    const [webhookUrl, setWebhookUrl] = useState('');
    const [isSavingUrl, setIsSavingUrl] = useState(false);
    const [webhookLogs, setWebhookLogs] = useState<WebhookLog[]>([]);
    const [testEventType, setTestEventType] = useState<EventType>('admin.test_event');
    
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [selectedUserFinancials, setSelectedUserFinancials] = useState<any | null>(null);
    const [selectedUserTransactions, setSelectedUserTransactions] = useState<any[]>([]);
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
            }
            else if (view === 'projects') {
                const { data, count } = await cloudService.getAdminProjects(currentPage, ITEMS_PER_PAGE);
                setProjects(data);
                setTotalItems(count);
            }
            else if (view === 'users') {
                const { data, count } = await cloudService.getAdminUsers(currentPage, ITEMS_PER_PAGE);
                setAllUsers(data);
                setTotalItems(count);
            }
            else if (view === 'errors') {
                const { data, count } = await cloudService.getSystemLogs(currentPage, ITEMS_PER_PAGE);
                setLogs(data);
                setTotalItems(count);
            }
            else if (view === 'financials') {
                const fStats = await cloudService.getFinancialStats();
                if (fStats) {
                    setFinancialStats(fStats);
                    setNewMargin(fStats.currentMargin.toString());
                }
                const { data, count } = await cloudService.getLedger(currentPage, ITEMS_PER_PAGE);
                setLedger(data);
                setTotalItems(count);
            }
            else if (view === 'webhooks') {
                const url = await cloudService.getSystemSetting('webhook_url');
                if (url) setWebhookUrl(url);
                
                const { data, count } = await cloudService.getWebhookLogs(currentPage, ITEMS_PER_PAGE);
                setWebhookLogs(data);
                setTotalItems(count);
            }
            else if (view === 'ai') {
                const configs = await aiProviderService.getAllConfigs();
                setAiConfigs(configs);
                const { data, count } = await cloudService.getLedger(currentPage, ITEMS_PER_PAGE);
                setLedger(data);
                setTotalItems(count);
            }
            else if (view === 'settings') {
                const promptKeys = Object.values(PROMPT_KEYS) as string[];
                const dbSettings = await cloudService.getSystemSettings(promptKeys);
                const dbPrompts: Record<string, string> = {};
                if (dbSettings) dbSettings.forEach((s: any) => dbPrompts[s.key] = s.value);
                const loadedPrompts: Record<string, string> = {};
                Object.entries(PROMPT_KEYS).forEach(([key, value]) => {
                    const storageKey = value as string;
                    const defaultVal = (DEFAULTS as Record<string, string>)[key] || '';
                    loadedPrompts[key] = dbPrompts[storageKey] || defaultVal;
                });
                setPrompts(loadedPrompts);
            }
        } catch (e: unknown) { 
            console.error("View load failed", e);
            const errorMessage = getErrorMessage(e);
            setDataError(errorMessage);
            if (errorMessage.includes("Access Denied")) setShowSqlWizard(true);
        } finally {
            setIsLoading(false);
        }
    };

    const loadDashboardStats = async () => {
        try {
            const { count: userCount } = await supabase.from('user_settings').select('user_id', { count: 'exact', head: true });
            const { count: projectCount } = await supabase.from('projects').select('id', { count: 'exact', head: true });
            const fStats = await cloudService.getFinancialStats();
            if (fStats) setFinancialStats(fStats);
            setStats([
                { label: 'Total Users', value: userCount || 0, status: 'good' },
                { label: 'Total Projects', value: projectCount || 0, status: 'good' },
                { label: 'Revenue (USD Est)', value: `$${fStats?.totalRevenueCredits ? (fStats.totalRevenueCredits/10).toFixed(2) : '0.00'}`, status: 'good' },
            ]);
        } catch(e) {}
    };

    const handleToggleActiveAI = async (config: AIProviderConfig) => {
        try {
            await aiProviderService.saveConfig({ id: config.id, isActive: !config.isActive });
            const configs = await aiProviderService.getAllConfigs();
            setAiConfigs(configs);
        } catch(e: unknown) { alert(getErrorMessage(e)); }
    };

    const handleToggleFallbackAI = async (config: AIProviderConfig) => {
        try {
            await aiProviderService.saveConfig({ id: config.id, isFallback: !config.isFallback });
            const configs = await aiProviderService.getAllConfigs();
            setAiConfigs(configs);
        } catch(e: unknown) { alert(getErrorMessage(e)); }
    };

    const handleUpdateModel = async (id: AIProviderId, model: string) => {
        try {
            await aiProviderService.saveConfig({ id, model });
            const configs = await aiProviderService.getAllConfigs();
            setAiConfigs(configs);
        } catch(e: unknown) { alert(getErrorMessage(e)); }
    };

    const handleSaveApiKey = async (id: AIProviderId) => {
        if (!tempApiKey) return;
        try {
            await aiProviderService.saveConfig({ id, apiKey: tempApiKey });
            setTempApiKey('');
            setEditingProviderId(null);
            const configs = await aiProviderService.getAllConfigs();
            setAiConfigs(configs);
            alert("API Key updated securely.");
        } catch(e: unknown) { alert(getErrorMessage(e)); }
    };

    const handleUpdateMargin = async () => {
        const val = parseFloat(newMargin);
        if (isNaN(val) || val < 0) { alert("Invalid margin"); return; }
        try {
            await billingService.updateProfitMargin(val);
            alert("Margin updated");
            loadViewData();
        } catch (e: unknown) { alert(getErrorMessage(e)); }
    };

    const handleUserSelect = async (u: any) => {
        setSelectedUser(u);
        try {
            const financials = await cloudService.getUserFinancialOverview(u.id);
            const transactions = await cloudService.getUserTransactions(u.id);
            setSelectedUserFinancials(financials);
            setSelectedUserTransactions(transactions);
        } catch(e: unknown) { console.error(getErrorMessage(e)); setSelectedUserFinancials(null); setSelectedUserTransactions([]); }
    };

    const handleSearchUser = async () => {
        if (!userSearch.trim()) return;
        setIsLoading(true);
        try {
            const results = await cloudService.searchUsers(userSearch);
            if (results && results.length > 0) setTargetUser(results[0]);
            else { alert("User not found"); setTargetUser(null); }
        } catch (e: unknown) { alert(`Search failed: ${getErrorMessage(e)}`); }
        finally { setIsLoading(false); }
    };

    const handleAdjustCredit = async (targetId: string, targetEmail: string) => {
        if (!adjustmentAmount || !adjustmentNote) return alert("Please fill all fields");
        const amount = parseFloat(adjustmentAmount);
        if (isNaN(amount) || amount === 0) return alert("Invalid amount");
        if(!window.confirm(`Are you sure you want to ${amount > 0 ? 'ADD' : 'DEDUCT'} ${Math.abs(amount)} credits for ${targetEmail}?`)) return;
        setIsAdjusting(true);
        try {
            await cloudService.adminAdjustCredit(targetId, amount, adjustmentNote);
            alert("Adjustment successful. User balance updated.");
            setAdjustmentAmount('');
            setAdjustmentNote('');
            await loadViewData();
            if (selectedUser && selectedUser.id === targetId) await handleUserSelect(selectedUser);
            if (targetUser && targetUser.id === targetId) {
                const refreshed = await cloudService.searchUsers(targetEmail);
                if (refreshed.length > 0) setTargetUser(refreshed[0]);
            }
        } catch(e: unknown) { console.error("Adjustment Failed:", e); alert(`Failed: ${getErrorMessage(e)}`); }
        finally { setIsAdjusting(false); }
    };

    const handleSaveAllPrompts = async () => {
        setIsSavingPrompts(true);
        try {
            const updates = Object.entries(prompts).map(([key, value]) => {
                const storageKey = PROMPT_KEYS[key as keyof typeof PROMPT_KEYS];
                return cloudService.setSystemSetting(storageKey, value);
            });
            await Promise.all(updates);
            alert("All system prompts saved globally.");
        } catch (e: unknown) { alert(`Failed to save prompts: ${getErrorMessage(e)}`); }
        finally { setIsSavingPrompts(false); }
    };

    const handleResetPrompt = async (key: string) => {
        const storageKey = PROMPT_KEYS[key as keyof typeof PROMPT_KEYS];
        try {
            await supabase.from('system_settings').delete().eq('key', storageKey);
            const defaultVal = (DEFAULTS as Record<string, string>)[key] || '';
            setPrompts(prev => ({ ...prev, [key]: defaultVal }));
            alert("Reset to default.");
        } catch(e: unknown) { alert(`Failed to reset: ${getErrorMessage(e)}`); }
    };

    const handleResetAllPrompts = async () => {
        if (!window.confirm("Are you sure? Reverts to defaults.")) return;
        setIsSavingPrompts(true);
        try {
            const keys = Object.values(PROMPT_KEYS) as string[];
            await supabase.from('system_settings').delete().in('key', keys);
            const defaultPrompts: Record<string, string> = {};
            Object.entries(PROMPT_KEYS).forEach(([key, _]) => {
                const defaultVal = (DEFAULTS as Record<string, string>)[key] || '';
                defaultPrompts[key] = defaultVal;
            });
            setPrompts(defaultPrompts);
            alert("All prompts reset.");
        } catch (e: unknown) { alert(`Failed to reset all: ${getErrorMessage(e)}`); }
        finally { setIsSavingPrompts(false); }
    };

    const handleSaveWebhookUrl = async () => {
        if (!webhookUrl) return alert("URL cannot be empty");
        setIsSavingUrl(true);
        try {
            await cloudService.setSystemSetting('webhook_url', webhookUrl);
            webhookService.clearCache();
            alert("Webhook URL updated.");
        } catch(e: unknown) { alert(getErrorMessage(e)); }
        finally { setIsSavingUrl(false); }
    };

    const handleTestWebhook = async () => {
        await webhookService.send(testEventType, { message: "Test from Admin" }, {}, user);
        alert("Fired.");
        if (view === 'webhooks') setTimeout(loadViewData, 2000); 
    };

    const handleNavClick = (newView: AdminView) => { setView(newView); setIsSidebarOpen(false); };

    const getProviderFromModel = (m: string) => {
        if (!m) return 'unknown';
        const lower = m.toLowerCase();
        if (lower.includes('gpt') || lower.includes('o1') || lower.includes('dall-e')) return 'openai';
        if (lower.includes('claude')) return 'claude';
        return 'google';
    };

    const filteredLedger = ledger.filter(entry => {
        if (aiFilter === 'all') return true;
        return getProviderFromModel(entry.model) === aiFilter;
    });

    const aiStats = filteredLedger.reduce((acc, curr) => {
        acc.count += 1;
        acc.inputTokens += Number(curr.inputTokens || 0);
        acc.outputTokens += Number(curr.outputTokens || 0);
        acc.cost += Number(curr.rawCostUsd || 0);
        acc.credits += Number(curr.creditsDeducted || 0);
        return acc;
    }, { count: 0, inputTokens: 0, outputTokens: 0, cost: 0, credits: 0 });

    const revenueUsd = aiStats.credits / 10;
    const profitUsd = revenueUsd - aiStats.cost;

    const UserDetailsModal = () => {
        if (!selectedUser) return null;
        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in zoom-in-95">
                <div className="bg-[#1e293b] border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                    <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-[#0f172a]">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-pink-500/10 rounded-xl border border-pink-500/20 text-pink-400"><Users size={24} /></div>
                            <div>
                                <h2 className="text-xl font-bold text-white">{selectedUser.email}</h2>
                                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono"><span>ID: {selectedUser.id}</span><span>•</span><span>Joined: {new Date(selectedUser.created_at).toLocaleDateString()}</span></div>
                            </div>
                        </div>
                        <button onClick={() => setSelectedUser(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X size={24} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {selectedUserFinancials && (
                            <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div><div className="text-xs text-slate-500 uppercase font-bold mb-1">Purchased</div><div className="text-lg font-mono text-white">{selectedUserFinancials.totalPurchased.toFixed(2)} CR</div></div>
                                <div><div className="text-xs text-slate-500 uppercase font-bold mb-1">Spent</div><div className="text-lg font-mono text-slate-300">{selectedUserFinancials.totalSpent.toFixed(2)} CR</div></div>
                                <div><div className="text-xs text-slate-500 uppercase font-bold mb-1">Cost</div><div className="text-lg font-mono text-slate-300">${selectedUserFinancials.totalCost.toFixed(4)}</div></div>
                                <div><div className="text-xs text-slate-500 uppercase font-bold mb-1">Profit</div><div className={`text-lg font-mono font-bold ${selectedUserFinancials.profitGenerated >= 0 ? 'text-green-400' : 'text-red-400'}`}>${selectedUserFinancials.profitGenerated.toFixed(4)}</div></div>
                            </div>
                        )}
                        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                            <h3 className="text-sm font-bold text-white mb-3">Manual Adjustment</h3>
                            <div className="flex gap-2">
                                <input type="number" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} placeholder="+/- Amount" className="w-32 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
                                <input type="text" value={adjustmentNote} onChange={e => setAdjustmentNote(e.target.value)} placeholder="Reason" className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm" />
                                <button onClick={() => handleAdjustCredit(selectedUser.id, selectedUser.email)} disabled={isAdjusting} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2 disabled:opacity-50">{isAdjusting && <Loader2 size={12} className="animate-spin" />} Adjust</button>
                            </div>
                        </div>
                        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
                            <div className="p-4 border-b border-slate-700 font-semibold text-white text-sm">Recent Transactions</div>
                            <div className="overflow-x-auto max-h-64">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-900 text-slate-400 sticky top-0"><tr><th className="p-3">Date</th><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Description</th></tr></thead>
                                    <tbody className="divide-y divide-slate-700">
                                        {selectedUserTransactions.length === 0 ? (<tr><td colSpan={4} className="p-4 text-center text-slate-500">None.</td></tr>) : (
                                            selectedUserTransactions.map((tx: any) => (
                                                <tr key={tx.id} className="hover:bg-slate-700/30">
                                                    <td className="p-3 text-slate-400">{new Date(tx.createdAt).toLocaleString()}</td>
                                                    <td className="p-3"><span className={`px-2 py-0.5 rounded ${tx.type === 'purchase' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>{tx.type}</span></td>
                                                    <td className="p-3 font-mono font-bold text-white">{tx.amount > 0 ? '+' : ''}{tx.amount}</td>
                                                    <td className="p-3 text-slate-400 truncate max-w-[200px]">{tx.description || '-'}</td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const UsageDetailsModal = () => {
        if (!selectedUsageLog) return null;
        const meta = selectedUsageLog.meta || {};
        const userObj = allUsers.find(u => u.id === selectedUsageLog.userId);
        return (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in zoom-in-95">
                <div className="bg-[#1e293b] border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
                    <div className="p-6 border-b border-slate-700 flex justify-between items-start bg-[#0f172a]">
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400"><Terminal size={24} /></div>
                            <div>
                                <h2 className="text-xl font-bold text-white">Usage Detail</h2>
                                <div className="flex items-center gap-2 text-xs text-slate-400 mt-1 font-mono"><span>ID: {selectedUsageLog.id}</span><span>•</span><span>{new Date(selectedUsageLog.createdAt).toLocaleString()}</span></div>
                            </div>
                        </div>
                        <button onClick={() => setSelectedUsageLog(null)} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><X size={24} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                                <div className="text-xs text-slate-500 uppercase font-bold mb-1 flex items-center gap-1"><Users size={12}/> User</div>
                                <div className="text-sm text-white truncate">{userObj?.email || selectedUsageLog.userId}</div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2"><Settings size={14} /> Trace</h3>
                            <div className="bg-slate-800 border border-slate-700 rounded-lg p-0 overflow-hidden">
                                <div className="flex justify-between items-center px-3 py-2 bg-slate-900 border-b border-slate-700"><div className="text-xs font-bold text-slate-500 flex items-center gap-1"><FileJson size={12}/> Log</div></div>
                                <div className="p-3 max-h-60 overflow-y-auto custom-scrollbar"><pre className="text-xs font-mono text-green-400/80 whitespace-pre-wrap">{typeof (meta.response || meta.log) === 'object' ? JSON.stringify(meta.response || meta.log, null, 2) : (meta.response || meta.log || 'None')}</pre></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen bg-[#0f172a] text-slate-300 font-sans overflow-hidden">
            <UserDetailsModal />
            <UsageDetailsModal />
            {showSqlWizard && <SqlSetupModal isOpen={true} errorType={dataError || "MANUAL_TRIGGER"} onRetry={loadViewData} onClose={() => setShowSqlWizard(false)} />}
            {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-40 md:hidden backdrop-blur-sm animate-in fade-in" onClick={() => setIsSidebarOpen(false)} />}
            <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#1e293b] border-r border-slate-700 flex flex-col shrink-0 transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="p-4 border-b border-slate-700 font-bold text-white flex items-center justify-between"><div className="flex items-center gap-2"><Shield className="text-indigo-500" /> Admin</div><button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800"><X size={20} /></button></div>
                <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
                    {[
                        { id: 'dashboard', label: 'Dashboard', icon: Activity },
                        { id: 'ai', label: 'AI Provider', icon: Brain },
                        { id: 'financials', label: 'Financials', icon: DollarSign },
                        { id: 'users', label: 'Users', icon: Users },
                        { id: 'projects', label: 'Projects', icon: Box },
                        { id: 'webhooks', label: 'Webhooks', icon: Radio },
                        { id: 'errors', label: 'Error Center', icon: AlertTriangle },
                        { id: 'settings', label: 'System Settings', icon: Settings },
                        { id: 'database', label: 'System Database', icon: Database },
                    ].map(item => (<button key={item.id} onClick={() => handleNavClick(item.id as AdminView)} className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${view === item.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}><item.icon size={18} /> {item.label}</button>))}
                </nav>
                <div className="p-4 border-t border-slate-700"><button onClick={onClose} className="w-full text-center text-sm text-slate-500 hover:text-white transition-colors">Exit Admin</button></div>
            </div>
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <header className="h-16 border-b border-slate-700 flex items-center justify-between px-4 md:px-6 bg-[#0f172a]"><div className="flex items-center gap-3"><button onClick={() => setIsSidebarOpen(true)} className="md:hidden p-2 -ml-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"><Menu size={24} /></button><h2 className="text-xl font-semibold text-white capitalize">{view}</h2></div><button onClick={() => loadViewData()} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white" title="Refresh"><RefreshCw size={16} /></button></header>
                <main className="flex-1 overflow-y-auto p-4 md:p-6 relative">
                    {dataError && <div className="mb-6 bg-red-900/20 border border-red-500/30 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"><div className="flex items-center gap-3"><AlertTriangle className="text-red-400 shrink-0" /><div><h4 className="text-red-200 font-bold">Data Error</h4><p className="text-red-300 text-sm">{dataError}</p></div></div><button onClick={() => setShowSqlWizard(true)} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-medium whitespace-nowrap">Run Fix</button></div>}
                    {isLoading && <div className="absolute inset-0 z-10 bg-[#0f172a]/50 backdrop-blur-sm flex items-center justify-center"><Loader2 className="animate-spin text-indigo-500" size={32} /></div>}
                    {view === 'dashboard' && (<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">{stats.map((stat, i) => (<div key={i} className="bg-slate-800 p-6 rounded-xl border border-slate-700"><div className="text-slate-400 text-sm font-medium mb-2">{stat.label}</div><div className={`text-3xl font-bold ${stat.status === 'good' ? 'text-white' : stat.status === 'warning' ? 'text-yellow-400' : 'text-red-400'}`}>{stat.value}</div></div>))}<div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><div className="text-slate-400 text-sm font-medium mb-2">Total AI Cost</div><div className="text-3xl font-bold text-white">${financialStats.totalCostUsd.toFixed(4)}</div></div></div>)}
                    {view === 'settings' && (<div className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-6 relative pb-20"><div className="flex justify-between items-center mb-4"><div className="flex items-center gap-3"><h3 className="text-lg font-bold text-white">Prompts</h3><button onClick={handleResetAllPrompts} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 bg-red-900/20 border border-red-900/50 px-3 py-1.5 rounded-full transition-colors"><Trash2 size={12} /> Reset Defaults</button></div><button onClick={handleSaveAllPrompts} disabled={isSavingPrompts} className="fixed bottom-8 right-8 z-50 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-6 rounded-full shadow-2xl flex items-center gap-2 transition-all hover:scale-105 disabled:opacity-50">{isSavingPrompts ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />} Save All</button></div><div className="grid gap-8">{Object.entries(PROMPT_KEYS).map(([key, storageKey]) => (<div key={key} className="space-y-2 bg-slate-900/50 p-4 rounded-xl border border-slate-700/50"><div className="flex justify-between items-center"><label className="text-sm font-bold text-indigo-400 font-mono uppercase tracking-wider">{key}</label><button onClick={() => handleResetPrompt(key)} className="text-xs text-slate-500 hover:text-white transition-colors">Reset</button></div><textarea className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-300 h-48 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all resize-y" value={prompts[key] || ''} onChange={(e) => setPrompts(prev => ({...prev, [key]: e.target.value}))} spellCheck={false} /></div>))}</div></div>)}
                    {view === 'users' && (<div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col"><div className="overflow-x-auto"><table className="w-full text-left text-sm min-w-[800px]"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-4">User</th><th className="p-4">Credits</th><th className="p-4">Projects</th><th className="p-4">Created</th><th className="p-4">Last Seen</th><th className="p-4"></th></tr></thead><tbody className="divide-y divide-slate-700">{allUsers.map(u => (<tr key={u.id} className="hover:bg-slate-700/50 cursor-pointer" onClick={() => handleUserSelect(u)}><td className="p-4"><div className="font-bold text-white">{u.email}</div><div className="text-xs text-slate-500 font-mono">{u.id}</div></td><td className="p-4 font-mono text-emerald-400">{Number(u.credits_balance || 0).toFixed(2)}</td><td className="p-4">{u.project_count}</td><td className="p-4 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td><td className="p-4 text-slate-400">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}</td><td className="p-4"><ChevronRight size={16} className="text-slate-500"/></td></tr>))}</tbody></table></div><PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} /></div>)}
                    {view === 'projects' && (<div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-4">Name</th><th className="p-4">Owner</th><th className="p-4">Status</th><th className="p-4">Created</th><th className="p-4">Updated</th></tr></thead><tbody className="divide-y divide-slate-700">{projects.map(p => (<tr key={p.id} className="hover:bg-slate-700/50"><td className="p-4 font-medium text-white"><Link to={`/project/${p.id}`} className="text-indigo-400 hover:text-indigo-300 hover:underline">{p.name}</Link></td><td className="p-4 text-slate-400 font-mono text-xs">{p.userId}</td><td className="p-4"><span className={`px-2 py-1 rounded text-xs ${p.status === 'generating' ? 'bg-indigo-900 text-indigo-200' : 'bg-slate-700 text-slate-300'}`}>{p.status}</span></td><td className="p-4 text-slate-400">{new Date(p.createdAt).toLocaleDateString()}</td><td className="p-4 text-slate-400">{new Date(p.updatedAt).toLocaleDateString()}</td></tr>))}</tbody></table></div><PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} /></div>)}
                    {view === 'errors' && (<div className="space-y-4">{logs.length === 0 ? (<div className="text-center p-8 text-slate-500 bg-slate-800 rounded-xl border border-slate-700">No logs.</div>) : (logs.map(log => (<div key={log.id} className="bg-red-900/10 border border-red-900/30 p-4 rounded-xl"><div className="flex justify-between items-start mb-2"><div className="flex items-center gap-2"><AlertTriangle size={16} className="text-red-500" /><span className="font-bold text-red-400 uppercase text-xs">{log.level}</span><span className="text-slate-500 text-xs">{new Date(log.timestamp).toLocaleString()}</span></div><span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded">{log.source}</span></div><p className="text-white text-sm font-mono">{log.message}</p></div>)))}<PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} /></div>)}
                    {view === 'webhooks' && (<div className="space-y-6 max-w-5xl mx-auto"><div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Radio size={18} className="text-indigo-400"/> Config</h3><div className="flex gap-2"><div className="flex-1"><label className="text-xs text-slate-400 mb-1 block">Webhook URL</label><input type="text" value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://..." className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500" /></div><div className="flex items-end"><button onClick={handleSaveWebhookUrl} disabled={isSavingUrl} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium h-[42px] w-[100px] flex items-center justify-center">{isSavingUrl ? <Loader2 className="animate-spin" /> : 'Save'}</button></div></div></div><div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Send size={18} className="text-emerald-400"/> Test</h3><div className="flex items-center gap-4"><select value={testEventType} onChange={(e) => setTestEventType(e.target.value as EventType)} className="bg-slate-900 border border-slate-600 text-white text-sm rounded-lg block px-3 py-2 outline-none"><option value="admin.test_event">admin.test_event</option><option value="user.logged_in">user.logged_in</option><option value="project.created">project.created</option></select><button onClick={handleTestWebhook} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2"><Send size={16} /> Fire</button></div></div><div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col"><div className="p-4 border-b border-slate-700 flex justify-between items-center"><span className="font-semibold text-white">Delivery Logs</span><button onClick={loadViewData} className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><RefreshCw size={12}/> Refresh</button></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-3">Time</th><th className="p-3">Status</th><th className="p-3">Event</th><th className="p-3">Payload</th></tr></thead><tbody className="divide-y divide-slate-700"> {webhookLogs.length === 0 ? (<tr><td colSpan={4} className="p-8 text-center text-slate-500">None.</td></tr>) : (webhookLogs.map((log) => (<tr key={log.id} className="hover:bg-slate-700/30"><td className="p-3 text-slate-400 whitespace-nowrap text-xs">{new Date(log.created_at).toLocaleString()}</td><td className="p-3"><span className={`px-2 py-1 rounded text-xs font-bold ${log.status_code >= 200 && log.status_code < 300 ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>{log.status_code || 'ERR'}</span></td><td className="p-3 font-mono text-white text-xs">{log.event_type}</td><td className="p-3 text-slate-400 text-xs font-mono max-w-[300px] truncate" title={JSON.stringify(log.payload)}>{JSON.stringify(log.payload)}</td></tr>)))}</tbody></table></div><PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} /></div></div>)}
                    {view === 'ai' && (<div className="space-y-6">{aiConfigs.length === 0 && (<div className="p-6 bg-yellow-500/10 border border-yellow-500/20 rounded-xl flex items-center gap-4"><AlertTriangle className="text-yellow-500" size={24} /><div><h3 className="text-yellow-200 font-bold">No Providers</h3><p className="text-yellow-100/70 text-sm">Run wizard.</p></div><button onClick={() => setShowSqlWizard(true)} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg text-sm font-bold">Setup</button></div>)}<div className="grid grid-cols-1 md:grid-cols-3 gap-6">{aiConfigs.map(config => (<div key={config.id} className={`p-6 rounded-xl border-2 transition-all ${config.isActive ? 'bg-indigo-900/10 border-indigo-500' : 'bg-slate-800 border-slate-700'}`}><div className="flex justify-between items-start mb-4"><div className="flex items-center gap-3"><div className={`p-2 rounded-lg ${config.id === 'google' ? 'bg-blue-500/20 text-blue-400' : config.id === 'openai' ? 'bg-green-500/20 text-green-400' : 'bg-orange-500/20 text-orange-400'}`}><Brain size={24} /></div><div><h3 className="font-bold text-white text-lg">{config.name}</h3><span className={`text-xs px-2 py-0.5 rounded-full ${config.apiKey ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>{config.apiKey ? 'Connected' : 'Missing'}</span></div></div>{config.isActive && <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded font-bold">ACTIVE</span>}</div><div className="space-y-4"><div><label className="text-xs text-slate-400 mb-1 block">Model</label><select value={config.model} onChange={(e) => handleUpdateModel(config.id, e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none">{aiProviderService.getAvailableModels(config.id).map(m => (<option key={m} value={m}>{m}</option>))}</select></div><div><label className="text-xs text-slate-400 mb-1 block">API Key</label>{editingProviderId === config.id ? (<div className="flex gap-2"><input type="password" value={tempApiKey} onChange={(e) => setTempApiKey(e.target.value)} placeholder="sk-..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white" /><button onClick={() => handleSaveApiKey(config.id)} className="bg-green-600 hover:bg-green-500 p-1 rounded text-white"><Check size={16}/></button><button onClick={() => setEditingProviderId(null)} className="bg-slate-600 hover:bg-slate-50 p-1 rounded text-white"><X size={16}/></button></div>) : (<div className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-700"><span className="text-slate-500 text-xs">{config.apiKey ? '••••••••' : 'No Key'}</span><button onClick={() => { setEditingProviderId(config.id); setTempApiKey(''); }} className="text-slate-400 hover:text-white"><Settings size={14}/></button></div>)}</div><div className="flex justify-between items-center pt-2 border-t border-slate-700/50"><button onClick={() => handleToggleActiveAI(config)} disabled={config.isActive} className={`text-xs flex items-center gap-1 ${config.isActive ? 'text-indigo-400' : 'text-slate-400 hover:text-white'}`}>{config.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />} Active</button><button onClick={() => handleToggleFallbackAI(config)} className={`text-xs flex items-center gap-1 ${config.isFallback ? 'text-yellow-400' : 'text-slate-400 hover:text-white'}`}>{config.isFallback ? <ToggleRight size={18} /> : <ToggleLeft size={18} />} Fallback</button></div></div></div>))}</div><div className="bg-slate-800 p-6 rounded-xl border border-slate-700 space-y-6"><div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"><h3 className="text-lg font-bold text-white flex items-center gap-2"><BarChart3 size={20} className="text-indigo-400" /> Usage Summary</h3><div className="flex items-center gap-2"><Filter size={16} className="text-slate-400" /><select value={aiFilter} onChange={(e) => setAiFilter(e.target.value)} className="bg-slate-900 border border-slate-600 text-white text-sm rounded-lg block px-3 py-2 outline-none"><option value="all">All Providers</option><option value="google">Gemini</option><option value="openai">OpenAI</option><option value="claude">Claude</option></select></div></div><div className="grid grid-cols-2 md:grid-cols-5 gap-4"><div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700"><div className="text-slate-400 text-xs font-bold mb-1 uppercase">Requests</div><div className="text-2xl font-bold text-white">{aiStats.count}</div></div><div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700"><div className="text-slate-400 text-xs font-bold mb-1 uppercase">Tokens</div><div className="text-lg font-bold text-slate-200 break-all"><span className="text-sky-400">{aiStats.inputTokens.toLocaleString()}</span> / <span className="text-emerald-400">{aiStats.outputTokens.toLocaleString()}</span></div></div><div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700"><div className="text-slate-400 text-xs font-bold mb-1 uppercase">Cost</div><div className="text-2xl font-bold text-white">${aiStats.cost.toFixed(4)}</div></div><div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700"><div className="text-slate-400 text-xs font-bold mb-1 uppercase">Revenue</div><div className="text-2xl font-bold text-emerald-400">${revenueUsd.toFixed(4)}</div></div><div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700"><div className="text-slate-400 text-xs font-bold mb-1 uppercase">Net Profit</div><div className={`text-2xl font-bold ${profitUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>${profitUsd.toFixed(4)}</div></div></div></div><div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col"><div className="p-4 border-b border-slate-700 flex justify-between items-center"><span className="font-semibold text-white">Log ({aiFilter})</span><span className="text-xs text-slate-500">Page {currentPage}</span></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-3">Time</th><th className="p-3">User</th><th className="p-3">Project</th><th className="p-3">Model</th><th className="p-3">Action</th><th className="p-3">In</th><th className="p-3">Out</th><th className="p-3">Cost</th><th className="p-3">Cr</th></tr></thead><tbody className="divide-y divide-slate-700">{filteredLedger.length === 0 ? (<tr><td colSpan={9} className="p-8 text-center text-slate-500">None.</td></tr>) : (filteredLedger.map((row: any, i: number) => {const userObj = allUsers.find(u => u.id === row.userId); const projectObj = projects.find(p => p.id === row.projectId); return (<tr key={i} className="hover:bg-slate-700/30 cursor-pointer" onClick={() => setSelectedUsageLog(row)}><td className="p-3 text-slate-400 whitespace-nowrap text-xs">{new Date(row.createdAt).toLocaleString()}</td><td className="p-3 text-xs max-w-[150px] truncate text-slate-300" title={userObj?.email || row.userId}>{userObj?.email || <span className="font-mono opacity-50">{row.userId?.substring(0, 8) || '???'}...</span>}</td><td className="p-3 text-xs max-w-[150px] truncate text-slate-300" title={projectObj?.name || row.projectId}>{projectObj?.name || (row.projectId ? <span className="font-mono opacity-50">{row.projectId?.substring(0, 8) || '???'}...</span> : '-')}</td><td className="p-3 text-white text-xs">{row.model}</td><td className="p-3 text-slate-400 text-xs">{row.operationType}</td><td className="p-3 font-mono text-slate-400">{row.inputTokens}</td><td className="p-3 font-mono text-slate-400">{row.outputTokens}</td><td className="p-3 font-mono text-emerald-400">${Number(row.rawCostUsd).toFixed(5)}</td><td className="p-3 font-mono text-slate-300">{Number(row.creditsDeducted).toFixed(4)}</td></tr>);}))}</tbody></table></div><PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} /></div></div>)}
                    {view === 'financials' && (<div className="space-y-6"><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"><div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><div className="flex items-center gap-3 mb-2"><CreditCard size={18} className="text-indigo-400" /><div className="text-slate-400 text-sm font-medium">Revenue (Cr)</div></div><div className="text-2xl font-bold text-white">{financialStats.totalRevenueCredits.toFixed(2)}</div></div><div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><div className="flex items-center gap-3 mb-2"><DollarSign size={18} className="text-red-400" /><div className="text-slate-400 text-sm font-medium">Cost (USD)</div></div><div className="text-2xl font-bold text-white">${financialStats.totalCostUsd.toFixed(4)}</div></div><div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><div className="flex items-center gap-3 mb-2"><TrendingUp size={18} className="text-emerald-400" /><div className="text-slate-400 text-sm font-medium">Net Profit</div></div><div className="text-2xl font-bold text-white">${financialStats.netProfitUsd.toFixed(4)}</div></div><div className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col justify-between"><div className="flex items-center gap-3 mb-2"><Settings size={18} className="text-slate-400" /><div className="text-slate-400 text-sm font-medium">Margin %</div></div><div className="flex gap-2"><input type="number" step="0.01" value={newMargin} onChange={e => setNewMargin(e.target.value)} className="bg-slate-900 border border-slate-600 rounded px-2 py-1 w-full text-white" /><button onClick={handleUpdateMargin} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1 rounded">Save</button></div></div></div><div className="bg-slate-800 border border-slate-700 rounded-xl p-6"><h3 className="text-lg font-bold text-white flex items-center gap-2"><CreditCard size={20} className="text-emerald-400"/> Adjustment</h3><div className="space-y-4"><div className="flex gap-2"><input type="text" placeholder="User email..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white" /><button onClick={handleSearchUser} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex items-center gap-2" disabled={isLoading}>{isLoading && <Loader2 size={14} className="animate-spin" />}Search</button></div>{targetUser && (<div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 flex flex-wrap md:flex-nowrap items-center gap-4 animate-in fade-in"><div className="flex-1 min-w-[200px]"><div className="font-bold text-white">{targetUser.email}</div><div className="text-sm text-slate-400">Balance: <span className="text-emerald-400 font-mono">{targetUser.credits_balance}</span></div></div><input type="number" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} placeholder="+/- Amt" className="w-32 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white" /><input type="text" value={adjustmentNote} onChange={e => setAdjustmentNote(e.target.value)} placeholder="Reason" className="w-48 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white" /><button onClick={() => handleAdjustCredit(targetUser.id, targetUser.email)} disabled={isAdjusting} className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded font-medium flex items-center gap-2 disabled:opacity-50">{isAdjusting && <Loader2 className="animate-spin" size={14} />} Execute</button></div>)}</div></div><div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col"><div className="p-4 border-b border-slate-700 font-semibold text-white">Global Ledger</div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-3">Time</th><th className="p-3">User</th><th className="p-3">Action</th><th className="p-3">Model</th><th className="p-3 text-right">Tokens</th><th className="p-3 text-right">Cost</th><th className="p-3 text-right">Credits</th></tr></thead><tbody className="divide-y divide-slate-700">{ledger.map((entry, i) => (<tr key={i} className="hover:bg-slate-700/30"><td className="p-3 text-slate-400 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td><td className="p-3 font-mono text-slate-500">{entry.userId?.substring(0, 8) || '???'}...</td><td className="p-3"><span className="bg-slate-900 px-2 py-1 rounded text-xs">{entry.operationType}</span></td><td className="p-3 text-slate-300 text-xs">{entry.model}</td><td className="p-3 text-right font-mono text-xs">{entry.inputTokens} / {entry.outputTokens}</td><td className="p-3 text-right font-mono text-slate-400">${entry.rawCostUsd.toFixed(5)}</td><td className="p-3 text-right font-bold text-white">{entry.creditsDeducted.toFixed(4)}</td></tr>))}</tbody></table></div><PaginationControls currentPage={currentPage} totalItems={totalItems} itemsPerPage={ITEMS_PER_PAGE} onPageChange={setCurrentPage} /></div></div>)}
                    {view === 'database' && (<div className="max-w-4xl mx-auto space-y-6"><div className="bg-slate-800 p-6 rounded-xl border border-slate-700"><h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2"><Database size={20} className="text-indigo-400" /> System DB</h3><p className="text-slate-400 text-sm mb-6">Ensure tables and RPCs are installed.</p><div className="flex items-center gap-4 p-4 bg-slate-900/50 rounded-lg border border-slate-800 mb-6"><div className={`p-3 rounded-full ${dataError ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>{dataError ? <AlertTriangle size={24} /> : <Check size={24} />}</div><div><h4 className={`font-bold ${dataError ? 'text-red-400' : 'text-emerald-400'}`}>{dataError ? 'Issue Detected' : 'Operational'}</h4><p className="text-xs text-slate-500">{dataError || 'Core tables accessible.'}</p></div></div><button onClick={() => setShowSqlWizard(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition-all shadow-lg shadow-indigo-500/20"><Terminal size={18} /> Run Wizard</button></div></div>)}
                </main>
            </div>
        </div>
    );
};

export default AdminPanel;
