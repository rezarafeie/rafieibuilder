import React, { useState, useEffect, useRef } from 'react';
import { X, Trash2, Terminal, Monitor, Cloud, Rocket } from 'lucide-react';

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    source?: string;
}

interface ProjectLogModalProps {
    isOpen: boolean;
    onClose: () => void;
    builderLogs: LogEntry[];
    previewLogs: LogEntry[];
    cloudLogs: LogEntry[];
    vercelLogs: LogEntry[];
    onClear: (logType: 'preview' | 'all') => void;
}

type LogTab = 'builder' | 'preview' | 'cloud' | 'vercel';

const LogLine: React.FC<{ log: LogEntry }> = ({ log }) => {
    const levelColor = {
        error: 'text-red-400',
        warn: 'text-yellow-400',
        info: 'text-blue-400',
        debug: 'text-purple-400',
        log: 'text-slate-400',
    };
    const levelBg = {
        error: 'bg-red-900/50',
        warn: 'bg-yellow-900/50',
        info: 'bg-blue-900/50',
        debug: 'bg-purple-900/50',
        log: 'bg-slate-800',
    }

    return (
        <div className="flex items-start gap-3 hover:bg-slate-800/50 px-2 py-1 rounded">
            <span className="text-slate-600 shrink-0 select-none">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${levelBg[log.level]} ${levelColor[log.level]}`}>{log.level}</span>
            <pre className="flex-1 text-slate-300 whitespace-pre-wrap break-words">{log.message}</pre>
        </div>
    );
};

const ProjectLogModal: React.FC<ProjectLogModalProps> = ({ isOpen, onClose, builderLogs, previewLogs, cloudLogs, vercelLogs, onClear }) => {
    const [activeTab, setActiveTab] = useState<LogTab>('builder');
    const scrollRef = useRef<HTMLDivElement>(null);

    const logsMap: Record<LogTab, LogEntry[]> = {
        builder: builderLogs,
        preview: previewLogs,
        cloud: cloudLogs,
        vercel: vercelLogs,
    };

    const activeLogs = logsMap[activeTab];

    useEffect(() => {
        if (isOpen) {
            // Scroll to bottom when opening or switching tabs
            setTimeout(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }
            }, 50);
        }
    }, [isOpen, activeTab, activeLogs.length]);

    if (!isOpen) return null;

    const tabs: { id: LogTab; label: string; icon: React.ReactNode }[] = [
        { id: 'builder', label: 'Builder', icon: <Terminal size={14} /> },
        { id: 'preview', label: 'Preview', icon: <Monitor size={14} /> },
        { id: 'cloud', label: 'Cloud', icon: <Cloud size={14} /> },
        { id: 'vercel', label: 'Vercel', icon: <Rocket size={14} /> },
    ];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 text-white" onClick={onClose}>
            <div className="w-full max-w-4xl h-[70vh] bg-[#141E31] border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-[#1E293B]/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <Terminal size={20} className="text-indigo-400"/>
                        <h2 className="text-lg font-bold">Project Logs</h2>
                    </div>
                    <div className="flex items-center gap-2">
                        {activeTab === 'preview' && (
                             <button onClick={() => onClear('preview')} className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 rounded-md transition-colors"><Trash2 size={12} /> Clear Preview Logs</button>
                        )}
                        <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full transition-colors"><X size={18}/></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 p-2 border-b border-slate-800 bg-[#0F172A]">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'}`}
                        >
                            {tab.icon} {tab.label} ({logsMap[tab.id].length})
                        </button>
                    ))}
                </div>

                {/* Log Content */}
                <div ref={scrollRef} className="flex-1 p-4 font-mono text-xs overflow-y-auto bg-black/20 custom-scrollbar space-y-1">
                    {activeLogs.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-500">No logs for this source yet.</div>
                    ) : (
                        activeLogs.map((log, index) => <LogLine key={index} log={log} />)
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProjectLogModal;
