
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User } from '../types';
import { cloudService, supabase } from '../services/cloudService';
import { useTranslation } from '../utils/translations';
import AuthModal from './AuthModal';
import PromptInputBox from './PromptInputBox';
import { Sparkles, Loader2, Rocket } from 'lucide-react';

const ADJECTIVES = ['amazing', 'perfect', 'beautiful', 'incredible', 'innovative', 'stunning', 'awesome'];

const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [dynamicAdjective, setDynamicAdjective] = useState('amazing');
  const [isSystemOnline, setIsSystemOnline] = useState(true);
  const { t, dir } = useTranslation();

  useEffect(() => {
    // Pick a random adjective on mount
    setDynamicAdjective(ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]);

    // Check for existing user session
    cloudService.getCurrentUser().then(setUser);

    // Check System Status with Timeout to ensure red dot appears on hang
    const checkSystem = async () => {
        try {
            // Lightweight check to verify DB connectivity
            const checkPromise = supabase.from('projects').select('count', { count: 'exact', head: true });
            // Reject after 5 seconds to show offline status quickly if hung
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));
            
            const result = await Promise.race([checkPromise, timeoutPromise]) as any;
            
            if (result.error) throw result.error;
            setIsSystemOnline(true);
        } catch (e) {
            console.error("System offline:", e);
            setIsSystemOnline(false);
        }
    };
    checkSystem();

    // Listen for auth state changes just to update UI if needed (App.tsx handles routing)
    const subscription = cloudService.onAuthStateChange((user) => {
        setUser(user);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSendMessage = async (content: string, images: { url: string; base64: string }[]) => {
    // Save intent to session storage so Dashboard can pick it up after redirect
    sessionStorage.setItem('rafiei_pending_prompt', JSON.stringify({ content, images }));
    setAuthModalOpen(true);
  };

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setAuthModalOpen(false);
    // App.tsx will detect the auth change and redirect to /dashboard automatically
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-white flex flex-col relative overflow-hidden font-['Inter'] transition-colors duration-300" dir={dir}>
      {/* Background Gradients */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-50%] left-[-20%] w-[80vw] h-[80vw] md:w-[60%] md:h-[60%] bg-indigo-200/40 dark:bg-indigo-900/30 rounded-full blur-[150px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-50%] right-[-20%] w-[80vw] h-[80vw] md:w-[50%] md:h-[50%] bg-blue-200/40 dark:bg-red-900/20 rounded-full blur-[150px] animate-pulse-slow animation-delay-4000"></div>
      </div>
      
      {isLoading && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-white animate-in fade-in duration-300">
            <div className="flex items-center gap-3 bg-slate-800 px-6 py-4 rounded-full shadow-xl border border-slate-700">
                <Loader2 className="animate-spin text-indigo-400" size={20} />
                <span className="font-medium text-slate-200">{t('creatingProject')}</span>
            </div>
        </div>
      )}

      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setAuthModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

      {/* Header */}
      <header className="relative z-10 px-6 py-6 flex items-center justify-between max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-2">
            <div className="bg-white dark:bg-slate-800 p-2 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                <Rocket size={24} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Rafiei Builder</span>
            <div 
                className={`w-2 h-2 rounded-full ml-1 ${isSystemOnline ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'}`} 
                title={isSystemOnline ? "System Online" : "System Offline"}
            ></div>
        </div>
        <div className="flex items-center gap-4">
            {user ? (
                 <button onClick={() => navigate('/dashboard')} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-2.5 rounded-full font-semibold hover:bg-slate-800 dark:hover:bg-gray-100 transition-colors shadow-lg shadow-black/10 dark:shadow-white/10">
                    {t('dashboard')}
                </button>
            ) : (
                <>
                    <button onClick={() => setAuthModalOpen(true)} className="text-slate-600 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white font-medium transition-colors">{t('login')}</button>
                    <button onClick={() => setAuthModalOpen(true)} className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-5 py-2.5 rounded-full font-semibold hover:bg-slate-800 dark:hover:bg-gray-100 transition-colors shadow-lg shadow-black/10 dark:shadow-white/10">
                        {t('getStarted')}
                    </button>
                </>
            )}
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 pb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-sm font-medium mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <Sparkles size={14} />
            <span>{t('geminiBadge')}</span>
        </div>
        
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-4 max-w-4xl bg-clip-text text-transparent bg-gradient-to-br from-slate-900 via-slate-600 to-indigo-600 dark:from-white dark:via-slate-300 dark:to-indigo-400 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100">
            {t('heroTitle')} <span className="text-indigo-600 dark:text-indigo-400">{dynamicAdjective}</span>
        </h1>
        
        <p className="text-lg md:text-xl text-slate-600 dark:text-slate-400 max-w-2xl mb-12 leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-700 delay-200">
            {t('heroDesc')}
        </p>
        
        <div className="w-full max-w-2xl mx-auto animate-in fade-in zoom-in-95 duration-500 delay-300">
             <PromptInputBox 
                onSendMessage={handleSendMessage}
                onInteraction={() => !user && setAuthModalOpen(true)}
                isThinking={isLoading}
             />
        </div>
      </main>
      
    </div>
  );
};

export default LandingPage;
