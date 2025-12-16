
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RafieiCloudProject, Project, User } from '../types';
import { cloudService } from '../services/cloudService';
import { rafieiCloudService } from '../services/rafieiCloudService';
import { useTranslation } from '../utils/translations';
import { 
    Cloud, Database, Users, HardDrive, Zap, Bot, Key, FileText, 
    ArrowLeft, Loader2, RefreshCw, Plus, Trash2, Check, AlertTriangle, 
    Play, Power, Activity, Settings, Table, Shield, Lock, Eye, Download, Search, Save
} from 'lucide-react';

interface CloudManagementPageProps {
  user: User;
}

type TabId = 'overview' | 'database' | 'auth' | 'users' | 'storage' | 'functions' | 'secrets' | 'logs';

const CloudManagementPage: React.FC<CloudManagementPageProps> = ({ user }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t, dir } = useTranslation();
  
  const [project, setProject] = useState<Project | null>(null);
  const [cloudProject, setCloudProject] = useState<RafieiCloudProject | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Database Tab State
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<any[]>([]);
  const [sqlQuery, setSqlQuery] = useState('');

  // Auth Tab State
  const [authConfig, setAuthConfig] = useState<any>(null);
  const [isAuthDirty, setIsAuthDirty] = useState(false);
  const [isSavingAuth, setIsSavingAuth] = useState(false);

  // Storage Tab State
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [bucketFiles, setBucketFiles] = useState<any[]>([]);
  const [newBucketName, setNewBucketName] = useState('');

  // Users Tab State
  const [newUserEmail, setNewUserEmail] = useState('');

  const fetchData = async () => {
    // 1. Ensure projectId is available from route params
    if (!projectId) {
        setError("Project ID missing from URL.");
        setLoading(false);
        setTabLoading(false); 
        return;
    }

    setTabLoading(true); 
    setError(null);
    setIsPaused(false);
    
    try {
        const latestProject = await cloudService.getProject(projectId);
        if (!latestProject) {
            throw new Error("Project not found in the database.");
        }
        
        const latestCloudProject = latestProject.rafieiCloudProject || null;
        if (!latestCloudProject || !latestCloudProject.projectRef) {
             throw new Error("Rafiei Cloud project not found or not fully provisioned for this project. Status: " + (latestCloudProject?.status || 'N/A') + ". Please ensure it's active.");
        }
        
        setProject(latestProject);
        setCloudProject(latestCloudProject);

        // Now we are guaranteed to have a valid `latestCloudProject` and `projectRef`
        const ref = latestCloudProject.projectRef;
        const key = latestCloudProject.secretKey || '';

        let result;
        switch (activeTab) {
            case 'overview':
                try {
                    result = await rafieiCloudService.getProjectHealth(ref);
                } catch (e: any) {
                    if (e.message && (e.message.includes('ECONNREFUSED') || e.message.includes('400'))) {
                        setIsPaused(true);
                        result = { state: 'PAUSED_OR_UNREACHABLE', error: e.message };
                    } else throw e;
                }
                break;
            case 'database':
                result = await rafieiCloudService.getTables(ref);
                setSelectedTable(null);
                setTableData([]);
                break;
            case 'auth':
                result = await rafieiCloudService.getAuthConfiguration(ref);
                setAuthConfig(result);
                setIsAuthDirty(false);
                break;
            case 'users':
                result = await rafieiCloudService.getAuthUsers(ref);
                break;
            case 'storage':
                result = await rafieiCloudService.getStorageBuckets(ref);
                setSelectedBucket(null);
                break;
            case 'functions':
                result = await rafieiCloudService.getEdgeFunctions(ref);
                break;
            case 'secrets':
                result = await rafieiCloudService.getApiKeys(ref);
                break;
            case 'logs':
                result = []; // Managed by ProjectLogModal, not fetched here directly
                break;
        }
        setData(result);

    } catch (e: any) {
        console.error("Cloud Management Load Error:", e);
        // Clean error message
        let errMsg = e.message || "An unexpected error occurred.";
        if (errMsg.includes('ECONNREFUSED') || errMsg.includes('5432')) setIsPaused(true);
        
        setError(errMsg);
    } finally {
        setTabLoading(false);
        setLoading(false);
    }
  };

  useEffect(() => {
    // Trigger fetchData whenever activeTab or projectId changes
    fetchData();
  }, [activeTab, projectId]); 

  // --- Database Actions ---
  const handleTableSelect = async (tableName: string) => {
      if (!cloudProject?.secretKey) return;
      setSelectedTable(tableName);
      setTabLoading(true);
      try {
          const rows = await rafieiCloudService.getTableData(cloudProject.projectRef, tableName, cloudProject.secretKey);
          setTableData(rows);
      } catch (e: any) {
          alert("Failed to fetch rows: " + e.message);
      } finally {
          setTabLoading(false);
      }
  };

  const handleExecuteSql = async () => {
      if(!sqlQuery.trim() || !cloudProject) return;
      setTabLoading(true);
      try {
          await rafieiCloudService.executeSql(cloudProject.projectRef, sqlQuery);
          alert("Query executed successfully");
          setSqlQuery('');
          if (activeTab === 'database') fetchData(); // Refresh tables
      } catch (e: any) {
          alert(`Error: ${e.message}`);
      } finally {
          setTabLoading(false);
      }
  };

  // --- Auth Actions ---
  const handleToggleAuth = (key: string, currentValue: boolean) => {
      if (!authConfig) return;
      setAuthConfig({ ...authConfig, [key]: !currentValue });
      setIsAuthDirty(true);
  };

  const handleSaveAuth = async () => {
      if (!cloudProject || !authConfig) return;
      setIsSavingAuth(true);
      try {
          await rafieiCloudService.updateAuthConfiguration(cloudProject.projectRef, authConfig);
          setIsAuthDirty(false);
          // Optional: Show success feedback if needed, but the button state reset is usually enough
      } catch (e: any) {
          alert("Update failed: " + e.message);
          fetchData(); // Revert to server state
      } finally {
          setIsSavingAuth(false);
      }
  };

  // --- User Actions ---
  const handleAddUser = async () => {
      if(!newUserEmail.trim() || !cloudProject) return;
      setTabLoading(true);
      try {
          await rafieiCloudService.createUser(cloudProject.projectRef, newUserEmail);
          setNewUserEmail('');
          fetchData();
      } catch(e: any) {
          alert(`Error: ${e.message}`);
      } finally {
          setTabLoading(false);
      }
  };

  const handleDeleteUser = async (userId: string) => {
      if(!cloudProject?.secretKey || !window.confirm("Delete this user?")) return;
      try {
          await rafieiCloudService.deleteUser(cloudProject.projectRef, userId, cloudProject.secretKey);
          fetchData();
      } catch(e: any) {
          alert("Failed to delete user: " + e.message);
      }
  };

  // --- Storage Actions ---
  const handleCreateBucket = async () => {
      if (!newBucketName.trim() || !cloudProject?.secretKey) return;
      try {
          await rafieiCloudService.createBucket(cloudProject.projectRef, newBucketName, true, cloudProject.secretKey);
          setNewBucketName('');
          fetchData();
      } catch(e: any) {
          alert("Bucket creation failed: " + e.message);
      }
  };

  const handleDeleteBucket = async (id: string) => {
       if (!cloudProject?.secretKey || !window.confirm("Delete bucket? This cannot be undone.")) return;
       try {
           await rafieiCloudService.deleteBucket(cloudProject.projectRef, id, cloudProject.secretKey);
           fetchData();
       } catch(e: any) {
           alert("Failed: " + e.message);
       }
  };

  const handleSelectBucket = async (bucketId: string) => {
      if (!cloudProject?.secretKey) return;
      setSelectedBucket(bucketId);
      setTabLoading(true);
      try {
          const files = await rafieiCloudService.listBucketFiles(cloudProject.projectRef, bucketId, cloudProject.secretKey);
          setBucketFiles(files);
      } catch(e) {
          console.error(e);
      } finally {
          setTabLoading(false);
      }
  };

  if (loading) return <div className="h-screen flex items-center justify-center bg-[#0f172a] text-white"><Loader2 className="animate-spin" /></div>;
  if (!project) return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0f172a] text-white gap-4">
          <AlertTriangle size={48} className="text-red-500" />
          <p className="text-lg">{error || "Project not found or not connected to Cloud."}</p>
          <button onClick={() => navigate('/dashboard')} className="px-4 py-2 bg-slate-700 rounded-lg text-sm">Back to Dashboard</button>
      </div>
  );

  // If we have a project but no cloud project (and encountered error), show partial UI or error state
  if (!cloudProject) return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0f172a] text-white gap-4">
          <Cloud size={48} className="text-slate-600" />
          <h2 className="text-xl font-bold">Cloud Not Active</h2>
          <p className="text-slate-400 max-w-md text-center">{error}</p>
          <button onClick={() => navigate(`/project/${projectId}`)} className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-medium">Return to Builder</button>
      </div>
  );

  const tabs: {id: TabId, label: string, icon: React.ReactNode}[] = [
      { id: 'overview', label: t('overview'), icon: <Cloud size={18} /> },
      { id: 'database', label: t('database'), icon: <Database size={18} /> },
      { id: 'auth', label: t('auth'), icon: <Shield size={18} /> },
      { id: 'users', label: t('users'), icon: <Users size={18} /> },
      { id: 'storage', label: t('storage'), icon: <HardDrive size={18} /> },
      { id: 'functions', label: t('functions'), icon: <Zap size={18} /> },
      { id: 'secrets', label: t('secrets'), icon: <Key size={18} /> },
  ];

  return (
    <div className="flex h-screen bg-[#0f172a] text-slate-200 font-sans overflow-hidden" dir={dir}>
        {/* Sidebar */}
        <div className="w-64 bg-[#1e293b] border-r border-slate-700 flex flex-col shrink-0">
            <div className="p-4 border-b border-slate-700 flex items-center gap-2">
                 <button onClick={() => navigate(`/project/${projectId}`)} className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors">
                     <ArrowLeft size={20} />
                 </button>
                 <span className="font-bold text-white truncate">{project.name}</span>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.id ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </nav>
            <div className="p-4 border-t border-slate-700">
                <div className="text-xs text-slate-500 mb-1">{t('instance')}</div>
                <div className="text-xs font-mono text-slate-300 truncate">{cloudProject.projectRef}</div>
                <div className="flex items-center gap-2 mt-2">
                     <div className={`w-2 h-2 rounded-full ${isPaused ? 'bg-yellow-500' : 'bg-emerald-500'}`}></div>
                     <span className="text-xs text-slate-400">{isPaused ? t('paused') : t('active')}</span>
                </div>
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
            <header className="h-16 border-b border-slate-700 bg-[#0f172a] flex items-center justify-between px-8">
                <h2 className="text-xl font-semibold text-white capitalize flex items-center gap-2">
                    {tabs.find(t => t.id === activeTab)?.icon}
                    {tabs.find(t => t.id === activeTab)?.label}
                </h2>
                <div className="flex items-center gap-3">
                     <button onClick={() => fetchData()} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                        <RefreshCw size={18} className={tabLoading ? "animate-spin" : ""} />
                     </button>
                     <a href={`https://supabase.com/dashboard/project/${cloudProject.projectRef}`} target="_blank" rel="noreferrer" className="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-md border border-slate-700 transition-colors">
                        {t('openSupabase')}
                     </a>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-8">
                {tabLoading && !data ? (
                    <div className="flex flex-col items-center justify-center h-64 text-slate-500 gap-3">
                        <Loader2 className="animate-spin text-indigo-500" size={32} />
                        <p>{t('loading')}</p>
                    </div>
                ) : isPaused && activeTab !== 'overview' ? (
                     <div className="flex flex-col items-center justify-center h-64 text-center">
                        <Activity size={48} className="text-yellow-500 mb-4" />
                        <h3 className="text-lg font-bold text-white">Project Paused</h3>
                        <p className="text-slate-400 max-w-md mt-2">The database is currently paused due to inactivity. Go to Overview or use the Supabase dashboard to wake it up.</p>
                     </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center">
                        <AlertTriangle size={48} className="text-red-500 mb-4" />
                        <h3 className="text-lg font-bold text-white">Error Loading Data</h3>
                        <p className="text-slate-400 max-w-md mt-2">{error}</p>
                        <button onClick={fetchData} className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center gap-2">
                            <RefreshCw size={16} /> Retry
                        </button>
                    </div>
                ) : (
                    <div className="max-w-6xl mx-auto space-y-6">
                        {/* OVERVIEW */}
                        {activeTab === 'overview' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <h3 className="text-lg font-medium text-white mb-4">{t('projectHealth')}</h3>
                                    {isPaused ? (
                                        <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-200 flex items-center gap-3">
                                            <AlertTriangle />
                                            <div>
                                                <p className="font-bold">Database Paused</p>
                                                <p className="text-sm opacity-80">Resources are scaled down.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {data && Array.isArray(data) ? data.map((s: any, i: number) => (
                                                <div key={i} className="flex items-center justify-between p-3 bg-slate-900/50 rounded-lg">
                                                    <span className="capitalize text-slate-300">{s.name}</span>
                                                    <span className={`text-xs px-2 py-1 rounded-full ${s.status === 'ACTIVE_HEALTHY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                                        {s.status}
                                                    </span>
                                                </div>
                                            )) : <div className="text-slate-500">No health data.</div>}
                                        </div>
                                    )}
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                    <h3 className="text-lg font-medium text-white mb-4">{t('quickActions')}</h3>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button onClick={() => setActiveTab('database')} className="p-3 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-left transition-colors">
                                            <Database size={20} className="text-indigo-400 mb-2"/>
                                            <div className="font-medium text-sm">{t('queryData')}</div>
                                        </button>
                                        <button onClick={() => setActiveTab('users')} className="p-3 bg-slate-700/50 hover:bg-slate-700 rounded-lg text-left transition-colors">
                                            <Users size={20} className="text-pink-400 mb-2"/>
                                            <div className="font-medium text-sm">{t('manageUsers')}</div>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* DATABASE */}
                        {activeTab === 'database' && (
                            <div className="grid grid-cols-12 gap-6 h-[calc(100vh-12rem)]">
                                <div className="col-span-3 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col">
                                    <div className="p-3 border-b border-slate-700 bg-slate-900/50 font-medium text-sm">{t('tables')}</div>
                                    <div className="flex-1 overflow-y-auto">
                                        {Array.isArray(data) && data.map((t: any) => (
                                            <button 
                                                key={t.name} 
                                                onClick={() => handleTableSelect(t.name)}
                                                className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-slate-700/50 ${selectedTable === t.name ? 'bg-indigo-600/20 text-indigo-300 border-r-2 border-indigo-500' : 'text-slate-300'}`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Table size={14}/> {t.name}
                                                </div>
                                                {t.rls_enabled && <span title="RLS Enabled"><Lock size={12} className="text-emerald-500/70" /></span>}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="p-3 border-t border-slate-700 bg-slate-900/50">
                                        <button onClick={() => setSelectedTable('SQL')} className="w-full bg-slate-700 hover:bg-slate-600 text-white py-1.5 rounded text-xs font-medium transition-colors">
                                            {t('sqlEditor')}
                                        </button>
                                    </div>
                                </div>
                                <div className="col-span-9 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col">
                                    {selectedTable === 'SQL' ? (
                                        <div className="flex-1 flex flex-col p-4">
                                            <h3 className="font-medium text-white mb-2">{t('executeSql')}</h3>
                                            <textarea 
                                                value={sqlQuery}
                                                onChange={e => setSqlQuery(e.target.value)}
                                                className="flex-1 bg-slate-900 font-mono text-sm text-white p-4 rounded-lg border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none mb-4"
                                                placeholder="SELECT * FROM ..."
                                            />
                                            <div className="flex justify-end">
                                                <button onClick={handleExecuteSql} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 font-medium">
                                                    <Play size={16}/> {t('runQuery')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : selectedTable ? (
                                        <div className="flex-1 flex flex-col">
                                            <div className="p-3 border-b border-slate-700 bg-slate-900/30 flex justify-between items-center">
                                                <span className="font-mono text-sm font-bold text-white">{selectedTable}</span>
                                                <span className="text-xs text-slate-500">{tableData.length} {t('rowsFetched')}</span>
                                            </div>
                                            <div className="flex-1 overflow-auto">
                                                <table className="w-full text-xs text-left whitespace-nowrap">
                                                    <thead className="bg-slate-900 text-slate-400 sticky top-0">
                                                        <tr>
                                                            {tableData.length > 0 && Object.keys(tableData[0]).map(key => (
                                                                <th key={key} className="px-4 py-2 border-b border-slate-700 font-medium">{key}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-700/50">
                                                        {tableData.map((row, i) => (
                                                            <tr key={i} className="hover:bg-slate-700/30">
                                                                {Object.values(row).map((val: any, j) => (
                                                                    <td key={j} className="px-4 py-2 text-slate-300 max-w-xs truncate">
                                                                        {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                {tableData.length === 0 && (
                                                    <div className="p-8 text-center text-slate-500">{t('noDataFound')}</div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1 flex items-center justify-center text-slate-500">{t('selectTable')}</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* AUTH */}
                        {activeTab === 'auth' && authConfig && (
                            <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden flex flex-col h-full">
                                <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-lg font-medium text-white">{t('authSettings')}</h3>
                                        <p className="text-slate-400 text-sm mt-1">{t('authSettingsDesc')}</p>
                                    </div>
                                    <button 
                                        onClick={handleSaveAuth}
                                        disabled={!isAuthDirty || isSavingAuth}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                                            isAuthDirty 
                                            ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' 
                                            : 'bg-slate-700 text-slate-400 cursor-not-allowed'
                                        }`}
                                    >
                                        {isSavingAuth ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}
                                        {t('saveChanges')}
                                    </button>
                                </div>
                                <div className="flex-1 overflow-y-auto divide-y divide-slate-700">
                                    {[
                                        { key: 'enable_email_signup', label: t('emailSignup'), desc: t('emailSignupDesc') },
                                        { key: 'enable_confirmations', label: t('emailConfirmations'), desc: t('emailConfirmationsDesc') },
                                        { key: 'enable_anonymous_sign_ins', label: t('anonSignins'), desc: t('anonSigninsDesc') },
                                        { key: 'enable_phone_signup', label: t('phoneSignup'), desc: t('phoneSignupDesc') },
                                    ].map(item => (
                                        <div key={item.key} className="p-4 flex items-center justify-between hover:bg-slate-900/30">
                                            <div>
                                                <div className="font-medium text-slate-200">{item.label}</div>
                                                <div className="text-xs text-slate-500">{item.desc}</div>
                                            </div>
                                            <button 
                                                onClick={() => handleToggleAuth(item.key, authConfig[item.key])}
                                                className={`w-12 h-6 rounded-full transition-colors relative ${authConfig[item.key] ? 'bg-indigo-600' : 'bg-slate-700'}`}
                                            >
                                                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform rtl:rotate-180 ${authConfig[item.key] ? 'left-7' : 'left-1'}`}></div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* USERS */}
                        {activeTab === 'users' && (
                            <div className="space-y-6">
                                <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-3">
                                    <input 
                                        type="email" 
                                        value={newUserEmail} 
                                        onChange={e => setNewUserEmail(e.target.value)}
                                        placeholder="user@example.com"
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <button onClick={handleAddUser} disabled={!newUserEmail} className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                                        {t('inviteUser')}
                                    </button>
                                </div>
                                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-slate-900 text-slate-400 border-b border-slate-700">
                                            <tr>
                                                <th className="p-4">{t('users')}</th>
                                                <th className="p-4">{t('created')}</th>
                                                <th className="p-4">{t('lastSignIn')}</th>
                                                <th className="p-4"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700">
                                            {Array.isArray(data?.users) && data.users.length > 0 ? data.users.map((u: any) => (
                                                <tr key={u.id} className="hover:bg-slate-700/20">
                                                    <td className="p-4">
                                                        <div className="text-white font-medium">{u.email}</div>
                                                        <div className="text-xs text-slate-500 font-mono">{u.id}</div>
                                                    </td>
                                                    <td className="p-4 text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                                                    <td className="p-4 text-slate-400">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}</td>
                                                    <td className="p-4 text-right">
                                                        <button onClick={() => handleDeleteUser(u.id)} className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                                            <Trash2 size={16}/>
                                                        </button>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr><td colSpan={4} className="p-8 text-center text-slate-500">No users found.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* STORAGE */}
                        {activeTab === 'storage' && (
                             <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="col-span-1 space-y-4">
                                        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
                                            <h4 className="text-sm font-medium text-white mb-3">{t('buckets')}</h4>
                                            <div className="space-y-2 mb-4">
                                                {Array.isArray(data) && data.map((b: any) => (
                                                    <div 
                                                        key={b.id} 
                                                        onClick={() => handleSelectBucket(b.id)}
                                                        className={`p-3 rounded-lg flex items-center justify-between cursor-pointer border ${selectedBucket === b.id ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300' : 'bg-slate-900/50 border-slate-700 hover:bg-slate-700/50 text-slate-300'}`}
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <HardDrive size={16}/> <span className="font-medium">{b.name}</span>
                                                        </div>
                                                        {b.public && <span className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded border border-green-500/20">Public</span>}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="pt-3 border-t border-slate-700">
                                                <input 
                                                    type="text" 
                                                    value={newBucketName} 
                                                    onChange={e => setNewBucketName(e.target.value)}
                                                    placeholder="new-bucket-name"
                                                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white mb-2"
                                                />
                                                <button onClick={handleCreateBucket} disabled={!newBucketName} className="w-full bg-slate-700 hover:bg-slate-600 text-white py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">{t('createBucket')}</button>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="col-span-2 bg-slate-800 rounded-xl border border-slate-700 flex flex-col min-h-[400px]">
                                        {selectedBucket ? (
                                            <>
                                                <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-900/30">
                                                    <h4 className="font-medium text-white flex items-center gap-2"><HardDrive size={16}/> {selectedBucket}</h4>
                                                    <button onClick={() => handleDeleteBucket(selectedBucket)} className="text-xs text-red-400 hover:text-red-300 hover:underline">{t('deleteBucket')}</button>
                                                </div>
                                                <div className="flex-1 p-4 overflow-y-auto">
                                                    {bucketFiles.length > 0 ? (
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                                            {bucketFiles.map((f: any) => (
                                                                <div key={f.id} className="group relative aspect-square bg-slate-900 rounded-lg border border-slate-700 flex flex-col items-center justify-center p-2 text-center hover:border-indigo-500 transition-colors">
                                                                    <FileText size={24} className="text-slate-500 mb-2 group-hover:text-indigo-400"/>
                                                                    <span className="text-xs text-slate-300 truncate w-full">{f.name}</span>
                                                                    <div className="text-[10px] text-slate-500 mt-1">{(f.metadata?.size / 1024).toFixed(1)} KB</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                                                            <Cloud size={32} className="opacity-20"/>
                                                            <p>{t('bucketEmpty')}</p>
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                                                <ArrowLeft size={24} className="opacity-50 rtl:rotate-180"/>
                                                <p>{t('selectBucket')}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                             </div>
                        )}

                        {/* OTHER TABS */}
                        {['functions', 'secrets', 'logs'].includes(activeTab) && (
                            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
                                <h3 className="text-lg font-medium text-white mb-4 capitalize">{activeTab}</h3>
                                {activeTab === 'logs' && <p className="text-sm text-slate-400 mb-4">Recent logs from the platform.</p>}
                                <pre className="bg-slate-950 p-4 rounded-lg overflow-x-auto text-xs font-mono text-green-400 border border-slate-800">
                                    {JSON.stringify(data, null, 2)}
                                </pre>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    </div>
  );
};

export default CloudManagementPage;
