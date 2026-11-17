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
import type { NavSection, SalonBranding, SessionUser } from './types';

const DEFAULT_BRANDING: SalonBranding = {
  businessName: 'Trendy Unisex Salon',
  tagline: 'Where Beauty Meets Style',
  location: "Busia District Road, Madibira 'A'",
  salonLogoUrl: '',
};

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [googleConnected, setGoogleConnected] = useState(false);
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
    try {
      await connectGoogleWorkspace();
      setGoogleConnected(true);
    } catch {
      // Popup closed or cancelled
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
    return (
      <LoginView
        branding={branding}
        onSuccess={(loggedInUser, isGoogle) => {
          setUser(loggedInUser);
          if (isGoogle) setGoogleConnected(true);
          setActiveSection('dashboard');
          void refreshNotifications();
        }}
      />
    );
  }

  return (
    <SidebarLayout
      user={user}
      branding={branding}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      unreadNotifications={unreadNotifications}
      googleConnected={googleConnected}
      onConnectGoogle={handleConnectGoogle}
      onLogout={handleLogout}
    >
      {activeSection === 'dashboard' && (
        <DashboardView user={user} onNavigate={setActiveSection} />
      )}
      {activeSection === 'appointments' && (
        <AppointmentsView
          user={user}
          onCheckoutAppointment={(payload) => {
            setPosPrefill(payload);
            setActiveSection('pos');
          }}
        />
      )}
      {activeSection === 'pos' && (
        <PosBillingView
          user={user}
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
          googleConnected={googleConnected}
          onConnectGoogle={handleConnectGoogle}
        />
      )}
      {activeSection === 'services' && <ServicesView user={user} />}
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
        />
      )}
    </SidebarLayout>
  );
}
