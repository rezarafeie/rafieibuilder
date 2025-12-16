
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Plus, Loader2, AlertTriangle, Paperclip, X, Image as ImageIcon } from 'lucide-react';
import { fileToBase64 } from '../services/cloudService';

interface ImageUpload {
  id: string;
  file: File;
  previewUrl: string;
  base64: string;
  error?: boolean;
}

interface PromptInputBoxProps {
  onSendMessage: (content: string, images: { url: string; base64: string }[]) => void;
  isThinking: boolean;
  onInteraction?: () => void;
}

const PromptInputBox: React.FC<PromptInputBoxProps> = ({ onSendMessage, isThinking, onInteraction }) => {
  const [input, setInput] = useState('');
  const [stagedImages, setStagedImages] = useState<ImageUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Auto-resize textarea
    if (textAreaRef.current) {
        textAreaRef.current.style.height = 'auto';
        textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const handleFileValidation = (file: File): boolean => {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const maxSize = 10 * 1024 * 1024; // 10 MB
      if (!allowedTypes.includes(file.type)) {
          alert('Invalid file type. Please upload PNG, JPG, or WebP.');
          return false;
      }
      if (file.size > maxSize) {
          alert('File is too large. Maximum size is 10MB.');
          return false;
      }
      return true;
  };

  const addFilesToStage = async (files: File[]) => {
      onInteraction?.();
      const validFiles = Array.from(files).filter(handleFileValidation);
      if (validFiles.length === 0) return;

      const newUploadsPromises = validFiles.map(async file => {
          const base64 = await fileToBase64(file);
          return {
              id: crypto.randomUUID(),
              file,
              previewUrl: URL.createObjectURL(file),
              base64: base64.split(',')[1], // Send only the base64 part
          };
      });
      
      const newUploads = await Promise.all(newUploadsPromises);
      setStagedImages(prev => [...prev, ...newUploads]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) addFilesToStage(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
  };
  
  const removeStagedImage = (id: string) => {
      setStagedImages(prev => prev.filter(img => img.id !== id));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if ((input.trim() || stagedImages.length > 0) && !isThinking) {
      const validImages = stagedImages
        .filter(img => !img.error && img.base64)
        .map(img => ({ url: img.previewUrl, base64: img.base64! }));

      onSendMessage(input.trim(), validImages);
      setInput('');
      setStagedImages([]);
    }
  };
  
  const dropHandler = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setIsDragging(false);
    if (ev.dataTransfer.files) addFilesToStage(Array.from(ev.dataTransfer.files));
  }, []);
  
  const dragOverHandler = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setIsDragging(true);
  };
  
  const dragLeaveHandler = () => setIsDragging(false);

  return (
    <div 
        className={`relative transition-all duration-300 ${isDragging ? 'scale-105' : ''}`}
        onDrop={dropHandler} 
        onDragOver={dragOverHandler} 
        onDragLeave={dragLeaveHandler}
    >
        {isDragging && (
            <div className="absolute inset-0 bg-slate-100/90 dark:bg-slate-800/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center pointer-events-none border-2 border-dashed border-indigo-500 rounded-3xl">
                <ImageIcon size={40} className="text-indigo-500 dark:text-indigo-300 mb-2" />
                <p className="font-semibold text-slate-800 dark:text-white">Drop images to attach</p>
            </div>
        )}
        <form onSubmit={handleSubmit} className="relative group bg-white/80 dark:bg-slate-900/70 backdrop-blur-xl rounded-2xl border border-slate-200 dark:border-slate-700/50 shadow-2xl shadow-slate-200/50 dark:shadow-black/30 transition-colors duration-300">
          {stagedImages.length > 0 && (
            <div className="p-3 border-b border-slate-200 dark:border-slate-700/50">
                <div className="flex gap-3 overflow-x-auto">
                    {stagedImages.map((img) => (
                        <div key={img.id} className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-slate-300 dark:border-slate-600 group/img">
                            <img src={img.previewUrl} className="w-full h-full object-cover" alt="preview" />
                            <button type="button" onClick={() => removeStagedImage(img.id)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-red-500 transition-colors opacity-0 group-hover/img:opacity-100">
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
          )}
          <div className="flex p-2 items-start">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors shrink-0"><Plus size={20} /></button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/png, image/jpeg, image/webp" multiple className="hidden" />
            <textarea
                ref={textAreaRef}
                rows={1}
                value={input} 
                onChange={(e) => setInput(e.target.value)} 
                onFocus={onInteraction}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSubmit(e);
                    }
                }}
                placeholder="Hi" 
                disabled={isThinking} 
                className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none py-3 resize-none max-h-40 leading-relaxed" 
            />
            <div className="p-1 self-end">
                <button 
                    type="submit" 
                    disabled={(!input.trim() && stagedImages.length === 0) || isThinking}
                    className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md"
                    aria-label="Send prompt"
                >
                    {isThinking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="-rotate-45 -translate-x-px translate-y-px" />}
                </button>
            </div>
          </div>
        </form>
    </div>
  );
};
export default PromptInputBox;
