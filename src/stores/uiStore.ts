import {create} from 'zustand';
export type Theme='dark'|'light';
const THEME_KEY='hd2lab_film_studio_theme';
/** Shared HD2Lab key: every HD2Lab surface keeps its Light/Dark choice here. */
export const SHARED_THEME_KEY='hd2-theme';

function stored(storage:Storage,key:string):Theme|null{
  try{const value=storage.getItem(key);return value==='light'||value==='dark'?value:null;}catch{return null;}
}
/** The app's own choice wins, then the shared HD2Lab choice, then Soft Iris Light. */
function savedTheme():Theme{
  try{
    return stored(localStorage,THEME_KEY)??stored(localStorage,SHARED_THEME_KEY)??'light';
  }catch{return'light';}
}
export function applyTheme(theme:Theme){
  document.documentElement.dataset.theme=theme;
  document.documentElement.classList.toggle('dark',theme==='dark');
  document.documentElement.style.colorScheme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0B1020':'#FAFAFD');
}
interface UIState{theme:Theme;setTheme:(theme:Theme)=>void;isOpenDialog:boolean;setOpenDialog:(open:boolean)=>void;leftCollapsed:boolean;rightCollapsed:boolean;toggleLeft:()=>void;toggleRight:()=>void;}
export const useUIStore=create<UIState>((set,get)=>({theme:savedTheme(),setTheme:theme=>{applyTheme(theme);try{localStorage.setItem(THEME_KEY,theme);localStorage.setItem(SHARED_THEME_KEY,theme);}catch{/* Storage may be unavailable; current session still works. */}set({theme});},isOpenDialog:false,setOpenDialog:isOpenDialog=>set({isOpenDialog}),leftCollapsed:false,rightCollapsed:false,toggleLeft:()=>set({leftCollapsed:!get().leftCollapsed}),toggleRight:()=>set({rightCollapsed:!get().rightCollapsed})}));
export function openPhotoChooser(direct:()=>void){if(window.matchMedia('(min-width: 1280px)').matches)useUIStore.getState().setOpenDialog(true);else direct();}
