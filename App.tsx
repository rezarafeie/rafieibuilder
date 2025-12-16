
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { User, Project } from './types';
import { cloudService } from './services/cloudService';
import { setLanguage } from './utils/translations';
import AuthPage from './components/AuthPage';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import ProjectBuilder from './components/ProjectBuilder';
import PreviewPage from './components/PreviewPage';
import CloudManagementPage from './components/CloudManagementPage';
import AdminPanel from './components/AdminPanel';
import PaymentCallback from './components/PaymentCallback';
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { constructFullDocument } from './utils/codeGenerator';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Custom Domain State
  const [customProject, setCustomProject] = useState<Project | null>(null);
  const [isCheckingDomain, setIsCheckingDomain] = useState(true);

  const navigate = useNavigate();
  const location = useLocation();

  const initSession = async () => {
      setLoading(true);
      setError(null);
      
      let attempts = 0;
      const maxAttempts = 2; // Reduce attempts to fail fast

      while (attempts < maxAttempts) {
          try {
              // Timeouts are now handled internally in cloudService.getCurrentUser
              const currentUser = await cloudService.getCurrentUser();
              
              setUser(currentUser);
              
              if (currentUser) {
                  try {
                      const lang = await cloudService.getUserLanguage(currentUser.id);
                      if (lang && (lang === 'en' || lang === 'fa')) {
                          setLanguage(lang as 'en' | 'fa');
                      }
                  } catch (langError) {
                      console.warn("Failed to load user language preference", langError);
                  }
              }
              
              setLoading(false);
              return;

          } catch (e: any) {
              console.error(`Session check attempt ${attempts + 1} failed:`, e);
              attempts++;
              
              if (attempts < maxAttempts) {
                  await new Promise(r => setTimeout(r, 1000));
              } else {
                  // Final failure
                  setError("Connection lost. The server is unreachable or your session has expired.");
                  setLoading(false);
              }
          }
      }
  };

  useEffect(() => {
    // 1. Domain Check Logic
    const checkDomain = async () => {
        const hostname = window.location.hostname;
        const isPlatform = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('webcontainer') || hostname.includes('rafiei.co') || hostname.includes('stackblitz') || hostname.includes('lovable');
        
        if (!isPlatform) {
            try {
                // cloudService now has internal timeouts for this call
                const project = await cloudService.getProjectByDomain(hostname);
                if (project) {
                    setCustomProject(project);
                }
            } catch (e) {
                console.warn("Domain resolution skipped:", e);
            }
        }
        setIsCheckingDomain(false);
    };

    // Run parallel checks
    checkDomain();
    initSession();

    const subscription = cloudService.onAuthStateChange(async (u) => {
      setUser(u);
      if (u) {
          try {
            const lang = await cloudService.getUserLanguage(u.id);
            if (lang && (lang === 'en' || lang === 'fa')) {
                setLanguage(lang as 'en' | 'fa');
            }
          } catch(e) {}
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = (loggedInUser: User) => {
      setUser(loggedInUser);
      navigate('/dashboard');
  };

  const handleLogout = async () => {
      await cloudService.logout();
      setUser(null);
      navigate('/');
  };

  // --- CUSTOM DOMAIN MODE ---
  if (isCheckingDomain) {
      return (
          <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center text-white">
              <Loader2 className="animate-spin text-indigo-500 mb-4" size={48} />
              <p className="text-slate-400 text-sm animate-pulse">Resolving domain...</p>
          </div>
      );
  }

  if (customProject) {
      const srcDoc = constructFullDocument(customProject.code, customProject.id, customProject.files);
      return (
        <iframe 
            srcDoc={srcDoc}
            className="fixed inset-0 w-full h-full border-none m-0 p-0 bg-white z-50"
            title={customProject.name}
            sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
        />
      );
  }

  // --- STANDARD PLATFORM MODE ---

  if (loading) {
      return (
          <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center text-indigo-500 gap-4">
              <Loader2 className="animate-spin" size={48} />
              <p className="text-slate-400 text-sm animate-pulse">Connecting to Rafiei Builder...</p>
              <div className="flex gap-2">
                  <button 
                    onClick={() => window.location.reload()} 
                    className="text-xs text-slate-600 hover:text-white underline mt-2"
                  >
                    Taking too long? Reload
                  </button>
              </div>
          </div>
      );
  }

  if (error && !user) {
      return (
          <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center text-white gap-6 p-4">
              <div className="p-4 bg-red-500/10 rounded-full border border-red-500/20 text-red-400">
                  <AlertTriangle size={32} />
              </div>
              <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">Connection Issue</h2>
                  <p className="text-slate-400 max-w-xs mx-auto">{error}</p>
              </div>
              <button 
                  onClick={async () => {
                      // Aggressively clear session on manual retry
                      await cloudService.disconnectSession();
                      window.location.reload();
                  }}
                  className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-medium transition-colors shadow-lg shadow-indigo-500/20"
              >
                  <RefreshCw size={18} /> Reset & Retry
              </button>
          </div>
      );
  }

  const isAdmin = user?.isAdmin;

  return (
    <Routes>
        <Route path="/" element={user ? <Navigate to="/dashboard" /> : <LandingPage />} />
        
        <Route path="/auth" element={
            user ? <Navigate to="/dashboard" /> : <AuthPage onLogin={handleLogin} />
        } />
        
        <Route path="/dashboard" element={
            user ? <Dashboard user={user} onLogout={handleLogout} view="active" /> : <Navigate to="/auth" state={{ from: location }} />
        } />

        <Route path="/dashboard/trash" element={
            user ? <Dashboard user={user} onLogout={handleLogout} view="trash" /> : <Navigate to="/auth" state={{ from: location }} />
        } />
        
        <Route path="/project/:projectId" element={
            user ? <ProjectBuilder user={user} /> : <Navigate to="/auth" state={{ from: location }} />
        } />
        
        <Route path="/cloud/:projectId" element={
            user ? <CloudManagementPage user={user} /> : <Navigate to="/auth" state={{ from: location }} />
        } />

        <Route path="/preview/:projectId/*" element={<PreviewPage />} />

        <Route path="/payment/verify" element={<PaymentCallback />} />

        <Route path="/admin" element={
            isAdmin ? <AdminPanel user={user!} onClose={() => navigate('/dashboard')} /> : <Navigate to="/dashboard" />
        } />
        
        <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

export default App;
