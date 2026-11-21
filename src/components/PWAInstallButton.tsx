import React, { useState } from 'react';
import { Download, ExternalLink, Share, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'login';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        // User dismissed native prompt; keep button available
      }
      return;
    }
    setShowGuide(true);
  };

  const buttonClass =
    variant === 'sidebar'
      ? 'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#E83B84]/35 bg-[#F3BFD3]/25 hover:bg-[#F3BFD3]/45 text-xs font-semibold text-[#1D1717] transition-colors cursor-pointer'
      : variant === 'login'
        ? 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-[#1D1717] text-xs font-semibold transition-colors cursor-pointer'
        : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E83B84]/35 bg-[#F3BFD3]/30 hover:bg-[#F3BFD3]/55 text-[#1D1717] text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer';

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className={buttonClass}
        title="Install Trendy Unisex Salon as an app on your phone or computer"
      >
        <Download className="w-3.5 h-3.5 text-[#E83B84] shrink-0" />
        <span>{isIOS ? 'Install App (iOS)' : 'Install App'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1D1717]/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Install Trendy Unisex Salon app"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white border border-[#1D1717]/15 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-[#1D1717] text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#E83B84] flex items-center justify-center">
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Install Trendy Salon App</h3>
                  <p className="text-[11px] text-[#F3BFD3]">Fast home-screen &amp; desktop access</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
                aria-label="Close install instructions"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs text-[#1D1717]/80 leading-relaxed">
              {isIOS ? (
                <div className="space-y-2.5">
                  <p className="font-semibold text-[#1D1717]">Install on iPhone or iPad (Safari):</p>
                  <ol className="list-decimal list-inside space-y-1.5 bg-[#F8EEEB] rounded-xl p-3">
                    <li>
                      Tap the <Share className="w-3.5 h-3.5 inline text-[#E83B84] mx-0.5" />{' '}
                      <strong>Share</strong> button in your Safari toolbar.
                    </li>
                    <li>
                      Scroll down and tap <strong>Add to Home Screen</strong>.
                    </li>
                    <li>
                      Tap <strong>Add</strong> to launch Trendy Salon like a native app.
                    </li>
                  </ol>
                </div>
              ) : isInIframe ? (
                <div className="space-y-2.5">
                  <p>
                    Your browser is currently viewing this app inside an embedded preview frame. To install with one click:
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 bg-[#F8EEEB] rounded-xl p-3">
                    <li>Open the app directly in its own browser tab.</li>
                    <li>
                      Click <strong>Install App</strong> or select <strong>Install Trendy Salon</strong> from your browser&apos;s address bar / menu.
                    </li>
                  </ol>
                  <a
                    href={typeof window !== 'undefined' ? window.location.href : '/'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white font-semibold"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open in Full Tab to Install
                  </a>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="font-semibold text-[#1D1717]">Install via your browser:</p>
                  <ol className="list-decimal list-inside space-y-1.5 bg-[#F8EEEB] rounded-xl p-3">
                    <li>
                      <strong>Chrome / Edge (Desktop):</strong> Click the{' '}
                      <strong>Install</strong> icon in the right side of the address bar, or open the browser menu (&vellip;) &rarr; <strong>Save and share</strong> / <strong>Install Trendy Salon</strong>.
                    </li>
                    <li>
                      <strong>Android (Chrome):</strong> Tap the browser menu (&vellip;) &rarr; <strong>Add to Home screen</strong> / <strong>Install app</strong>.
                    </li>
                  </ol>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="w-full py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-xs font-semibold text-[#1D1717] cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-[#1D1717] border border-[#E83B84]/50 px-3.5 py-2 text-xs font-semibold text-white shadow-lg no-print">
      <WifiOff className="w-3.5 h-3.5 text-[#E83B84]" />
      <span>Offline Mode — Cached shell active. Reconnect to sync changes.</span>
    </div>
  );
};
