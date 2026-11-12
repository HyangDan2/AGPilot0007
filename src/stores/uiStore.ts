import {create} from 'zustand';
export type Theme='dark'|'light';
const THEME_KEY='hd2lab_film_studio_theme';
function savedTheme():Theme{try{return localStorage.getItem(THEME_KEY)==='light'?'light':'dark';}catch{return'dark';}}
export function applyTheme(theme:Theme){document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.colorScheme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='light'?'#f4f6f9':'#101110');}
interface UIState{theme:Theme;setTheme:(theme:Theme)=>void;isOpenDialog:boolean;setOpenDialog:(open:boolean)=>void;leftCollapsed:boolean;rightCollapsed:boolean;toggleLeft:()=>void;toggleRight:()=>void;}
export const useUIStore=create<UIState>((set,get)=>({theme:savedTheme(),setTheme:theme=>{applyTheme(theme);try{localStorage.setItem(THEME_KEY,theme);}catch{/* Storage may be unavailable; current session still works. */}set({theme});},isOpenDialog:false,setOpenDialog:isOpenDialog=>set({isOpenDialog}),leftCollapsed:false,rightCollapsed:false,toggleLeft:()=>set({leftCollapsed:!get().leftCollapsed}),toggleRight:()=>set({rightCollapsed:!get().rightCollapsed})}));
export function openPhotoChooser(direct:()=>void){if(window.matchMedia('(min-width: 1280px)').matches)useUIStore.getState().setOpenDialog(true);else direct();}
