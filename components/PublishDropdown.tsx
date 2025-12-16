

import React, { useState } from 'react';
import { Project, User, VercelConfig } from '../types';
import { useTranslation } from '../utils/translations';
import { Globe, Users, Copy, ExternalLink, Star, Check, Loader2, Rocket, RefreshCw, AlertTriangle } from 'lucide-react';
import { vercelService } from '../services/vercelService';
import { cloudService } from '../services/cloudService';

interface PublishDropdownProps {
  project: Project;
  user: User;
  onManageDomains: () => void;
  onClose: () => void;
  onUpdate: () => void;
  onDeployStart: () => void; // New prop
  onDeployComplete: (vercelConfig: VercelConfig | null, error: string | null) => void; // New prop
}

const PublishDropdown: React.FC<PublishDropdownProps> = ({ project, onManageDomains, onDeployStart, onDeployComplete }) => {
    const { t, dir } = useTranslation();
    const [copied, setCopied] = useState(false);
    
    // Deployment State (kept local for immediate feedback only, main status handled by parent)
    const [deployError, setDeployError] = useState<string | null>(null);

    // Calculate dynamic preview URL (Cloud Run - Internal)
    const baseUrl = window.location.href.split('#')[0];
    const previewUrl = `${baseUrl}#/preview/${project.id}`;
    
    // Vercel Stable URL
    const vercelUrl = project.vercelConfig?.productionUrl;
    
    // Use custom domain if present, otherwise Vercel URL, otherwise Preview URL
    const projectUrl = project.customDomain 
        ? `https://${project.customDomain}` 
        : (vercelUrl || previewUrl);
    
    const handleCopy = () => {
        navigator.clipboard.writeText(projectUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handlePublish = async () => {
        if (project.status === 'generating') {
            setDeployError("Cannot publish while building.");
            return;
        }

        onDeployStart(); // Notify parent that deployment has started
        setDeployError(null);

        try {
            // 1. Create/Get Vercel Project
            const vercelConfig = await vercelService.publishProject(project);
            
            // 2. Save new config to database
            const updatedProject = { ...project, vercelConfig };
            await cloudService.saveProject(updatedProject);
            
            // Notify parent about completion (success)
            onDeployComplete(vercelConfig, null);

        } catch (e: any) {
            console.error("Deploy Failed", e);
            setDeployError(e.message || "Deployment failed");
            // Notify parent about completion (failure)
            onDeployComplete(null, e.message || "Deployment failed");
        }
    };

    const lastDeployed = project.vercelConfig?.lastDeployedAt 
        ? new Date(project.vercelConfig.lastDeployedAt).toLocaleString() 
        : null;

    return (
        <div className="w-[90vw] max-w-[24rem] md:w-96 bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl text-slate-900 dark:text-white p-4 animate-in fade-in slide-in-from-top-2 duration-200" onClick={(e) => e.stopPropagation()} dir={dir}>
            
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold flex items-center gap-2">{t('publish')}
                    {project.vercelConfig ? (
                        <span className="text-xs font-medium bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full border border-green-200 dark:border-green-500/30">
                            {t('live')}
                        </span>
                    ) : (
                        <span className="text-xs font-medium bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded-full">
                            Draft
                        </span>
                    )}
                </h3>
            </div>

            {/* Primary Action Button */}
            <div className="mb-4">
                {/* Disable button if parent says it's deploying */}
                <button 
                    onClick={handlePublish}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                >
                    {project.vercelConfig ? <RefreshCw size={18} /> : <Rocket size={18} />}
                    {project.vercelConfig ? "Update Deployment" : "Publish to Web"}
                </button>
                
                {deployError && (
                    <div className="mt-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded border border-red-100 dark:border-red-900/30 flex items-start gap-2">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        {deployError}
                    </div>
                )}
                
                {lastDeployed && (
                    <div className="text-[10px] text-center text-slate-400 mt-2">
                        Last updated: {lastDeployed}
                    </div>
                )}
            </div>

            {/* URL Display */}
            {project.vercelConfig && (
                <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-gray-700/80 rounded-lg p-2 flex items-center justify-between mb-4 gap-2">
                    <a 
                        href={projectUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="bg-transparent text-sm w-full outline-none text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 hover:underline truncate block px-1"
                        title={projectUrl}
                    >
                        {projectUrl.replace('https://', '')}
                    </a>
                    <button 
                        onClick={handleCopy} 
                        className="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-gray-700 rounded flex-shrink-0 transition-colors"
                        title="Copy URL"
                    >
                        {copied ? <Check size={14} className="text-green-600 dark:text-green-500" /> : <Copy size={14} />}
                    </button>
                </div>
            )}

            {/* Custom Domain Section */}
            <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Custom Domain</span>
                    {project.customDomain && (
                        <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">Active</span>
                    )}
                </div>
                
                {project.customDomain ? (
                    <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <Globe size={14} className="text-slate-400" />
                        <span className="truncate flex-1">{project.customDomain}</span>
                        <button onClick={onManageDomains} className="text-xs text-indigo-500 hover:underline">Manage</button>
                    </div>
                ) : (
                    <button 
                        onClick={onManageDomains}
                        className="w-full text-left text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white flex items-center gap-2 py-1"
                    >
                        <div className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                            <Globe size={12} />
                        </div>
                        Add Custom Domain
                    </button>
                )}
            </div>
        </div>
    );
};

export default PublishDropdown;