import {applyTheme,useUIStore} from './stores/uiStore';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

applyTheme(useUIStore.getState().theme);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
