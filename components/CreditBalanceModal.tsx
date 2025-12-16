
import React, { useState, useEffect } from 'react';
import { User, CreditTransaction } from '../types';
import { cloudService } from '../services/cloudService';
import { paymentService } from '../services/paymentService';
import { useTranslation } from '../utils/translations';
import { Wallet, CreditCard, X, History, TrendingUp, TrendingDown, AlertTriangle, Loader2 } from 'lucide-react';

interface CreditBalanceModalProps {
    user: User;
    onClose: () => void;
}

// RESTRICTED KEY: Only for reference, do not use in client-side calls without security review
const STRIPE_KEY_REF = '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';

const CreditBalanceModal: React.FC<CreditBalanceModalProps> = ({ user, onClose }) => {
    const { t, lang, dir } = useTranslation();
    const [transactions, setTransactions] = useState<CreditTransaction[]>([]);
    const [activeTab, setActiveTab] = useState<'buy' | 'history'>('buy');
    
    // Purchase State
    const [buyAmount, setBuyAmount] = useState<string>('10');
    const [rate, setRate] = useState<number | null>(null);
    const [isRateLoading, setIsRateLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [purchaseError, setPurchaseError] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, [user.id]);

    useEffect(() => {
        if (activeTab === 'buy' && lang === 'fa') {
            setIsRateLoading(true);
            paymentService.getUsdToIrrRate().then(r => {
                setRate(r);
            }).catch(e => {
                console.error("Rate fetch failed", e);
                setRate(128500); // Fallback to safe estimate
            }).finally(() => {
                setIsRateLoading(false);
            });
        } else {
            setRate(0.1); // 1 USD = 10 Credits => 1 Credit = 0.1 USD
        }
    }, [lang, activeTab]);

    const loadData = async () => {
        try {
            // Updated to use cloudService which holds the session
            const txs = await cloudService.getUserTransactions(user.id);
            setTransactions(txs);
        } catch (e) {
            console.error(e);
        }
    };

    const handleBuy = async () => {
        const amount = parseFloat(buyAmount);
        if (isNaN(amount) || amount < 1) {
            setPurchaseError(t('minimumPurchase'));
            return;
        }
        
        setIsProcessing(true);
        setPurchaseError(null);

        try {
            if (lang === 'fa') {
                // Zarinpal Flow
                const url = await paymentService.requestZarinpalPayment(amount, user.email, ''); // Mobile optional
                window.location.href = url; // Redirect to Payment Gateway
            } else {
                // Disable insecure Stripe simulation. 
                // A secure implementation requires a backend endpoint to create a PaymentIntent.
                alert("Stripe payments are currently disabled in this demo environment. Please use Zarinpal or contact support.");
                setIsProcessing(false);
                return;
            }
        } catch (e: any) {
            setPurchaseError(e.message);
            setIsProcessing(false);
        }
    };

    const getTransactionLabel = (type: string) => {
        switch (type) {
            case 'purchase': return t('creditPurchase');
            case 'admin_adjustment': return t('adminAdjustment');
            default: return t('transaction');
        }
    };

    const isRtl = dir === 'rtl';

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 font-sans" dir={dir}>
            <div className="bg-white dark:bg-[#1e293b] w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
                            <Wallet size={24} className="text-indigo-500" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-900 dark:text-white">{t('manageCredits')}</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400">{t('currentBalance')}: <strong className="text-emerald-500">{Number(user.credits_balance || 0).toFixed(2)}</strong></p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-500"><X size={20}/></button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-slate-200 dark:border-slate-700">
                    <button 
                        onClick={() => setActiveTab('buy')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'buy' ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        {t('buyCredits')}
                    </button>
                    <button 
                        onClick={() => setActiveTab('history')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'history' ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400 bg-indigo-50/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                    >
                        {t('transactionHistory')}
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 overflow-y-auto">
                    {activeTab === 'buy' ? (
                        <div className="max-w-sm mx-auto space-y-6">
                            <div className="text-center space-y-2">
                                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('addFunds')}</h3>
                                <p className="text-sm text-slate-500">{t('payAsYouGo')}</p>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">{t('amountCredits')}</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        value={buyAmount}
                                        onChange={e => setBuyAmount(e.target.value)}
                                        min="1"
                                        className={`w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-3 text-lg font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none ${isRtl ? 'pl-12 pr-4' : 'pl-4 pr-12'}`}
                                    />
                                    <div className={`absolute top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400 ${isRtl ? 'left-4' : 'right-4'}`}>CR</div>
                                </div>
                            </div>

                            <div className="flex justify-between items-center px-2">
                                <span className="text-sm text-slate-500">{t('totalPrice')}</span>
                                {isRateLoading ? <div className="flex items-center gap-2"><Loader2 className="animate-spin text-indigo-500" size={16} /><span className="text-xs text-slate-400">Fetching rate...</span></div> : (
                                    <span className="text-xl font-bold text-slate-900 dark:text-white">
                                        {lang === 'fa' && rate
                                            ? `${(parseFloat(buyAmount || '0') * (rate / 10)).toLocaleString()} ${t('toman')}` // Divide by 10 for credits
                                            : `$${(parseFloat(buyAmount || '0') * (rate || 0)).toFixed(2)}`
                                        }
                                    </span>
                                )}
                            </div>
                            
                            {lang === 'fa' && (
                                <div className="text-xs text-center text-slate-400">
                                    {isRateLoading ? 'Updating exchange rate...' : 
                                     `${t('exchangeRate')}: 1 USD ≈ ${rate?.toLocaleString()} ${t('toman')} (${t('live')})`
                                    }
                                </div>
                            )}

                            {purchaseError && (
                                <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-sm rounded-lg flex items-center gap-2">
                                    <AlertTriangle size={16} /> {purchaseError}
                                </div>
                            )}

                            <button 
                                onClick={handleBuy}
                                disabled={isProcessing || isRateLoading || !buyAmount || !rate}
                                className={`w-full py-3 text-white rounded-xl font-bold shadow-lg disabled:opacity-50 flex items-center justify-center gap-2 transition-all ${
                                    lang === 'fa' ? 'bg-[#ffc107] hover:bg-[#ffb300] text-slate-900' : 'bg-indigo-600 hover:bg-indigo-500'
                                }`}
                            >
                                {isProcessing ? <Loader2 className="animate-spin" /> : <CreditCard size={20} />}
                                {lang === 'fa' ? t('payWithZarinpal') : t('payWithStripe')}
                            </button>
                            
                            <p className="text-xs text-center text-slate-400">
                                {t('securePayment')} {lang === 'fa' ? 'Zarinpal' : 'Stripe'}.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {transactions.length === 0 ? (
                                <div className="text-center py-8 text-slate-500">{t('noTransactions')}</div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {transactions.map(tx => (
                                        <div key={tx.id} className="py-3 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={`p-2 rounded-full ${tx.amount > 0 ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
                                                    {tx.amount > 0 ? <TrendingUp size={16} /> : <History size={16} />}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900 dark:text-white">
                                                        {getTransactionLabel(tx.type)}
                                                    </div>
                                                    <div className="text-xs text-slate-500">
                                                        {new Date(tx.createdAt).toLocaleDateString()} • {tx.description || tx.currency}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className={`font-mono font-bold ${tx.amount > 0 ? 'text-emerald-500' : 'text-slate-500'}`}>
                                                {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CreditBalanceModal;
