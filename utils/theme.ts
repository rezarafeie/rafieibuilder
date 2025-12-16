
import { useState, useEffect } from 'react';

export type Theme = 'dark' | 'light';

const listeners = new Set<(theme: Theme) => void>();

// Determine initial theme
const getInitialTheme = (): Theme => {
    if (typeof window === 'undefined') return 'dark';
    
    const saved = localStorage.getItem('theme') as Theme;
    if (saved) return saved;
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    
    return 'light'; 
};

let currentTheme: Theme = getInitialTheme();

// Apply theme to document
const applyTheme = (theme: Theme) => {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
};

// Initial apply
applyTheme(currentTheme);

export const setTheme = (theme: Theme) => {
  currentTheme = theme;
  localStorage.setItem('theme', theme);
  applyTheme(theme);
  listeners.forEach(l => l(theme));
};

export const useTheme = () => {
  const [theme, _setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    const handler = (t: Theme) => _setTheme(t);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggleTheme, setTheme };
};
