import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

// Register Service Worker immediately for 100% offline functionality
registerSW({
  immediate: true,
  onNeedRefresh() {
    console.log('[PWA] New content available, auto-updating...');
  },
  onOfflineReady() {
    console.log('[PWA] Application shell and assets cached. Ready to work completely offline!');
  },
});

createRoot(document.getElementById('root')!).render(<App />);

