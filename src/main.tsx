import {applyTheme,useUIStore,SHARED_THEME_KEY} from './stores/uiStore';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

applyTheme(useUIStore.getState().theme);

// Another HD2Lab surface changed the shared theme: follow it here.
window.addEventListener('storage',event=>{
  if(event.key!==SHARED_THEME_KEY)return;
  if(event.newValue==='light'||event.newValue==='dark')useUIStore.getState().setTheme(event.newValue);
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
