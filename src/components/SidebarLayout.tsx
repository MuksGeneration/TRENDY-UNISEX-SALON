import React, { useState } from 'react';
import {
  LayoutDashboard,
  Calendar,
  ShoppingBag,
  Users,
  UserCheck,
  Clock,
  ClipboardCheck,
  Scissors,
  Percent,
  Wallet,
  Utensils,
  Receipt,
  Package,
  Gift,
  BarChart3,
  Bot,
  Bell,
  ShieldCheck,
  Settings,
  FileSearch,
  Menu,
  X,
  LogOut,
  Cloud,
  KeyRound,
} from 'lucide-react';
import { ChangePasswordModal } from './ChangePasswordModal';
import { PWAInstallButton } from './PWAInstallButton';
import type { NavSection, SalonBranding, SessionUser, UserRole } from '../types';

interface NavItemConfig {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
}

export const NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['owner', 'manager', 'employee'] },
  { id: 'appointments', label: 'Appointments', icon: Calendar, roles: ['owner', 'manager', 'employee'] },
  { id: 'pos', label: 'POS & Billing', icon: ShoppingBag, roles: ['owner', 'manager'] },
  { id: 'customers', label: 'Customers', icon: Users, roles: ['owner', 'manager'] },
  { id: 'employees', label: 'Employees', icon: UserCheck, roles: ['owner', 'manager', 'employee'] },
  { id: 'scheduling', label: 'Staff Scheduling', icon: Clock, roles: ['owner', 'manager', 'employee'] },
  { id: 'attendance', label: 'Attendance', icon: ClipboardCheck, roles: ['owner', 'manager', 'employee'] },
  { id: 'services', label: 'Services', icon: Scissors, roles: ['owner', 'manager', 'employee'] },
  { id: 'commissions', label: 'Commission Mgmt', icon: Percent, roles: ['owner', 'manager', 'employee'] },
  { id: 'payments', label: 'Commission Payouts', icon: Wallet, roles: ['owner', 'manager', 'employee'] },
  { id: 'lunch', label: 'Lunch Deductions', icon: Utensils, roles: ['owner', 'manager', 'employee'] },
  { id: 'expenses', label: 'Expenses', icon: Receipt, roles: ['owner', 'manager'] },
  { id: 'inventory', label: 'Inventory', icon: Package, roles: ['owner', 'manager'] },
  { id: 'gift-cards', label: 'Gift Cards', icon: Gift, roles: ['owner', 'manager'] },
  { id: 'reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'manager'] },
  { id: 'ai-assistant', label: 'AI Assistant', icon: Bot, roles: ['owner', 'manager', 'employee'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, roles: ['owner', 'manager', 'employee'] },
  { id: 'users', label: 'Users', icon: ShieldCheck, roles: ['owner', 'manager'] },
  { id: 'settings', label: 'Settings & Sync', icon: Settings, roles: ['owner'] },
  { id: 'audit-logs', label: 'Audit Logs', icon: FileSearch, roles: ['owner', 'manager'] },
];

interface SidebarLayoutProps {
  user: SessionUser;
  branding?: SalonBranding;
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  unreadNotifications: number;
  googleConnected: boolean;
  onConnectGoogle: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  user,
  branding,
  activeSection,
  onSelectSection,
  unreadNotifications,
  googleConnected,
  onConnectGoogle,
  onLogout,
  children,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [bgError, setBgError] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const activeTitle = visibleNav.find((i) => i.id === activeSection)?.label || 'Dashboard';

  const handleNavClick = (id: NavSection) => {
    onSelectSection(id);
    setMobileOpen(false);
  };

  const salonName = branding?.businessName || 'Trendy Unisex Salon';
  const salonTagline = branding?.tagline || 'Where Beauty Meets Style';
  const backgroundUrl =
    branding?.backgroundImageUrl ||
    '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg';

  const SidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-[#1D1717]/10">
      <div className="px-5 py-5 border-b border-[#1D1717]/10">
        <div className="flex items-center gap-3">
          {branding?.salonLogoUrl ? (
            <img
              src={branding.salonLogoUrl}
              alt={`${salonName} logo`}
              className="w-9 h-9 rounded-xl object-contain bg-[#F8EEEB] border border-[#1D1717]/10 p-0.5 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-xl bg-[#E83B84] text-white flex items-center justify-center shrink-0">
              <Scissors className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0">
            <div className="text-sm font-bold text-[#1D1717] truncate">
              {salonName}
            </div>
            <div className="text-xs text-[#1D1717]/55 truncate">
              {salonTagline}
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-[#E83B84] text-white'
                  : 'text-[#1D1717]/75 hover:bg-[#F3BFD3]/45 hover:text-[#1D1717]'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[#1D1717]/55'}`} />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'notifications' && unreadNotifications > 0 && (
                <span
                  className={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-white/20 text-white' : 'text-[#E83B84] font-semibold'
                  }`}
                >
                  {unreadNotifications}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#1D1717]/10 bg-[#F8EEEB]/70">
        <div className="text-xs font-semibold text-[#1D1717] truncate">{user.name}</div>
        <div className="text-xs text-[#1D1717]/60 capitalize mt-0.5 truncate">
          {user.role} &middot; {user.email}
        </div>
        <div className="mt-3 space-y-2">
          <div className="sm:hidden">
            <PWAInstallButton variant="sidebar" />
          </div>
          <button
            type="button"
            onClick={() => {
              setShowPasswordModal(true);
              setMobileOpen(false);
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#1D1717]/15 bg-white hover:bg-[#F3BFD3]/35 text-xs font-semibold text-[#1D1717] transition-colors cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5 text-[#E83B84]" />
            <span>Change Password</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-[#1D1717]/15 bg-white hover:bg-[#F3BFD3]/35 text-xs font-semibold text-[#1D1717] transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F8EEEB] text-[#1D1717]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen no-print">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-[#1D1717]/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg bg-[#F8EEEB] text-[#1D1717]"
              aria-label="Close navigation menu"
            >
              <X className="w-4 h-4" />
            </button>
            {SidebarContent}
          </div>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="relative flex-1 min-w-0 flex flex-col">
        {!bgError && backgroundUrl && (
          <div className="fixed inset-0 lg:left-64 pointer-events-none z-0 overflow-hidden no-print">
            <img
              src={backgroundUrl}
              alt=""
              aria-hidden="true"
              referrerPolicy="no-referrer"
              onError={() => setBgError(true)}
              className="w-full h-full object-cover opacity-20"
            />
            <div className="absolute inset-0 bg-[#F8EEEB]/80" />
          </div>
        )}

        {/* Top Bar (3-zone contract) */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#1D1717]/10 px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 no-print">
          {/* Zone 1: Menu + Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-[#1D1717]/15 text-[#1D1717] hover:bg-[#F8EEEB]"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="hidden sm:inline text-[#1D1717]/50 whitespace-nowrap">
                {salonName}
              </span>
              <span className="hidden sm:inline text-[#1D1717]/35">/</span>
              <h1 className="font-semibold text-[#1D1717] truncate">{activeTitle}</h1>
            </div>
          </div>

          {/* Zone 2: Install App, Google Workspace & Notification trigger */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton variant="header" />
            </div>
            <button
              onClick={onConnectGoogle}
              className={`hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                googleConnected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-[#1D1717]/15 bg-[#F8EEEB] hover:bg-[#F3BFD3]/40 text-[#1D1717]'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{googleConnected ? 'Google Sheets Ready' : 'Connect Google Sheets'}</span>
            </button>

            <button
              onClick={() => onSelectSection('notifications')}
              className="relative p-2 rounded-lg border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-[#1D1717] cursor-pointer"
              aria-label="Open notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#E83B84] text-white text-[10px] font-mono flex items-center justify-center">
                  {unreadNotifications > 9 ? '9+' : unreadNotifications}
                </span>
              )}
            </button>

            {/* Zone 3: Primary quick action */}
            {['owner', 'manager'].includes(user.role) && (
              <button
                onClick={() => onSelectSection('pos')}
                className="px-4 py-2 rounded-lg bg-[#E83B84] hover:bg-[#d12d73] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                New POS Sale
              </button>
            )}
          </div>
        </header>

        {/* Page Viewport */}
        <main className="relative z-10 flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>

      <ChangePasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        userEmail={user.email}
      />
    </div>
  );
};
