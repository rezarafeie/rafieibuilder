import React, { useState, useEffect } from 'react';
import { Project, User, Domain } from '../types';
import { cloudService } from '../services/cloudService';
import { X, Globe, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Copy, Check, Info, RefreshCw } from 'lucide-react';
import { useTranslation } from '../utils/translations';

interface ManageDomainsModalProps {
  project: Project;
  user: User;
  onClose: () => void;
  onUpdate: () => void;
}

const CodeBlock: React.FC<{ value: string }> = ({ value }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="bg-slate-900/50 font-mono text-xs px-3 py-2 rounded-md flex items-center justify-between border border-slate-700/50 group">
            <span className="text-indigo-300 truncate mr-2">{value}</span>
            <button onClick={handleCopy} className="p-1 text-slate-400 hover:text-white transition-colors">
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            </button>
        </div>
    );
};

const ManageDomainsModal: React.FC<ManageDomainsModalProps> = ({ project, user, onClose, onUpdate }) => {
    const [domains, setDomains] = useState<Domain[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [newDomain, setNewDomain] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [verifyingId, setVerifyingId] = useState<string | null>(null);
    const { t, dir } = useTranslation();

    const fetchDomains = async () => {
        setIsLoading(true);
        try {
            const fetched = await cloudService.getDomainsForProject(project.id);
            setDomains(fetched);
        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    };
    
    useEffect(() => {
        fetchDomains();
    }, [project.id]);

    const handleAddDomain = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDomain) return;
        setIsAdding(true);
        try {
            await cloudService.addDomain(project.id, user.id, newDomain);
            setNewDomain('');
            await fetchDomains();
        } catch (error: any) {
            alert(`Error: ${error.message}`);
        } finally {
            setIsAdding(false);
        }
    };

    const handleDeleteDomain = async (domainId: string) => {
        if (!window.confirm("Are you sure? This will remove the domain and its configuration.")) return;
        try {
            await cloudService.deleteDomain(domainId);
            await fetchDomains();
        } catch(error: any) {
            alert(`Error: ${error.message}`);
        }
    };
    
    const handleVerifyDomain = async (domainId: string) => {
        setVerifyingId(domainId);
        try {
            // Optimistic update
            setDomains(prev => prev.map(d => d.id === domainId ? {...d, status: 'pending'} : d));
            const updatedDomain = await cloudService.verifyDomain(domainId);
            setDomains(prev => prev.map(d => d.id === domainId ? updatedDomain : d));
            
            if (updatedDomain.status === 'verified') {
                onUpdate(); // Refresh parent project state
            }
        } catch (error: any) {
             alert(`Verification failed: ${error.message}`);
             await fetchDomains();
        } finally {
            setVerifyingId(null);
        }
    }

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose} dir={dir}>
            <div className="w-full max-w-3xl bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl p-0 animate-in fade-in zoom-in-95 duration-300 flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
                
                {/* Header */}
                <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50 rounded-t-2xl">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2"><Globe size={20} className="text-indigo-400"/> {t('customDomains')}</h2>
                        <p className="text-slate-400 text-sm mt-1">{t('manageDomains')}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full text-slate-400 transition-colors"><X size={20}/></button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    
                    {/* Add Domain Form */}
                    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
                        <h3 className="font-medium text-white mb-2">{t('addDomain')}</h3>
                        <form onSubmit={handleAddDomain} className="flex gap-2">
                            <input 
                                type="text" 
                                value={newDomain} 
                                onChange={(e) => setNewDomain(e.target.value.toLowerCase())} 
                                placeholder={t('domainPlaceholder')} 
                                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-500" 
                            />
                            <button type="submit" disabled={isAdding || !newDomain} className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2.5 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-indigo-500/20">
                                {isAdding ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18}/>}
                                {t('add')}
                            </button>
                        </form>
                        <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
                            <Info size={12} /> {t('domainSupport')}
                        </p>
                    </div>

                    {/* Domain List */}
                    <div className="space-y-4">
                        {isLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 text-slate-500 gap-3">
                                <Loader2 className="animate-spin text-indigo-500" />
                                <span>{t('loading')}</span>
                            </div>
                        ) : domains.length === 0 ? (
                            <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl">
                                <Globe size={32} className="mx-auto mb-2 opacity-20" />
                                <p>No domains connected yet.</p>
                            </div>
                        ) : (
                            domains.map(d => (
                                <div key={d.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden transition-all hover:border-slate-600">
                                    {/* Domain Header */}
                                    <div className="p-4 flex items-center justify-between border-b border-slate-700/50 bg-slate-800/80">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-slate-900 rounded-lg border border-slate-700">
                                                <Globe size={18} className={d.status === 'verified' ? 'text-green-400' : 'text-slate-400'} />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-white text-sm">{d.domainName}</h4>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">{d.type}</span>
                                                    {d.status === 'verified' && <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded border border-green-500/20 flex items-center gap-1"><CheckCircle2 size={10} /> Active</span>}
                                                    {d.status === 'pending' && <span className="text-[10px] bg-yellow-500/10 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-500/20 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Pending</span>}
                                                    {d.status === 'error' && <span className="text-[10px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20 flex items-center gap-1"><AlertCircle size={10} /> Error</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button 
                                                onClick={() => handleVerifyDomain(d.id)} 
                                                disabled={verifyingId === d.id || d.status === 'verified'}
                                                className={`text-xs px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${d.status === 'verified' ? 'bg-transparent border-transparent text-slate-500 cursor-default' : 'bg-slate-700 hover:bg-slate-600 text-white border-slate-600'}`}
                                            >
                                                {verifyingId === d.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                                {d.status === 'verified' ? 'Auto-Checked' : 'Verify DNS'}
                                            </button>
                                            <button onClick={() => handleDeleteDomain(d.id)} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                                <Trash2 size={16}/>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Configuration Instructions */}
                                    {d.status !== 'verified' && (
                                        <div className="p-4 bg-slate-900/30">
                                            <p className="text-xs text-slate-400 mb-3">
                                                Add the following record to your DNS provider (e.g. GoDaddy, Namecheap, Cloudflare) to connect this domain.
                                            </p>
                                            <div className="grid grid-cols-[80px_1fr] gap-4 items-center mb-2">
                                                <span className="text-xs font-bold text-slate-500 uppercase text-right">Type</span>
                                                <span className="text-xs font-mono text-white bg-slate-800 px-2 py-1 rounded w-fit border border-slate-700">{d.dnsRecordType}</span>
                                            </div>
                                            <div className="grid grid-cols-[80px_1fr] gap-4 items-center mb-2">
                                                <span className="text-xs font-bold text-slate-500 uppercase text-right">Name</span>
                                                <span className="text-xs font-mono text-white bg-slate-800 px-2 py-1 rounded w-fit border border-slate-700">
                                                    {d.type === 'root' ? '@' : d.domainName.split('.')[0]}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-[80px_1fr] gap-4 items-center">
                                                <span className="text-xs font-bold text-slate-500 uppercase text-right">Value</span>
                                                <div className="w-full max-w-sm">
                                                    <CodeBlock value={d.dnsRecordValue || ''} />
                                                </div>
                                            </div>
                                            {d.status === 'error' && (
                                                <div className="mt-3 text-xs text-red-400 bg-red-900/10 border border-red-900/20 p-2 rounded flex items-center gap-2">
                                                    <AlertCircle size={12} /> DNS resolution failed. Please check your settings and wait for propagation (up to 24h).
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageDomainsModal;