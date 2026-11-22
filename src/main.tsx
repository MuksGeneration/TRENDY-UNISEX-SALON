import React from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

const CHUNK_RELOAD_KEY = 'trendy_chunk_reload_at';

function triggerOneTimeChunkReload() {
  if (typeof window === 'undefined') return;
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0');
  if (Date.now() - last > 15_000) {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    triggerOneTimeChunkReload();
  });
}

class RootErrorBoundary extends React.Component<
  {children: React.ReactNode},
  {hasError: boolean; message: string}
> {
  state = {hasError: false, message: ''};

  static getDerivedStateFromError(error: Error) {
    const msg = error?.message || 'Unexpected application error.';
    if (
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('Loading chunk')
    ) {
      triggerOneTimeChunkReload();
    }
    return {hasError: true, message: msg};
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8EEEB] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h2 className="text-base font-bold text-[#1D1717]">Unable to load Trendy Unisex Salon</h2>
            <p className="text-xs text-[#1D1717]/70 leading-relaxed">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold hover:bg-[#d12d73] cursor-pointer"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

registerSW({immediate: true});

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <App />
  </RootErrorBoundary>
);
