import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
type Theme='light'|'dark'|'system';
const key='skill-ui-theme';
const valid=(value:unknown):value is Theme=>['light','dark','system'].includes(String(value));
function savedTheme():Theme {try{const value=localStorage.getItem(key);return valid(value)?value:'system';}catch{return 'system';}}
function apply(theme:Theme){document.documentElement.dataset.theme=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;}
apply(savedTheme());
const ThemeContext=createContext<{theme:Theme;setTheme:(theme:Theme)=>void}>({theme:'system',setTheme:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}) {
 const [theme,setTheme]=useState<Theme>(savedTheme);
 useEffect(()=>{
  apply(theme);try{localStorage.setItem(key,theme);}catch{/* Theme still works without browser persistence. */}
  const media=matchMedia('(prefers-color-scheme: dark)'),update=()=>apply(theme);
  media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
 },[theme]);
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===key)setTheme(valid(event.newValue)?event.newValue:'system');};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 return <ThemeContext.Provider value={{theme,setTheme}}>{children}</ThemeContext.Provider>;
}
export function ThemeSwitcher(){const {theme,setTheme}=useContext(ThemeContext),id=useId(),Icon=theme==='dark'?Moon:theme==='light'?Sun:Monitor;return <label className="theme-switcher" htmlFor={id}><Icon size={16} aria-hidden="true"/><span>Theme</span><select aria-label="Theme" id={id} value={theme} onChange={event=>{if(valid(event.target.value))setTheme(event.target.value);}}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;}
