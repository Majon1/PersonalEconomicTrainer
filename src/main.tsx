import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Installable app: the service worker caches the app so it opens offline.
// Browsers only allow it on https or localhost.
if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
