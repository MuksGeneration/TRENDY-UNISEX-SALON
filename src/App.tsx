/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { apiFetch, getSalonSessionToken, setSalonSessionToken } from './lib/api';
import {
  connectGoogleWorkspace,
  disconnectGoogleWorkspace,
  getGoogleAccessToken,
  initGoogleWorkspaceAuth,
} from './lib/firebaseAuth';
import { SidebarLayout } from './components/SidebarLayout';
import { OfflineIndicator, PWAInstallPromptBanner } from './components/PWAInstallButton';
import type { NavSection, SalonBranding, SessionUser } from './types';

import { LoginView } from './components/LoginView';
const DashboardView = lazy(() =>
  import('./views/DashboardView').then((m) => ({ default: m.DashboardView }))
);
const AppointmentsView = lazy(() =>
  import('./views/AppointmentsView').then((m) => ({ default: m.AppointmentsView }))
);
const PosBillingView = lazy(() =>
  import('./views/PosBillingView').then((m) => ({ default: m.PosBillingView }))
);
const CustomersView = lazy(() =>
  import('./views/CustomersView').then((m) => ({ default: m.CustomersView }))
);
const EmployeesSchedulingView = lazy(() =>
  import('./views/EmployeesSchedulingView').then((m) => ({ default: m.EmployeesSchedulingView }))
);
const ServicesView = lazy(() =>
  import('./views/ServicesView').then((m) => ({ default: m.ServicesView }))
);
const CommissionsView = lazy(() =>
  import('./views/CommissionsView').then((m) => ({ default: m.CommissionsView }))
);
const ExpensesInventoryView = lazy(() =>
  import('./views/ExpensesInventoryView').then((m) => ({ default: m.ExpensesInventoryView }))
);
const GiftCardsView = lazy(() =>
  import('./views/GiftCardsView').then((m) => ({ default: m.GiftCardsView }))
);
const ReportsView = lazy(() =>
  import('./views/ReportsView').then((m) => ({ default: m.ReportsView }))
);
const AiAssistantView = lazy(() =>
  import('./views/AiAssistantView').then((m) => ({ default: m.AiAssistantView }))
);
const AdminViews = lazy(() =>
  import('./views/AdminViews').then((m) => ({ default: m.AdminViews }))
);
const ClientBookingView = lazy(() =>
  import('./views/ClientBookingView').then((m) => ({ default: m.ClientBookingView }))
);

const DEFAULT_BRANDING: SalonBranding = {
  businessName: 'Trendy Unisex Salon',
  tagline: 'Where Beauty Meets Style',
  audienceTagline: 'For Him · For Her · For Everyone',
  location: "Busia District Road, near ASA Microfinance, Madibira 'A', Uganda",
  phone: '0740301726',
  socialHandle: '@Trendyunisex.salon',
  socialPlatforms: ['TikTok', 'Instagram', 'Facebook'],
  walkInsWelcome: true,
  promotionalBannerUrl: '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg',
  backgroundImageUrl:
    '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg',
  salonLogoUrl: '',
};

