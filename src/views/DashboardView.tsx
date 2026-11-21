import React, { useEffect, useState } from 'react';
import {
  Calendar,
  TrendingUp,
  Users,
  AlertTriangle,
  ShoppingBag,
  Upload,
  Sparkles,
  RefreshCw,
  Receipt,
  FileDown,
  Printer,
  X,
  CheckCircle2,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, downloadReceiptPdf, formatUGX } from '../lib/api';
import type { NavSection, POSTransactionRecord, SalonBranding, SessionUser } from '../types';

interface DashboardViewProps {
  user: SessionUser;
  branding?: SalonBranding;
  onNavigate: (section: NavSection) => void;
}

interface DashboardResponse {
  roleScope: string;
  today: string;
  period?: { startDate: string; endDate: string };
  hasTransactions?: boolean;
  todayMetrics?: {
    totalSales: number;
    serviceRevenue: number;
    productRevenue: number;
    customerCount: number;
    completedAppointments: number;
    walkIns: number;
    employeeEarnings: number;
    lunchDeductions: number;
    employeeCommissions: number;
    salonShare: number;
    expenses: number | null;
    profitEstimate: number | null;
  };
  financialOverview?: {
    periodRevenue: number;
    periodServiceRevenue: number;
    periodProductRevenue: number;
    periodSalonShare: number;
    periodExpenses: number | null;
    periodNetProfitEstimate: number | null;
    outstandingCommissions: number | null;
    totalCommissionPaid: number | null;
    outstandingCustomerBalances: number;
    giftCardLiability: number;
    paymentBreakdown: Record<string, number>;
  };
  operationalOverview?: {
    upcomingAppointments: Array<{
      id: string;
      customerName: string;
      employeeName: string;
      serviceNames: string[];
      date: string;
      startTime: string;
      status: string;
    }>;
    availableStylists: Array<{
      id: string;
      fullName: string;
      roleTitle: string;
      avatarUrl?: string;
    }>;
    todayAttendanceCount: number;
    lowStockCount: number;
    lowStockItems: Array<{
      id: string;
      name: string;
      sku: string;
      currentQuantity: number;
      minStockLevel: number;
      unit: string;
    }>;
    totalCustomers: number;
    returningCustomers: number;
    retentionRate: number;
    cancelledAppointments: number;
    noShowAppointments: number;
  };
  charts?: {
    weeklyRevenueTrend?: Array<{
      date: string;
      dayLabel: string;
      serviceRevenue: number;
      productRevenue: number;
      totalRevenue: number;
      expenses: number;
      isToday: boolean;
    }>;
    dailyTrend: Array<{ date: string; serviceSales: number; productSales: number; expenses: number }>;
    employeePerformance: Array<{
      employeeId: string;
      fullName: string;
      roleTitle: string;
      avatarUrl?: string;
      periodGross: number;
      periodCommission: number;
      periodServicesCount: number;
      outstandingCommission: number;
    }>;
    popularServices: Array<{ name: string; count: number; revenue: number }>;
    expenseBreakdown: Array<{ category: string; amount: number }>;
  };
  // Employee self-scope
  employee?: {
    fullName: string;
    roleTitle: string;
    avatarUrl?: string;
    status?: 'Active' | 'On Leave' | 'Inactive';
    active?: boolean;
    lastDocumentUpdatedAt?: string;
  };
  todayStats?: {
    grossEarnings: number;
    lunchDeduction: number;
    netCommissionable: number;
    commissionEarned: number;
    servicesCount: number;
  };
  summary?: {
    grossEarnings: number;
    totalLunchDeducted: number;
    totalCommissionEarned: number;
    totalPaid: number;
    outstandingBalance: number;
    directTips: number;
  };
  upcomingAppointments?: Array<{
    id: string;
    customerName: string;
    serviceNames: string[];
    date: string;
    startTime: string;
    status: string;
  }>;
  recentTransactions?: POSTransactionRecord[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({ user, branding, onNavigate }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMsg, setActionMsg] = useState('');
  const [error, setError] = useState('');
  const [trendRange, setTrendRange] = useState<'week' | '14d'>('week');
  const [selectedReceipt, setSelectedReceipt] = useState<POSTransactionRecord | null>(null);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<DashboardResponse>(
        `/api/dashboard?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [startDate, endDate]);

  const handleLoadSampleDay = async () => {
    setActionMsg('');
    try {
      await apiFetch('/api/system/load-sample-day', { method: 'POST' });
      setActionMsg('Loaded sample salon day transactions and recalculated commissions.');
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load sample data.');
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="h-28 rounded-2xl bg-white border border-[#1D1717]/10 animate-pulse" />
          ))}
        </div>
        <div className="h-72 rounded-2xl bg-white border border-[#1D1717]/10 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-red-200 rounded-2xl p-6 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (!data) return null;

  // EMPLOYEE SELF-SERVICE DASHBOARD
  if (data.roleScope === 'employee') {
    const todayStats = data.todayStats!;
    const summary = data.summary!;
    return (
      <div className="space-y-6">
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {data.employee?.avatarUrl && (
              <img
                src={data.employee.avatarUrl}
                alt={data.employee.fullName}
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-xl object-cover border border-[#1D1717]/10"
              />
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#1D1717]">
                  Welcome, {data.employee?.fullName || user.name}
                </h2>
                {data.employee && (() => {
                  const empStatus =
                    data.employee.status || (data.employee.active === false ? 'Inactive' : 'Active');
                  const style =
                    empStatus === 'Active'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : empStatus === 'On Leave'
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-stone-100 text-stone-600 border-stone-200';
                  const dot =
                    empStatus === 'Active'
                      ? 'bg-emerald-500'
                      : empStatus === 'On Leave'
                        ? 'bg-amber-500'
                        : 'bg-stone-400';
                  return (
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${style}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      {empStatus}
                    </span>
                  );
                })()}
              </div>
              <p className="text-xs text-[#1D1717]/65 mt-0.5">
                {data.employee?.roleTitle} &middot; Personal Earnings &amp; Schedule ({data.today})
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('commissions')}
            className="px-4 py-2 rounded-lg bg-[#E83B84] text-white text-xs font-semibold hover:bg-[#d12d73] cursor-pointer whitespace-nowrap"
          >
            View My Commission Ledger
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard label="Today's Gross Services" value={formatUGX(todayStats.grossEarnings)} sub={`${todayStats.servicesCount} services`} />
          <MetricCard label="Today's Lunch Deduction" value={formatUGX(todayStats.lunchDeduction)} sub="Once daily before commission" />
          <MetricCard label="Today's Net Commission" value={formatUGX(todayStats.commissionEarned)} sub={`Net base: ${formatUGX(todayStats.netCommissionable)}`} accent />
          <MetricCard label="Outstanding Commission Balance" value={formatUGX(summary.outstandingBalance)} sub={`Paid to date: ${formatUGX(summary.totalPaid)}`} />
        </div>

        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <h3 className="text-base font-bold text-[#1D1717] mb-4">My Upcoming Appointments</h3>
          {!data.upcomingAppointments || data.upcomingAppointments.length === 0 ? (
            <p className="text-sm text-[#1D1717]/60">No upcoming appointments assigned to you yet.</p>
          ) : (
            <div className="divide-y divide-[#1D1717]/10">
              {data.upcomingAppointments.map((apt) => (
                <div key={apt.id} className="py-3 flex items-center justify-between gap-4 text-sm">
                  <div>
                    <div className="font-semibold text-[#1D1717]">{apt.customerName}</div>
                    <div className="text-xs text-[#1D1717]/60">{apt.serviceNames.join(', ')}</div>
                  </div>
                  <div className="text-right font-mono text-xs tabular-nums">
                    <div className="font-semibold text-[#1D1717]">{apt.date} &middot; {apt.startTime}</div>
                    <div className="text-[#E83B84]">{apt.status}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const tm = data.todayMetrics!;
  const fo = data.financialOverview!;
  const oo = data.operationalOverview!;
  const charts = data.charts!;

  const weekData = (charts.weeklyRevenueTrend || []).map((d) => ({
    label: d.isToday ? `${d.dayLabel} (Today)` : `${d.dayLabel} ${d.date.slice(8)}`,
    date: d.date,
    dayLabel: d.dayLabel,
    serviceRevenue: d.serviceRevenue,
    productRevenue: d.productRevenue,
    totalRevenue: d.totalRevenue,
    expenses: d.expenses,
    isToday: d.isToday,
  }));

  const fourteenDayData = charts.dailyTrend.map((d) => ({
    label: d.date.slice(5),
    date: d.date,
    dayLabel: d.date.slice(5),
    serviceRevenue: d.serviceSales,
    productRevenue: d.productSales,
    totalRevenue: d.serviceSales + d.productSales,
    expenses: d.expenses,
    isToday: d.date === data.today,
  }));

  const activeChartData = trendRange === 'week' && weekData.length > 0 ? weekData : fourteenDayData;
  const activeRangeRevenue = activeChartData.reduce((sum, d) => sum + d.totalRevenue, 0);
  const activeRangeExpenses = activeChartData.reduce((sum, d) => sum + d.expenses, 0);

  return (
    <div className="space-y-6">
      {/* Header & Date Filter */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[#1D1717]">Business Overview</h2>
          <p className="text-xs text-[#1D1717]/65 mt-0.5">
            Live figures computed strictly from stored Trendy Unisex Salon records &middot; Today: {data.today}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white border border-[#1D1717]/15 rounded-xl px-3 py-1.5 text-xs">
            <Calendar className="w-3.5 h-3.5 text-[#E83B84]" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent focus:outline-none font-mono"
            />
            <span className="text-[#1D1717]/40">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent focus:outline-none font-mono"
            />
          </div>
          <button
            onClick={() => {
              setStartDate(today);
              setEndDate(today);
            }}
            className="px-3 py-2 rounded-xl bg-white border border-[#1D1717]/15 hover:bg-[#F3BFD3]/40 text-xs font-medium cursor-pointer"
          >
            Today
          </button>
          <button
            onClick={() => {
              setStartDate(`${today.slice(0, 7)}-01`);
              setEndDate(today);
            }}
            className="px-3 py-2 rounded-xl bg-white border border-[#1D1717]/15 hover:bg-[#F3BFD3]/40 text-xs font-medium cursor-pointer"
          >
            This Month
          </button>
          <button
            onClick={() => void loadDashboard()}
            className="p-2 rounded-xl bg-white border border-[#1D1717]/15 hover:bg-[#F8EEEB] cursor-pointer"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
          {actionMsg}
        </div>
      )}

      {/* Clean Empty-State Guidance when no transactions exist yet */}
      {!data.hasTransactions && (
        <div className="bg-white border border-[#E83B84]/30 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <img
              src="/src/assets/images/salon_tools_still_life_1794932003253.jpg"
              alt="Trendy Unisex Salon tools"
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-xl object-cover border border-[#1D1717]/10 shrink-0 hidden sm:block"
            />
            <div>
              <h3 className="text-base font-bold text-[#1D1717]">
                Ready for Live Salon Operations
              </h3>
              <p className="text-sm text-[#1D1717]/70 mt-1 max-w-2xl">
                No transactions have been recorded yet, so all dashboard figures accurately read UGX 0.
                Begin ringing up customers in POS, import your historical{' '}
                <span className="font-mono text-xs">Trendy_Unisex_Salon_Records.xlsx</span> workbook,
                or load a sample day for verification.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              onClick={() => onNavigate('pos')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Open POS &amp; Billing</span>
            </button>
            {user.role === 'owner' && (
              <>
                <button
                  onClick={() => onNavigate('settings')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#1D1717]/15 bg-[#F8EEEB] hover:bg-[#F3BFD3]/50 text-[#1D1717] text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import Excel Workbook</span>
                </button>
                <button
                  onClick={handleLoadSampleDay}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#E83B84]/30 bg-white hover:bg-[#F3BFD3]/35 text-[#E83B84] text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Load Sample Day</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Section 1: Today's Daily Business Performance */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1D1717]">Today&rsquo;s Performance ({data.today})</h3>
          <span className="text-xs text-[#1D1717]/55 font-mono tabular-nums">
            {tm.customerCount} customers &middot; {tm.completedAppointments} completed appts &middot; {tm.walkIns} walk-ins
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Today's Total Sales"
            value={formatUGX(tm.totalSales)}
            sub={`Services: ${formatUGX(tm.serviceRevenue)} · Retail: ${formatUGX(tm.productRevenue)}`}
            accent
          />
          <MetricCard
            label="Today's Employee Commissions"
            value={formatUGX(tm.employeeCommissions)}
            sub={`Gross: ${formatUGX(tm.employeeEarnings)} · Lunch: -${formatUGX(tm.lunchDeductions)}`}
          />
          <MetricCard
            label="Today's Salon Share"
            value={formatUGX(tm.salonShare)}
            sub="Net commissionable minus staff share"
          />
          <MetricCard
            label={tm.profitEstimate !== null ? "Today's Profit Estimate" : "Today's Retail Sales"}
            value={tm.profitEstimate !== null ? formatUGX(tm.profitEstimate) : formatUGX(tm.productRevenue)}
            sub={
              tm.expenses !== null
                ? `Expenses today: ${formatUGX(tm.expenses)}`
                : 'Salon retail & walk-in overview'
            }
          />
        </div>
      </section>

      {/* Section 2: Selected Period Financial Overview */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[#1D1717]">
          Financial Overview ({startDate} to {endDate})
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label="Period Revenue"
            value={formatUGX(fo.periodRevenue)}
            sub={`Services: ${formatUGX(fo.periodServiceRevenue)} · Retail: ${formatUGX(fo.periodProductRevenue)}`}
          />
          {fo.periodExpenses !== null ? (
            <MetricCard
              label="Period Expenses & Profit Est."
              value={formatUGX(fo.periodNetProfitEstimate || 0)}
              sub={`Approved expenses: ${formatUGX(fo.periodExpenses)} · Salon share: ${formatUGX(fo.periodSalonShare)}`}
            />
          ) : (
            <MetricCard
              label="Outstanding Customer Balances"
              value={formatUGX(fo.outstandingCustomerBalances)}
              sub="Partial POS deposits pending"
            />
          )}
          {fo.outstandingCommissions !== null ? (
            <MetricCard
              label="Outstanding Commissions"
              value={formatUGX(fo.outstandingCommissions)}
              sub={`Paid all-time: ${formatUGX(fo.totalCommissionPaid || 0)}`}
            />
          ) : (
            <MetricCard
              label="Active Stylists"
              value={`${oo.availableStylists.length} Active`}
              sub={`Attendance logged today: ${oo.todayAttendanceCount}`}
            />
          )}
          <MetricCard
            label="Gift Card Liability & Receivables"
            value={formatUGX(fo.giftCardLiability)}
            sub={`Customer balances due: ${formatUGX(fo.outstandingCustomerBalances)}`}
          />
        </div>
      </section>

      {/* Section 3: Visual Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Current-Week / 14-Day Recharts Revenue & Expense Bar Chart */}
        <div className="lg:col-span-2 bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-[#1D1717] flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#E83B84]" />
                <span>
                  {trendRange === 'week'
                    ? 'Current Week Daily Revenue Trend (Mon–Sun)'
                    : '14-Day Revenue & Expense Trend'}
                </span>
              </h3>
              <p className="text-xs text-[#1D1717]/55 mt-0.5">
                {trendRange === 'week'
                  ? `This week's revenue: ${formatUGX(activeRangeRevenue)} · Expenses: ${formatUGX(activeRangeExpenses)}`
                  : `14-day revenue: ${formatUGX(activeRangeRevenue)} · Expenses: ${formatUGX(activeRangeExpenses)}`}
              </p>
            </div>
            <div className="inline-flex items-center gap-1 bg-[#F8EEEB] p-1 rounded-xl border border-[#1D1717]/10 self-start sm:self-auto text-xs">
              <button
                type="button"
                onClick={() => setTrendRange('week')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                  trendRange === 'week'
                    ? 'bg-[#E83B84] text-white'
                    : 'text-[#1D1717]/70 hover:text-[#1D1717]'
                }`}
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => setTrendRange('14d')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                  trendRange === '14d'
                    ? 'bg-[#E83B84] text-white'
                    : 'text-[#1D1717]/70 hover:text-[#1D1717]'
                }`}
              >
                14 Days
              </button>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={activeChartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
                barGap={4}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#1D1717"
                  strokeOpacity={0.08}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#1D1717', fontSize: 11, opacity: 0.7 }}
                  axisLine={{ stroke: '#1D1717', strokeOpacity: 0.12 }}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  tickFormatter={formatCompactUGX}
                  tick={{ fill: '#1D1717', fontSize: 11, opacity: 0.65, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                />
                <Tooltip
                  cursor={{ fill: '#F8EEEB', opacity: 0.7 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0].payload as {
                      date: string;
                      dayLabel: string;
                      serviceRevenue: number;
                      productRevenue: number;
                      totalRevenue: number;
                      expenses: number;
                      isToday: boolean;
                    };
                    return (
                      <div className="bg-white border border-[#1D1717]/15 rounded-xl p-3.5 shadow-sm text-xs space-y-1.5 min-w-[205px]">
                        <div className="font-bold text-[#1D1717] border-b border-[#1D1717]/10 pb-1 flex items-center justify-between gap-2">
                          <span>{pt.dayLabel}</span>
                          <span className="font-mono text-[11px] text-[#1D1717]/55">{pt.date}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#1D1717]/75">Service Revenue</span>
                          <span className="font-mono tabular-nums font-semibold text-[#E83B84]">
                            {formatUGX(pt.serviceRevenue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#1D1717]/75">Retail Sales</span>
                          <span className="font-mono tabular-nums font-semibold text-[#D65A8E]">
                            {formatUGX(pt.productRevenue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-t border-[#1D1717]/10 pt-1">
                          <span className="font-semibold text-[#1D1717]">Total Daily Revenue</span>
                          <span className="font-mono tabular-nums font-bold text-[#1D1717]">
                            {formatUGX(pt.totalRevenue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-[#1D1717]/75">Expenses</span>
                          <span className="font-mono tabular-nums font-semibold text-[#1D1717]/80">
                            {formatUGX(pt.expenses)}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="square"
                  wrapperStyle={{ fontSize: '11px', paddingBottom: '8px' }}
                />
                <Bar
                  dataKey="serviceRevenue"
                  name="Services (UGX)"
                  stackId="revenue"
                  fill="#E83B84"
                  maxBarSize={36}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="productRevenue"
                  name="Retail (UGX)"
                  stackId="revenue"
                  fill="#F08BB4"
                  maxBarSize={36}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="expenses"
                  name="Expenses (UGX)"
                  fill="#1D1717"
                  maxBarSize={18}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Methods & Operational Alerts */}
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 flex flex-col justify-between space-y-6">
          <div>
            <h3 className="text-base font-bold text-[#1D1717] mb-3">Payment Method Breakdown</h3>
            {Object.keys(fo.paymentBreakdown).length === 0 ? (
              <p className="text-xs text-[#1D1717]/55">No payments recorded in selected period.</p>
            ) : (
              <div className="space-y-2.5">
                {Object.entries(fo.paymentBreakdown).map(([method, amt]) => {
                  const totalPay = Object.values(fo.paymentBreakdown).reduce((s, v) => s + v, 0) || 1;
                  const pct = Math.round((amt / totalPay) * 100);
                  return (
                    <div key={method} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#1D1717]">{method}</span>
                        <span className="font-mono tabular-nums text-[#1D1717]/80">
                          {formatUGX(amt)} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-[#F8EEEB] overflow-hidden">
                        <div className="h-full bg-[#E83B84]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-[#1D1717]/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-[#1D1717] flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Low-Stock Alerts
              </span>
              <button
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-[#E83B84] hover:underline cursor-pointer"
              >
                Manage Stock
              </button>
            </div>
            {oo.lowStockItems.length === 0 ? (
              <p className="text-xs text-emerald-700">All inventory items are above minimum threshold.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {oo.lowStockItems.slice(0, 4).map((item) => (
                  <li key={item.id} className="flex items-center justify-between text-[#1D1717]/80">
                    <span className="truncate pr-2">{item.name}</span>
                    <span className="font-mono tabular-nums text-red-700 shrink-0">
                      {item.currentQuantity} / {item.minStockLevel} {item.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Section 4: Employee Performance, Popular Services & Upcoming Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Employee Performance */}
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[#1D1717]">Stylist Performance</h3>
            <button
              onClick={() => onNavigate('employees')}
              className="text-xs font-semibold text-[#E83B84] hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>
          {charts.employeePerformance.length === 0 ? (
            <div className="space-y-3">
              {oo.availableStylists.map((s) => (
                <div key={s.id} className="flex items-center gap-3">
                  {s.avatarUrl && (
                    <img
                      src={s.avatarUrl}
                      alt={s.fullName}
                      referrerPolicy="no-referrer"
                      className="w-10 h-10 rounded-lg object-cover border border-[#1D1717]/10"
                    />
                  )}
                  <div>
                    <div className="text-sm font-semibold text-[#1D1717]">{s.fullName}</div>
                    <div className="text-xs text-[#1D1717]/60">{s.roleTitle}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3.5">
              {charts.employeePerformance.map((emp) => (
                <div key={emp.employeeId} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {emp.avatarUrl ? (
                      <img
                        src={emp.avatarUrl}
                        alt={emp.fullName}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-lg object-cover border border-[#1D1717]/10 shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-[#F3BFD3]/50 flex items-center justify-center text-xs font-bold shrink-0">
                        {emp.fullName[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#1D1717] truncate">{emp.fullName}</div>
                      <div className="text-xs text-[#1D1717]/60 font-mono tabular-nums">
                        {emp.periodServicesCount} services &middot; Due: {formatUGX(emp.outstandingCommission)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="text-xs font-bold text-[#1D1717]">{formatUGX(emp.periodGross)}</div>
                    <div className="text-[11px] text-[#E83B84]">Comm: {formatUGX(emp.periodCommission)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Popular Services */}
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[#1D1717]">Popular Services</h3>
            <span className="text-xs text-[#1D1717]/55 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> {oo.retentionRate}% retention
            </span>
          </div>
          {charts.popularServices.length === 0 ? (
            <p className="text-xs text-[#1D1717]/55">
              Service rankings will populate automatically as POS transactions are recorded.
            </p>
          ) : (
            <div className="space-y-3">
              {charts.popularServices.map((srv) => {
                const maxRev = charts.popularServices[0]?.revenue || 1;
                const widthPct = Math.round((srv.revenue / maxRev) * 100);
                return (
                  <div key={srv.name} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#1D1717] truncate pr-2">{srv.name}</span>
                      <span className="font-mono tabular-nums text-[#1D1717]/75 shrink-0">
                        {srv.count}x &middot; {formatUGX(srv.revenue)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#F8EEEB] overflow-hidden">
                      <div className="h-full bg-[#F08BB4]" style={{ width: `${widthPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Upcoming Appointments */}
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-[#1D1717]">Upcoming Appointments</h3>
            <button
              onClick={() => onNavigate('appointments')}
              className="text-xs font-semibold text-[#E83B84] hover:underline cursor-pointer"
            >
              Open Calendar
            </button>
          </div>
          {oo.upcomingAppointments.length === 0 ? (
            <p className="text-xs text-[#1D1717]/55">
              No upcoming appointments scheduled. Click &ldquo;Open Calendar&rdquo; to book a client.
            </p>
          ) : (
            <div className="divide-y divide-[#1D1717]/10">
              {oo.upcomingAppointments.map((apt) => (
                <div key={apt.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#1D1717] truncate">{apt.customerName}</div>
                    <div className="text-[#1D1717]/60 truncate">
                      {apt.serviceNames.join(', ')} &middot; {apt.employeeName}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="font-semibold text-[#1D1717]">{apt.startTime}</div>
                    <div className="text-[#E83B84]">{apt.date}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Recent Transactions (Last 5 Completed Sales) */}
      <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-bold text-[#1D1717] flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#E83B84]" />
              Recent Transactions
            </h3>
            <p className="text-xs text-[#1D1717]/60 mt-0.5">
              Last 5 completed POS sales with instant receipt details
            </p>
          </div>
          <button
            onClick={() => onNavigate('pos')}
            className="text-xs font-semibold text-[#E83B84] hover:underline cursor-pointer self-start sm:self-auto"
          >
            Open POS &amp; Sales
          </button>
        </div>

        {!data.recentTransactions || data.recentTransactions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#1D1717]/15 bg-[#F8EEEB]/50 p-6 text-center">
            <p className="text-xs font-medium text-[#1D1717]/65">
              No completed POS transactions recorded yet. Completed sales will appear here for quick receipt lookup.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#1D1717]/10">
            {data.recentTransactions.map((tx) => {
              const itemSummary =
                tx.items.length > 0
                  ? tx.items.map((item) => `${item.name}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`).join(', ')
                  : 'POS Sale';
              const paymentLabel =
                tx.payments.length > 0 ? tx.payments.map((p) => p.method).join(' + ') : 'Paid';

              return (
                <div
                  key={tx.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#1D1717]">
                        {tx.reference}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-semibold">
                        <CheckCircle2 className="w-3 h-3" />
                        {tx.status}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-[#F8EEEB] text-[#1D1717]/75 text-[11px] font-medium">
                        {paymentLabel}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-[#1D1717] truncate">
                      {tx.customerName}
                    </div>
                    <div className="text-xs text-[#1D1717]/60 truncate">
                      {itemSummary} &middot; {tx.date} &middot; Cashier: {tx.cashierName}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="text-left sm:text-right font-mono tabular-nums">
                      <div className="text-sm font-bold text-[#1D1717]">
                        {formatUGX(tx.totalAmount)}
                      </div>
                      <div className="text-[11px] text-[#1D1717]/55">
                        {tx.items.length} item{tx.items.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedReceipt(tx)}
                        className="px-3 py-1.5 rounded-xl bg-[#1D1717] hover:bg-[#1D1717]/85 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Receipt className="w-3.5 h-3.5 text-[#F3BFD3]" />
                        View Receipt
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadReceiptPdf(tx, branding)}
                        className="p-2 rounded-xl bg-[#F8EEEB] hover:bg-[#F3BFD3]/60 text-[#1D1717] cursor-pointer"
                        aria-label={`Download PDF receipt ${tx.reference}`}
                        title="Download PDF Receipt"
                      >
                        <FileDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Receipt Details Modal */}
      {selectedReceipt && (
        <div
          className="fixed inset-0 z-50 bg-[#1D1717]/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Receipt details for ${selectedReceipt.reference}`}
        >
          <div className="bg-white border border-[#1D1717]/15 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="px-6 py-4 border-b border-[#1D1717]/10 flex items-center justify-between bg-[#F8EEEB]/60">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#1D1717] text-[#F3BFD3] flex items-center justify-center">
                  <Receipt className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#1D1717]">
                    {branding?.businessName || 'Trendy Unisex Salon'}
                  </h4>
                  <p className="text-[11px] font-mono text-[#1D1717]/60">
                    Receipt {selectedReceipt.reference}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="p-1.5 rounded-lg hover:bg-[#1D1717]/10 text-[#1D1717]/70 cursor-pointer"
                aria-label="Close receipt modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-3 text-xs bg-[#F8EEEB]/50 rounded-xl p-3.5 border border-[#1D1717]/10">
                <div>
                  <div className="text-[#1D1717]/55">Client</div>
                  <div className="font-semibold text-[#1D1717] mt-0.5">
                    {selectedReceipt.customerName}
                  </div>
                </div>
                <div>
                  <div className="text-[#1D1717]/55">Cashier</div>
                  <div className="font-semibold text-[#1D1717] mt-0.5">
                    {selectedReceipt.cashierName}
                  </div>
                </div>
                <div>
                  <div className="text-[#1D1717]/55">Date</div>
                  <div className="font-mono font-medium text-[#1D1717] mt-0.5">
                    {selectedReceipt.date}
                  </div>
                </div>
                <div>
                  <div className="text-[#1D1717]/55">Status</div>
                  <div className="font-semibold text-emerald-700 mt-0.5">
                    {selectedReceipt.status}
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-[#1D1717]/55 mb-2">
                  Line Items
                </div>
                <div className="divide-y divide-[#1D1717]/10 border border-[#1D1717]/10 rounded-xl overflow-hidden">
                  {selectedReceipt.items.map((item, idx) => (
                    <div key={item.id || `${item.refId}-${idx}`} className="px-3.5 py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-semibold text-[#1D1717]">
                          {item.name}
                          {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                        </div>
                        <div className="text-[#1D1717]/55 mt-0.5">
                          {item.itemType}
                          {item.employeeName ? ` · Stylist: ${item.employeeName}` : ''}
                          {' · Unit: '}
                          <span className="font-mono">{formatUGX(item.unitPrice)}</span>
                        </div>
                      </div>
                      <div className="font-mono font-bold text-[#1D1717] tabular-nums shrink-0">
                        {formatUGX(item.lineTotal)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 text-xs border-t border-[#1D1717]/10 pt-3">
                <div className="flex justify-between text-[#1D1717]/70">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums">{formatUGX(selectedReceipt.subtotal)}</span>
                </div>
                {selectedReceipt.discountTotal > 0 && (
                  <div className="flex justify-between text-[#E83B84]">
                    <span>Discount</span>
                    <span className="font-mono tabular-nums">-{formatUGX(selectedReceipt.discountTotal)}</span>
                  </div>
                )}
                {selectedReceipt.taxAmount > 0 && (
                  <div className="flex justify-between text-[#1D1717]/70">
                    <span>Tax</span>
                    <span className="font-mono tabular-nums">{formatUGX(selectedReceipt.taxAmount)}</span>
                  </div>
                )}
                {selectedReceipt.tipAmount > 0 && (
                  <div className="flex justify-between text-[#1D1717]/70">
                    <span>Tip</span>
                    <span className="font-mono tabular-nums">{formatUGX(selectedReceipt.tipAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-[#1D1717] pt-2 border-t border-[#1D1717]/10">
                  <span>Total Paid</span>
                  <span className="font-mono tabular-nums">{formatUGX(selectedReceipt.totalAmount)}</span>
                </div>
              </div>

              {selectedReceipt.payments.length > 0 && (
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-[#1D1717]/55 mb-2">
                    Payment Breakdown
                  </div>
                  <div className="space-y-1.5">
                    {selectedReceipt.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="flex items-center justify-between text-xs bg-[#F8EEEB]/40 rounded-lg px-3 py-2 border border-[#1D1717]/10"
                      >
                        <span className="font-medium text-[#1D1717]">
                          {payment.method}
                          {payment.reference ? ` (${payment.reference})` : ''}
                        </span>
                        <span className="font-mono font-semibold text-[#1D1717] tabular-nums">
                          {formatUGX(payment.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedReceipt.notes && (
                <div className="text-xs text-[#1D1717]/70 bg-[#F8EEEB]/40 rounded-xl p-3 border border-[#1D1717]/10">
                  <span className="font-semibold text-[#1D1717]">Notes: </span>
                  {selectedReceipt.notes}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-[#1D1717]/10 bg-[#F8EEEB]/40 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 rounded-xl bg-white border border-[#1D1717]/15 hover:bg-[#F8EEEB] text-xs font-semibold text-[#1D1717] flex items-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Receipt
              </button>
              <button
                type="button"
                onClick={() => downloadReceiptPdf(selectedReceipt, branding)}
                className="px-3.5 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d32f75] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                Download PDF
              </button>
              <button
                type="button"
                onClick={() => setSelectedReceipt(null)}
                className="px-3.5 py-2 rounded-xl bg-[#1D1717] hover:bg-[#1D1717]/85 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function formatCompactUGX(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (abs >= 1_000) return `${Math.round(val / 1_000)}K`;
  return String(Math.round(val));
}

const MetricCard: React.FC<{
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}> = ({ label, value, sub, accent }) => (
  <div
    className={`rounded-2xl p-5 border ${
      accent
        ? 'bg-[#1D1717] text-white border-[#1D1717]'
        : 'bg-white text-[#1D1717] border-[#1D1717]/10'
    }`}
  >
    <div className={`text-xs font-medium ${accent ? 'text-[#F3BFD3]' : 'text-[#1D1717]/60'}`}>
      {label}
    </div>
    <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums mt-2 tracking-tight">
      {value}
    </div>
    <div className={`text-xs mt-2 truncate ${accent ? 'text-white/75' : 'text-[#1D1717]/55'}`}>
      {sub}
    </div>
  </div>
);
