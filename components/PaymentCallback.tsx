
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { paymentService } from '../services/paymentService';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

const PaymentCallback: React.FC = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState<'verifying' | 'success' | 'failed'>('verifying');
    const [message, setMessage] = useState('Verifying payment...');

    useEffect(() => {
        const verify = async () => {
            const authority = searchParams.get('Authority');
            const statusParam = searchParams.get('Status');

            if (!authority || !statusParam) {
                setStatus('failed');
                setMessage("Invalid callback parameters.");
                return;
            }

            if (statusParam !== 'OK') {
                setStatus('failed');
                setMessage("Payment was canceled by user.");
                return;
            }

            try {
                const result = await paymentService.verifyZarinpalPayment(authority, statusParam);
                if (result.success) {
                    setStatus('success');
                    setMessage(result.message);
                    // Refresh user data (handled by App.tsx logic on reload or nav)
                } else {
                    setStatus('failed');
                    setMessage(result.message);
                }
            } catch (e: any) {
                setStatus('failed');
                setMessage(e.message || "Verification failed.");
            }
        };

        verify();
    }, [searchParams]);

    const handleContinue = () => {
        navigate('/dashboard');
        window.location.reload(); // Force refresh to update credits in header
    };

    return (
        <div className="min-h-screen bg-[#0f172a] flex items-center justify-center p-4 text-white">
            <div className="max-w-md w-full bg-[#1e293b] border border-slate-700 rounded-2xl shadow-2xl p-8 text-center">
                <div className="mb-6 flex justify-center">
                    {status === 'verifying' && <Loader2 size={48} className="animate-spin text-indigo-500" />}
                    {status === 'success' && <CheckCircle2 size={48} className="text-emerald-500" />}
                    {status === 'failed' && <XCircle size={48} className="text-red-500" />}
                </div>
                
                <h2 className="text-2xl font-bold mb-2">
                    {status === 'verifying' ? 'Verifying...' : status === 'success' ? 'Payment Successful!' : 'Payment Failed'}
                </h2>
                
                <p className="text-slate-400 mb-8">{message}</p>
                
                {status !== 'verifying' && (
                    <button 
                        onClick={handleContinue}
                        className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-xl font-medium transition-colors"
                    >
                        Return to Dashboard
                    </button>
                )}
            </div>
        </div>
    );
};

export default PaymentCallback;