const ViewLoader: React.FC<{ fullScreen?: boolean; label?: string }> = ({
  fullScreen = false,
  label = 'Loading content...',
}) => (
  <div
    className={
      fullScreen
        ? 'min-h-screen bg-[#F8EEEB] flex items-center justify-center p-6'
        : 'min-h-[45vh] flex items-center justify-center p-6'
    }
  >
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-[#1D1717]/10 shadow-xs text-xs font-semibold text-[#1D1717]/75">
      <span className="w-3.5 h-3.5 rounded-full border-2 border-[#E83B84] border-t-transparent animate-spin" />
      <span>{label}</span>
    </div>
  </div>
);

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void; onSignOut: () => void },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unexpected rendering error.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-red-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <h2 className="text-base font-bold text-[#1D1717]">Unable to load this view</h2>
            <p className="text-xs text-[#1D1717]/70 leading-relaxed">{this.state.message}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  this.props.onReset();
                }}
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold hover:bg-[#d12d73] cursor-pointer"
              >
                Retry Dashboard
              </button>
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  this.props.onSignOut();
                }}
                className="px-4 py-2 rounded-xl bg-white border border-[#1D1717]/15 text-xs font-semibold text-[#1D1717] hover:bg-[#F8EEEB] cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(() => Boolean(getSalonSessionToken()));
  const [showClientBooking, setShowClientBooking] = useState(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return params.get('view') === 'booking' || params.get('book') === '1';
  });
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [googleConnected, setGoogleConnected] = useState(false);
  const [cloudWorkspaceConnected, setCloudWorkspaceConnected] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [branding, setBranding] = useState<SalonBranding>(DEFAULT_BRANDING);
  const [posPrefill, setPosPrefill] = useState<{
    customerId: string;
    customerName: string;
    appointmentId?: string;
    walkInId?: string;
    serviceIds: string[];
    employeeId?: string;
  } | null>(null);

  const refreshBranding = async () => {
    try {
      const res = await apiFetch<SalonBranding>('/api/branding');
      setBranding(res);
    } catch {
      // Keep default branding
    }
  };

  const refreshWorkspaceHealth = async () => {
    try {
      const health = await apiFetch<{
        sheetsDatabaseLinked?: boolean;
        driveStorageLinked?: boolean;
      }>('/api/health');
      setCloudWorkspaceConnected(Boolean(health.sheetsDatabaseLinked || health.driveStorageLinked));
    } catch {
      // Ignore health check failures
    }
  };

  const refreshNotifications = async () => {
    try {
      const res = await apiFetch<{ notifications: Array<{ read: boolean }> }>('/api/notifications');
      setUnreadNotifications(res.notifications.filter((n) => !n.read).length);
    } catch {
      // Ignore when unauthenticated
    }
  };

  const refreshCurrentUser = async () => {
    try {
      const res = await apiFetch<{ user: SessionUser }>('/api/auth/me');
      setUser(res.user);
    } catch {
      // Keep existing session user if refresh fails
    }
  };

  useEffect(() => {
    const unsub = initGoogleWorkspaceAuth(
      () => setGoogleConnected(true),
      () => setGoogleConnected(false)
    );
    (async () => {
      void refreshBranding();
      void refreshWorkspaceHealth();
      try {
        const res = await apiFetch<{ user: SessionUser }>('/api/auth/me');
        setUser(res.user);
        setGoogleConnected(Boolean(getGoogleAccessToken()));
        void refreshNotifications();
      } catch {
        setUser(null);
      } finally {
        setCheckingSession(false);
      }
    })();
    return () => unsub();
  }, []);

  const handleConnectGoogle = async () => {
    setWorkspaceError('');
    try {
      await connectGoogleWorkspace();
      setGoogleConnected(true);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not connect Google Workspace. Try using the Apps Script Bridge in Settings → Google Workspace.';
      setWorkspaceError(message);
      throw err;
    }
  };

  const handleHeaderWorkspaceAction = async () => {
    if (cloudWorkspaceConnected && user && ['owner', 'manager'].includes(user.role)) {
      setActiveSection('settings');
      return;
    }
    try {
      await handleConnectGoogle();
    } catch {
      // Error already surfaced via workspaceError banner
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    await disconnectGoogleWorkspace();
    setSalonSessionToken(null);
    setUser(null);
    setGoogleConnected(false);
    setWorkspaceError('');
    setActiveSection('dashboard');
  };

  if (checkingSession) {
    return <ViewLoader fullScreen label="Loading Trendy Unisex Salon..." />;
  }

  if (!user) {
    if (showClientBooking) {
      return (
        <AppErrorBoundary
          onReset={() => setShowClientBooking(false)}
          onSignOut={() => setShowClientBooking(false)}
        >
          <Suspense fallback={<ViewLoader fullScreen label="Loading booking portal..." />}>
            <ClientBookingView
              standalone
              branding={branding}
              onBackToLogin={() => {
                setShowClientBooking(false);
                if (typeof window !== 'undefined' && window.location.search) {
                  const url = new URL(window.location.href);
                  url.searchParams.delete('view');
                  url.searchParams.delete('book');
                  window.history.replaceState({}, '', url.toString());
                }
              }}
            />
          </Suspense>
          <PWAInstallPromptBanner />
          <OfflineIndicator />
        </AppErrorBoundary>
      );
    }
    return (
      <AppErrorBoundary
        onReset={() => window.location.reload()}
        onSignOut={() => void handleLogout()}
      >
        <LoginView
          branding={branding}
          onOpenClientBooking={() => setShowClientBooking(true)}
          onSuccess={(loggedInUser, isGoogle) => {
            setUser(loggedInUser);
            if (isGoogle) setGoogleConnected(true);
            setActiveSection('dashboard');
            void refreshWorkspaceHealth();
            void refreshNotifications();
          }}
        />
        <PWAInstallPromptBanner />
        <OfflineIndicator />
      </AppErrorBoundary>
    );
  }

  const effectiveWorkspaceConnected = googleConnected || cloudWorkspaceConnected;

  return (
    <AppErrorBoundary
      onReset={() => setActiveSection('dashboard')}
      onSignOut={() => void handleLogout()}
    >
      <SidebarLayout
        user={user}
        branding={branding}
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        unreadNotifications={unreadNotifications}
        googleConnected={effectiveWorkspaceConnected}
        onConnectGoogle={() => void handleHeaderWorkspaceAction()}
        onLogout={handleLogout}
      >
        {workspaceError && (
          <div className="mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs flex items-start justify-between gap-3">
            <div className="leading-relaxed">
              <strong>Google Workspace Notice:</strong> {workspaceError}
            </div>
            <button
              type="button"
              onClick={() => setWorkspaceError('')}
              className="px-2 py-0.5 rounded border border-amber-300 bg-white hover:bg-amber-100 font-semibold shrink-0 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
        <AppErrorBoundary
          onReset={() => setActiveSection('dashboard')}
          onSignOut={() => void handleLogout()}
        >
          <Suspense fallback={<ViewLoader label="Loading section..." />}>
            {activeSection === 'dashboard' && (
              <DashboardView user={user} branding={branding} onNavigate={setActiveSection} />
            )}
            {activeSection === 'appointments' && (
              <AppointmentsView
                user={user}
                branding={branding}
                onCheckoutAppointment={(payload) => {
                  setPosPrefill(payload);
                  setActiveSection('pos');
                }}
              />
            )}
            {activeSection === 'pos' && (
              <PosBillingView
                user={user}
                branding={branding}
                prefill={posPrefill}
                onClearPrefill={() => setPosPrefill(null)}
              />
            )}
            {activeSection === 'customers' && <CustomersView user={user} />}
            {(activeSection === 'employees' ||
              activeSection === 'scheduling' ||
              activeSection === 'attendance') && (
              <EmployeesSchedulingView
                mode={activeSection}
                user={user}
                googleConnected={effectiveWorkspaceConnected}
                onConnectGoogle={handleHeaderWorkspaceAction}
                onProfileSaved={() => void refreshCurrentUser()}
              />
            )}
            {activeSection === 'services' && <ServicesView user={user} branding={branding} />}
            {(activeSection === 'commissions' ||
              activeSection === 'payments' ||
              activeSection === 'lunch') && (
              <CommissionsView mode={activeSection} user={user} />
            )}
            {(activeSection === 'expenses' || activeSection === 'inventory') && (
              <ExpensesInventoryView mode={activeSection} user={user} />
            )}
            {activeSection === 'gift-cards' && <GiftCardsView user={user} />}
            {activeSection === 'reports' && <ReportsView user={user} />}
            {activeSection === 'ai-assistant' && <AiAssistantView user={user} />}
            {(activeSection === 'notifications' ||
              activeSection === 'users' ||
              activeSection === 'settings' ||
              activeSection === 'audit-logs') && (
              <AdminViews
                mode={activeSection}
                user={user}
                googleConnected={googleConnected}
                onConnectGoogle={handleConnectGoogle}
                onRefreshNotifications={() => void refreshNotifications()}
                onBrandingUpdated={() => void refreshBranding()}
                onWorkspaceUpdated={() => void refreshWorkspaceHealth()}
              />
            )}
          </Suspense>
        </AppErrorBoundary>
        <PWAInstallPromptBanner />
        <OfflineIndicator />
      </SidebarLayout>
    </AppErrorBoundary>
  );
}
