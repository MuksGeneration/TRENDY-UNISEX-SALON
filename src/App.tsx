/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useState } from 'react';
import { apiFetch, setSalonSessionToken } from './lib/api';
import {
  connectGoogleWorkspace,
  disconnectGoogleWorkspace,
  getGoogleAccessToken,
  initGoogleWorkspaceAuth,
} from './lib/firebaseAuth';
import { LoginView } from './components/LoginView';
import { SidebarLayout } from './components/SidebarLayout';
import { DashboardView } from './views/DashboardView';
import { AppointmentsView } from './views/AppointmentsView';
import { PosBillingView } from './views/PosBillingView';
import { CustomersView } from './views/CustomersView';
import { EmployeesSchedulingView } from './views/EmployeesSchedulingView';
import { ServicesView } from './views/ServicesView';
import { CommissionsView } from './views/CommissionsView';
import { ExpensesInventoryView } from './views/ExpensesInventoryView';
import { GiftCardsView } from './views/GiftCardsView';
import { ReportsView } from './views/ReportsView';
import { AiAssistantView } from './views/AiAssistantView';
import { AdminViews } from './views/AdminViews';
import { ClientBookingView } from './views/ClientBookingView';
import type { NavSection, SalonBranding, SessionUser } from './types';

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
  backgroundImageUrl: '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg',
  salonLogoUrl: '',
};

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
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
        await refreshNotifications();
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
    return (
      <div className="min-h-screen bg-[#F8EEEB] flex items-center justify-center">
        <div className="text-sm font-semibold text-[#1D1717]/70">
          Loading Trendy Unisex Salon...
        </div>
      </div>
    );
  }

  if (!user) {
    if (showClientBooking) {
      return (
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
      );
    }
    return (
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
    );
  }

  const effectiveWorkspaceConnected = googleConnected || cloudWorkspaceConnected;

  return (
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
      {activeSection === 'dashboard' && (
        <DashboardView user={user} onNavigate={setActiveSection} />
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
    </SidebarLayout>
  );
}
