import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
type Theme='light'|'dark'|'system';
const key='skill-ui-theme';
const valid=(value:unknown):value is Theme=>['light','dark','system'].includes(String(value));
function savedTheme():Theme {try{const value=localStorage.getItem(key);return valid(value)?value:'light';}catch{return 'light';}}
function apply(theme:Theme){document.documentElement.dataset.theme=theme==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):theme;}
apply(savedTheme());
const ThemeContext=createContext<{theme:Theme;resolvedTheme:'light'|'dark';setTheme:(theme:Theme)=>void}>({theme:'light',resolvedTheme:'light',setTheme:()=>{}});
export function ThemeProvider({children}:{children:ReactNode}) {
 const [theme,setTheme]=useState<Theme>(savedTheme);
 const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(()=>{
  apply(theme);try{localStorage.setItem(key,theme);}catch{/* Theme still works without browser persistence. */}
  const media=matchMedia('(prefers-color-scheme: dark)'),update=()=>{setSystemDark(media.matches);apply(theme);};
  media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
 },[theme]);
 useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===key)setTheme(valid(event.newValue)?event.newValue:'light');};window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed);},[]);
 return <ThemeContext.Provider value={{theme,resolvedTheme:theme==='system'?(systemDark?'dark':'light'):theme,setTheme}}>{children}</ThemeContext.Provider>;
}
export function ThemeSwitcher(){
 const {resolvedTheme,setTheme}=useContext(ThemeContext),dark=resolvedTheme==='dark',Icon=dark?Moon:Sun;
 const action=dark?'Switch to light theme':'Switch to dark theme';
 return <button type="button" className="theme-switcher theme-toggle" aria-label={action} title={action} onClick={()=>setTheme(dark?'light':'dark')}><Icon size={20} aria-hidden="true"/></button>;
}
