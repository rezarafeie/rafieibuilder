
import React from 'react';
import { Loader2, CheckCircle2, Circle, AlertTriangle, Cloud, X } from 'lucide-react';

type Status = 'provisioning' | 'waking' | 'success' | 'error';

interface CloudConnectionModalProps {
  status: Status;
  error?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}

const CloudConnectionModal: React.FC<CloudConnectionModalProps> = ({ status, error, onRetry, onClose }) => {
  
  const steps = [
    { id: 'provisioning', text: 'Provisioning cloud project...' },
    { id: 'waking', text: 'Waking up & verifying database...' },
  ];

  const getStepStatus = (stepId: 'provisioning' | 'waking') => {
    if (status === 'success') return 'completed';
    if (status === 'error') {
        // If an error occurs during 'waking', the 'provisioning' step is still complete.
        // FIX: The original check `status === 'waking'` was impossible because it was inside a block where `status` is already `'error'`.
        // To fulfill the developer's intent, we now inspect the error message to infer if the failure happened during the 'waking' (database connection) stage.
        if (stepId === 'provisioning' && (error?.includes('Database') || error?.includes('connection'))) return 'completed';
        return 'error';
    }
    
    if (stepId === 'provisioning') {
        return status === 'provisioning' ? 'active' : 'completed';
    }
    if (stepId === 'waking') {
        return status === 'waking' ? 'active' : 'pending';
    }

    return 'pending';
  };
  
  const StepIcon = ({ status }: { status: 'completed' | 'active' | 'error' | 'pending' }) => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={20} className="text-emerald-400" />;
      case 'active': return <Loader2 size={20} className="animate-spin text-indigo-400" />;
      case 'error': return <AlertTriangle size={20} className="text-red-400" />;
      case 'pending': return <Circle size={20} className="text-slate-600" />;
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl p-8 animate-in fade-in zoom-in-95 duration-300">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 mb-4">
              {status === 'success' ? <CheckCircle2 size={32} className="text-emerald-400"/> : <Cloud size={32} className="text-indigo-400"/>}
          </div>
          <h2 className="text-xl font-bold text-white">
            {status === 'error' ? 'Connection Failed' : status === 'success' ? 'Cloud Connected!' : 'Connecting to Rafiei Cloud'}
          </h2>
          <p className="text-slate-400 text-sm mt-2">
            {status === 'success' ? 'Your backend is ready. Resuming build...' : 'This may take a minute or two. Please wait.'}
          </p>
        </div>

        {status !== 'success' && status !== 'error' && (
          <div className="space-y-4">
            {steps.map(step => {
              const stepStatus = getStepStatus(step.id as 'provisioning' | 'waking');
              return (
                <div key={step.id} className={`flex items-center gap-4 p-4 rounded-lg transition-all ${stepStatus === 'active' ? 'bg-slate-800/50' : ''}`}>
                  <StepIcon status={stepStatus} />
                  <span className={`font-medium ${
                    stepStatus === 'completed' ? 'text-slate-500 line-through' : 
                    stepStatus === 'active' ? 'text-white' : 'text-slate-500'
                  }`}>
                    {step.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {status === 'error' && (
          <div className="bg-red-950/40 border border-red-500/30 rounded-xl p-4 text-center">
            <p className="text-sm text-red-300 font-mono break-words">{error || 'An unknown error occurred.'}</p>
            <div className="flex gap-4 mt-4">
              {onRetry && <button onClick={onRetry} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 rounded-lg">Retry</button>}
              <button onClick={onClose} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-medium py-2 rounded-lg">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CloudConnectionModal;
