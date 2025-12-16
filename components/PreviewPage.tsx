
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { cloudService } from '../services/cloudService';
import { Project } from '../types';
import { constructFullDocument } from '../utils/codeGenerator';
import { Loader2, AlertTriangle, Trash2 } from 'lucide-react';

const PreviewPage: React.FC = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const [project, setProject] = useState<Project | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            if (!projectId) return;
            try {
                // Fetch project data (RLS will enforce access)
                const p = await cloudService.getProject(projectId);
                if (p) {
                    setProject(p);
                } else {
                    setError("Project not found or you don't have access.");
                }
            } catch (e) {
                setError("Failed to load project.");
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [projectId]);

    if (loading) {
        return (
            <div className="h-screen w-full bg-[#0f172a] flex items-center justify-center text-indigo-500">
                <Loader2 className="animate-spin" size={48} />
            </div>
        );
    }

    if (error || !project) {
        return (
            <div className="h-screen w-full bg-[#0f172a] flex flex-col items-center justify-center text-slate-400 gap-4">
                <AlertTriangle size={48} className="text-red-400" />
                <p className="text-lg font-medium">{error || "Project not found"}</p>
            </div>
        );
    }
    
    if (project.deletedAt) {
         return (
            <div className="h-screen w-full bg-[#0f172a] flex flex-col items-center justify-center text-slate-400 gap-4">
                <Trash2 size={48} className="text-red-400" />
                <h1 className="text-xl font-semibold text-white">Project Unavailable</h1>
                <p className="text-sm">This project is in the trash.</p>
            </div>
        );
    }

    // Pass projectId to allow the router shim to detect context, AND files for virtual fs
    const srcDoc = constructFullDocument(project.code, projectId, project.files);

    return (
        <iframe 
            srcDoc={srcDoc}
            className="fixed inset-0 w-full h-full border-none m-0 p-0 bg-white z-50"
            title="Full Preview"
            sandbox="allow-scripts allow-modals allow-same-origin allow-forms allow-popups"
        />
    );
};

export default PreviewPage;
