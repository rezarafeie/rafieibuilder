
import React, { useState } from 'react';
import { User } from '../types';
import { cloudService } from '../services/cloudService';
import { useTranslation } from '../utils/translations';
import { Sparkles, ArrowRight, Loader2, Lock, Mail, User as UserIcon } from 'lucide-react';

interface AuthPageProps {
  onLogin: (user: User) => void;
}

const AuthPage: React.FC<AuthPageProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { t, dir } = useTranslation();
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
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
      onLogin(user);
    } catch (err: any) {
      setError(err.message || t('authFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0f172a] flex flex-col items-center justify-center p-4 relative overflow-hidden transition-colors duration-300" dir={dir}>
      
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-200/40 dark:bg-indigo-900/20 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-200/40 dark:bg-blue-900/20 rounded-full blur-[120px]"></div>
      </div>

      <div className="w-full max-w-md bg-white/80 dark:bg-[#1e293b]/80 backdrop-blur-xl border border-slate-200 dark:border-gray-700 rounded-2xl shadow-2xl z-10 p-8">
        
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 mb-4 shadow-lg shadow-indigo-500/30">
            <Sparkles className="text-white" size={24} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">{t('welcomeTitle')}</h1>
          <p className="text-slate-500 dark:text-gray-400 text-sm">
            {isLogin ? t('loginDesc') : t('signupDesc')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
            
            {!isLogin && (
            <div className="space-y-1">
                <label className="text-xs font-medium text-slate-500 dark:text-gray-400 ml-1">{t('fullName')}</label>
                <div className="relative">
                    <UserIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 rtl:right-3 rtl:left-auto" />
                    <input 
                        type="text" 
                        required 
                        value={formData.name}
                        onChange={e => setFormData({...formData, name: e.target.value})}
                        className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all rtl:pr-10 rtl:pl-4 placeholder:text-slate-400 dark:placeholder:text-gray-600"
                        placeholder="John Doe"
                    />
                </div>
            </div>
            )}

            <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 ml-1">{t('emailAddress')}</label>
            <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 rtl:right-3 rtl:left-auto" />
                <input 
                    type="email" 
                    required 
                    value={formData.email}
                    onChange={e => setFormData({...formData, email: e.target.value})}
                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all rtl:pr-10 rtl:pl-4 placeholder:text-slate-400 dark:placeholder:text-gray-600"
                    placeholder="name@example.com"
                />
            </div>
            </div>

            <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500 dark:text-gray-400 ml-1">{t('password')}</label>
            <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 rtl:right-3 rtl:left-auto" />
                <input 
                    type="password" 
                    required 
                    value={formData.password}
                    onChange={e => setFormData({...formData, password: e.target.value})}
                    className="w-full bg-slate-50 dark:bg-[#0f172a] border border-slate-200 dark:border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all rtl:pr-10 rtl:pl-4 placeholder:text-slate-400 dark:placeholder:text-gray-600"
                    placeholder="••••••••"
                />
            </div>
            </div>

            {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-600 dark:text-red-200 text-sm flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                {error}
            </div>
            )}

            <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-indigo-900/20"
            >
            {loading ? <Loader2 size={18} className="animate-spin" /> : (
                <>
                    {isLogin ? t('signIn') : t('createAccount')}
                    <ArrowRight size={18} className="rtl:rotate-180" />
                </>
            )}
            </button>
        </form>

        <div className="mt-6 text-center">
            <button 
                onClick={() => { setIsLogin(!isLogin); setError(''); }}
                className="text-sm text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
                {isLogin ? t('noAccount') : t('haveAccount')}
            </button>
        </div>

      </div>
      
      <div className="mt-8 text-center text-xs text-slate-500 dark:text-gray-600">
        <p>{t('protectedBy')}</p>
      </div>

    </div>
  );
};

export default AuthPage;
