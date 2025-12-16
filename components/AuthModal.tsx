
import React, { useState } from 'react';
import { User } from '../types';
import { cloudService } from '../services/cloudService';
import { ArrowRight, Loader2, Lock, Mail, User as UserIcon, X, Sparkles } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState<boolean | 'google' | 'github'>(false);
  const [error, setError] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });

  if (!isOpen) return null;

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let user: User;
      if (isLogin) {
        user = await cloudService.login(formData.email, formData.password);
      } else {
        user = await cloudService.register(formData.email, formData.password, formData.name);
      }
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSocialLogin = async (provider: 'google' | 'github') => {
    setLoading(provider);
    setError('');
    try {
      if (provider === 'google') await cloudService.signInWithGoogle();
      if (provider === 'github') await cloudService.signInWithGitHub();
      // The onAuthStateChange listener in App.tsx will handle the redirect and login success.
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-colors duration-300" onClick={onClose}>
        <div className="w-full max-w-sm bg-white dark:bg-[#1e293b] border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl z-10 p-8 text-slate-900 dark:text-white animate-in fade-in zoom-in-95 transition-colors duration-300" onClick={e => e.stopPropagation()}>
            <button onClick={onClose} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"><X size={20}/></button>
            <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-pink-500 mb-4 shadow-lg shadow-indigo-500/30">
                    <Sparkles className="text-white" size={24} />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Start Building.</h1>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Create a free account to begin.</p>
            </div>
            
            <div className="space-y-4">
                {showEmailForm ? (
                    <form onSubmit={handleEmailSubmit} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                        {!isLogin && (
                            <div className="space-y-1">
                                <label className="text-xs font-medium text-slate-500 dark:text-gray-400 ml-1">Full Name</label>
                                <div className="relative">
                                    <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
                                    <input 
                                        type="text" 
                                        required 
                                        value={formData.name}
                                        onChange={e => setFormData({...formData, name: e.target.value})}
                                        className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-400 dark:placeholder:text-gray-600"
                                        placeholder="John Doe"
                                    />
                                </div>
                            </div>
                        )}
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 ml-1">Email Address</label>
                            <div className="relative">
                                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
                                <input 
                                    type="email" 
                                    required 
                                    value={formData.email}
                                    onChange={e => setFormData({...formData, email: e.target.value})}
                                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-400 dark:placeholder:text-gray-600"
                                    placeholder="name@example.com"
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 ml-1">Password</label>
                            <div className="relative">
                                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
                                <input 
                                    type="password" 
                                    required 
                                    value={formData.password}
                                    onChange={e => setFormData({...formData, password: e.target.value})}
                                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all placeholder:text-slate-400 dark:placeholder:text-gray-600"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>
                        
                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-200 text-sm">
                                {error}
                            </div>
                        )}
                        
                        <button 
                            type="submit" 
                            disabled={!!loading}
                            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-indigo-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading === true ? <Loader2 size={18} className="animate-spin" /> : <>{isLogin ? 'Sign In' : 'Create Account'} <ArrowRight size={18} /></>}
                        </button>
                        
                        <button 
                            type="button" 
                            onClick={() => setIsLogin(!isLogin)}
                            className="w-full text-center text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white pt-2 transition-colors"
                        >
                            {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                        </button>
                    </form>
                ) : (
                    <>
                        <button onClick={() => handleSocialLogin('google')} disabled={!!loading} className="w-full justify-center text-sm font-semibold py-3 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-white transition-colors flex items-center gap-3 disabled:opacity-50">
                            {loading === 'google' ? <Loader2 className="animate-spin" size={20} /> : <svg className="w-5 h-5" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.9 8.2,4.73 12.19,4.73C15.29,4.73 17.1,6.7 17.1,6.7L19,4.72C19,4.72 16.56,2 12.19,2C6.42,2 2.03,6.8 2.03,12C2.03,17.05 6.16,22 12.19,22C17.6,22 21.5,18.33 21.5,12.33C21.5,11.76 21.35,11.1 21.35,11.1V11.1Z"></path></svg>} Continue with Google
                        </button>
                        <button onClick={() => handleSocialLogin('github')} disabled={!!loading} className="w-full justify-center text-sm font-semibold py-3 px-4 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-white transition-colors flex items-center gap-3 disabled:opacity-50">
                            {loading === 'github' ? <Loader2 className="animate-spin" size={20} /> : <svg className="w-5 h-5" aria-hidden="true" viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 0,0 2,12C2,16.42 4.87,20.17 8.84,21.5C9.34,21.58 9.5,21.27 9.5,21C9.5,20.77 9.5,20.14 9.5,19.31C6.73,19.91 6.14,17.97 6.14,17.97C5.68,16.81 5.03,16.5 5.03,16.5C4.12,15.88 5.1,15.9 5.1,15.9C6.1,15.97 6.63,16.93 6.63,16.93C7.5,18.45 8.97,18 9.54,17.76C9.63,17.11 9.89,16.67 10.17,16.42C7.95,16.17 5.62,15.31 5.62,11.5C5.62,10.39 6,9.5 6.65,8.79C6.55,8.54 6.2,7.5 6.75,6.15C6.75,6.15 7.59,5.88 9.5,7.17C10.29,6.95 11.15,6.84 12,6.84C12.85,6.84 13.71,6.95 14.5,7.17C16.41,5.88 17.25,6.15 17.25,6.15C17.8,7.5 17.45,8.54 17.35,8.79C18,9.5 18.38,10.39 18.38,11.5C18.38,15.32 16.04,16.16 13.81,16.41C14.17,16.72 14.5,17.33 14.5,18.26C14.5,19.6 14.5,20.68 14.5,21C14.5,21.27 14.66,21.59 15.17,21.5C19.14,20.16 22,16.42 22,12A10,10 0 0,0 12,2Z"></path></svg>} Continue with GitHub
                        </button>
                        <div className="flex items-center">
                            <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
                            <span className="flex-shrink mx-4 text-slate-400 dark:text-slate-500 text-xs">OR</span>
                            <div className="flex-grow border-t border-slate-200 dark:border-slate-700"></div>
                        </div>
                        <button onClick={() => setShowEmailForm(true)} className="w-full text-sm font-semibold py-3 px-4 rounded-lg bg-slate-100 dark:bg-white text-slate-900 hover:bg-slate-200 dark:hover:bg-slate-200 transition-colors">Continue with email</button>
                        <p className="text-xs text-slate-500 text-center px-4">By continuing, you agree to the <a href="#" className="underline hover:text-slate-800 dark:hover:text-slate-300">Terms of Service</a> and <a href="#" className="underline hover:text-slate-800 dark:hover:text-slate-300">Privacy Policy</a>.</p>
                    </>
                )}
            </div>
        </div>
    </div>
  );
};

export default AuthModal;
