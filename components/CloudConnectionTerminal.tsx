
import React from 'react';
import { Loader2, CheckCircle2, AlertTriangle, Cloud, X } from 'lucide-react';
import { useTranslation } from '../utils/translations';

type Status = 'provisioning' | 'waking' | 'success' | 'error';

interface CloudConnectionTerminalProps {
  status: Status;
  error?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}

const CloudConnectionTerminal: React.FC<CloudConnectionTerminalProps> = ({ status, error, onRetry, onClose }) => {
  const { t, dir } = useTranslation();

  const isComplete = status === 'success' || status === 'error';

  return (
    <div className="w-full py-1 animate-in fade-in duration-300 font-sans" dir={dir}>
      <div className="flex gap-4">
           {/* Icon */}
           <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
               status === 'error' ? 'bg-red-100 text-red-500 dark:bg-red-900/20' : 
               status === 'success' ? 'bg-emerald-100 text-emerald-500 dark:bg-emerald-900/20' : 
               'bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20'
           }`}>
               {status === 'error' ? <AlertTriangle size={12} /> : 
                status === 'success' ? <CheckCircle2 size={12} /> : 
                <Loader2 size={12} className="animate-spin" />}
           </div>

           {/* Content */}
           <div className="flex-1 min-w-0">
               <div className={`text-sm font-medium ${
                   status === 'error' ? 'text-red-700 dark:text-red-400' :
                   status === 'success' ? 'text-emerald-700 dark:text-emerald-400' :
                   'text-slate-800 dark:text-slate-200'
               }`}>
                   {status === 'error' ? t('connectionFailedTitle') : 
                    status === 'success' ? t('cloudConnected') : 
                    status === 'provisioning' ? t('provisioningProject') : t('wakingDatabase')}
               </div>
               
               <div className="text-xs text-slate-500 mt-0.5">
                   {status === 'error' ? (error || t('unknownError')) : 
                    status === 'success' ? t('backendReady') : 
                    t('connectingCloud') + '...'}
               </div>

                {/* Actions */}
                <div className="flex items-center gap-3 mt-2">
                    {status === 'error' && onRetry && (
                        <button onClick={onRetry} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
                            {t('retry')}
                        </button>
                    )}
                    {isComplete && (
                        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                            {t('close')}
                        </button>
                    )}
                </div>
           </div>
      </div>
    </div>
  );
};

export default CloudConnectionTerminal;
