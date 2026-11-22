import React, { useState } from 'react';
import { Download, ExternalLink, Share, Smartphone, Monitor, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'sidebar' | 'login';
}

const PWAInstallGuideModal: React.FC<{
  open: boolean;
  onClose: () => void;
  isIOS: boolean;
  isInIframe: boolean;
}> = ({ open, onClose, isIOS, isInIframe }) => {
  if (!open) return null;

  return (
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
            onClick={onClose}
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
            onClick={onClose}
            className="w-full py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-xs font-semibold text-[#1D1717] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
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

      <PWAInstallGuideModal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        isIOS={isIOS}
        isInIframe={isInIframe}
      />
    </>
  );
};

const DISMISS_KEY = 'trendy_pwa_banner_dismissed';

export const PWAInstallPromptBanner: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, isAndroid, isDesktop, isInIframe, install } =
    usePWAInstall();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  });
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled || dismissed || (!isInstallable && !isAndroid && !isDesktop)) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1');
    }
  };

  const handleInstallAction = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) {
        setDismissed(true);
      }
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      {isInstallable ? (
        <div
          className="fixed bottom-4 right-4 z-40 max-w-xs w-[calc(100vw-2rem)] bg-white border border-[#E83B84]/35 rounded-2xl shadow-xl p-3.5 flex items-start gap-3 no-print"
          role="region"
          aria-label="Install app banner"
        >
          <div className="w-10 h-10 rounded-xl bg-[#1D1717] text-[#F3BFD3] flex items-center justify-center shrink-0">
            {isAndroid ? <Smartphone className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-bold text-[#1D1717]">Install Trendy Salon App</div>
              <button
                type="button"
                onClick={handleDismiss}
                className="p-0.5 rounded text-[#1D1717]/45 hover:text-[#1D1717] cursor-pointer"
                aria-label="Dismiss install prompt"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-[#1D1717]/65 mt-0.5 leading-snug">
              {isAndroid
                ? 'Add to your Android home screen for instant launch.'
                : 'Install on your desktop for one-click access and faster loading.'}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleInstallAction()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#E83B84] hover:bg-[#d12d73] text-white text-[11px] font-semibold cursor-pointer"
              >
                <Download className="w-3 h-3" /> Install App
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[#1D1717]/65 hover:bg-[#F8EEEB] cursor-pointer"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-1 rounded-full bg-[#1D1717] text-white shadow-lg border border-white/15 pl-3 pr-1.5 py-1.5 no-print">
          <button
            type="button"
            onClick={() => void handleInstallAction()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold hover:text-[#F3BFD3] transition-colors cursor-pointer"
            title="Install Trendy Unisex Salon as an app"
          >
            <Download className="w-3.5 h-3.5 text-[#E83B84]" />
            <span>Install App</span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="p-1 rounded-full hover:bg-white/15 text-white/70 hover:text-white cursor-pointer"
            aria-label="Dismiss install button"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <PWAInstallGuideModal
        open={showGuide}
        onClose={() => setShowGuide(false)}
        isIOS={isIOS}
        isInIframe={isInIframe}
      />
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl bg-[#1D1717] border border-[#E83B84]/50 px-3.5 py-2 text-xs font-semibold text-white shadow-lg no-print">
      <WifiOff className="w-3.5 h-3.5 text-[#E83B84]" />
      <span>Offline Mode — Reconnect to load and save live salon updates.</span>
    </div>
  );
};
