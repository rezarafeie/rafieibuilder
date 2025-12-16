
import React, { useState } from 'react';
import { Github, Loader2, X, AlertTriangle, Check, ArrowRight, FolderGit2 } from 'lucide-react';
import { githubService } from '../services/githubService';
import { ProjectFile } from '../types';
import { useTranslation } from '../utils/translations';

interface GitHubImportModalProps {
    onClose: () => void;
    onImport: (name: string, files: ProjectFile[]) => Promise<void>;
}

const GitHubImportModal: React.FC<GitHubImportModalProps> = ({ onClose, onImport }) => {
    const [step, setStep] = useState<'input' | 'importing' | 'analysis'>('input');
    const [url, setUrl] = useState('');
    const [branch, setBranch] = useState('main');
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [progressMsg, setProgressMsg] = useState('');
    
    // Analysis State
    const [analysis, setAnalysis] = useState<{ framework: string, libraries: string[], files: ProjectFile[], owner: string, repo: string } | null>(null);

    const { t } = useTranslation();

    const handleValidate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        
        const repoInfo = githubService.parseUrl(url);
        if (!repoInfo) {
            setError('Invalid GitHub URL. Format: https://github.com/owner/repo');
            return;
        }

        setStep('importing');
        try {
            const result = await githubService.importProject(
                repoInfo.owner, 
                repoInfo.repo, 
                branch, 
                token || undefined, 
                (msg, pct) => {
                    setProgressMsg(msg);
                    setProgress(pct);
                }
            );
            
            setAnalysis({
                ...result,
                owner: repoInfo.owner,
                repo: repoInfo.repo
            });
            setStep('analysis');
        } catch (err: any) {
            setError(err.message);
            setStep('input');
        }
    };

    const handleConfirmImport = async () => {
        if (!analysis) return;
        setStep('importing');
        setProgressMsg('Creating project in workspace...');
        setProgress(100);
        
        try {
            await onImport(analysis.repo, analysis.files);
            // onImport should handle navigation
        } catch (err: any) {
            setError(err.message);
            setStep('analysis');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2">
                        <Github size={20} className="text-slate-900 dark:text-white"/>
                        <h2 className="font-bold text-slate-900 dark:text-white">Import from GitHub</h2>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    {/* Step 1: Input */}
                    {step === 'input' && (
                        <form onSubmit={handleValidate} className="space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Repository URL</label>
                                <input 
                                    type="text" 
                                    placeholder="https://github.com/username/project" 
                                    value={url}
                                    onChange={e => setUrl(e.target.value)}
                                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
                                    required
                                />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Branch</label>
                                    <div className="relative">
                                        <FolderGit2 size={14} className="absolute left-3 top-2.5 text-slate-400" />
                                        <input 
                                            type="text" 
                                            value={branch}
                                            onChange={e => setBranch(e.target.value)}
                                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Access Token (Optional)</label>
                                    <input 
                                        type="password" 
                                        placeholder="ghp_..." 
                                        value={token}
                                        onChange={e => setToken(e.target.value)}
                                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900 dark:text-white"
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-3">
                                    <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                                    <p className="text-xs text-red-600 dark:text-red-300">{error}</p>
                                </div>
                            )}

                            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all">
                                Analyze Repository <ArrowRight size={16} />
                            </button>
                            <p className="text-center text-[10px] text-slate-400">
                                Supports React, Vite, Next.js and standard frontend repos.
                            </p>
                        </form>
                    )}

                    {/* Step 2: Progress */}
                    {step === 'importing' && (
                        <div className="flex flex-col items-center justify-center py-8 space-y-4">
                            <div className="relative">
                                <svg className="w-16 h-16 transform -rotate-90">
                                    <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-slate-200 dark:text-slate-700" />
                                    <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-indigo-600 transition-all duration-300 ease-out" strokeDasharray="176" strokeDashoffset={176 - (176 * progress) / 100} />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-white">{progress}%</div>
                            </div>
                            <div className="text-center">
                                <h3 className="font-medium text-slate-900 dark:text-white text-sm">Importing Project</h3>
                                <p className="text-xs text-slate-500 mt-1">{progressMsg}</p>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Analysis Confirmation */}
                    {step === 'analysis' && analysis && (
                        <div className="space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 border border-slate-200 dark:border-slate-700 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Framework</span>
                                    <span className="text-sm font-medium text-slate-900 dark:text-white bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded">{analysis.framework}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-500 uppercase font-bold">Files Detected</span>
                                    <span className="text-sm font-mono text-slate-700 dark:text-slate-300">{analysis.files.length}</span>
                                </div>
                                <div>
                                    <span className="text-xs text-slate-500 uppercase font-bold block mb-1">Detected Libraries</span>
                                    <div className="flex flex-wrap gap-1">
                                        {analysis.libraries.length > 0 ? analysis.libraries.map(lib => (
                                            <span key={lib} className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded">{lib}</span>
                                        )) : <span className="text-[10px] text-slate-400 italic">None detected</span>}
                                    </div>
                                </div>
                            </div>

                            <button onClick={handleConfirmImport} className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all">
                                <Check size={16} /> Confirm & Import
                            </button>
                            <button onClick={() => setStep('input')} className="w-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium py-2.5 rounded-lg transition-all text-sm">
                                Back
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GitHubImportModal;
