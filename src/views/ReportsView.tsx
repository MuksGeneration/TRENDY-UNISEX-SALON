import React, { useEffect, useState } from 'react';
import { FileDown, FileSpreadsheet, Printer } from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiFetch, exportReportToPdf, exportRowsToExcel, formatUGX } from '../lib/api';
import { getSalonTodayIso } from '../lib/date';
import type { CommissionLedgerEntry, EmployeeRecord, ExpenseRecord, POSTransactionRecord, SessionUser } from '../types';

interface MonthlyTrendPoint {
  month: string;
  label: string;
  revenue: number;
  expenses: number;
  serviceRevenue: number;
  retailRevenue: number;
}

interface ReportsResponse {
  period: { startDate: string; endDate: string };
  monthlyTrend: MonthlyTrendPoint[];
  salesSummary: {
    transactionCount: number;
    totalBilledSales: number;
    totalCollectedPayments: number;
    outstandingCustomerBalances: number;
    serviceRevenue: number;
    retailRevenue: number;
    byPaymentMethod: Record<string, number>;
    byCashier: Record<string, { count: number; total: number }>;
  };
  financialPnL: {
    serviceRevenue: number;
    retailRevenue: number;
    totalRevenue: number;
    totalLunchDeducted: number;
    totalEmployeeCommissions: number;
    salonShareFromServices: number;
    retailCostOfGoods: number;
    totalExpenses: number;
    actualNetProfit: number;
    giftCardLiability: number;
  } | null;
  employeeReport: Array<{
    employeeId: string;
    fullName: string;
    periodServices: number;
    periodGross: number;
    periodLunch: number;
    periodCommission: number;
    totalPaid: number;
    outstandingBalance: number;
  }>;
  appointmentReport: {
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    walkIns: number;
  };
  customerReport: {
    totalCustomers: number;
    returningCustomers: number;
    topCustomers: Array<{ id: string; fullName: string; phone: string; totalVisits: number; totalSpent: number }>;
  };
  inventoryReport: {
    totalSkus: number;
    inventoryCostValuation: number;
    lowStockItems: Array<{ sku: string; name: string; currentQuantity: number; minStockLevel: number; unit: string }>;
    movementsCount: number;
  };
  transactions: POSTransactionRecord[];
  expenses: ExpenseRecord[];
  ledger: CommissionLedgerEntry[];
}

export const ReportsView: React.FC<{ user: SessionUser }> = ({ user }) => {
  const today = getSalonTodayIso();
  const [startDate, setStartDate] = useState(`${today.slice(0, 7)}-01`);
  const [endDate, setEndDate] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [report, setReport] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pnl' | 'sales' | 'employees' | 'operations'>('pnl');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    setLoading(true);
    try {
      const q = new URLSearchParams({ startDate, endDate });
      if (employeeId) q.set('employeeId', employeeId);
      const [repRes, empRes] = await Promise.all([
        apiFetch<ReportsResponse>(`/api/reports?${q.toString()}`),
        apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
      ]);
      setReport(repRes);
      setEmployees(empRes.employees);
      if (!repRes.financialPnL && activeTab === 'pnl') {
        setActiveTab('sales');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [startDate, endDate, employeeId]);

  const handleExportExcel = () => {
    if (!report) return;
    exportRowsToExcel(`Trendy_Unisex_Salon_Report_${startDate}_to_${endDate}`, [
      {
        name: 'Sales Transactions',
        rows: report.transactions.map((t) => ({
          Reference: t.reference,
          Date: t.date,
          Customer: t.customerName,
          Cashier: t.cashierName,
          TotalUGX: t.totalAmount,
          PaidUGX: t.amountPaid,
          BalanceDueUGX: t.balanceDue,
          Status: t.status,
        })),
      },
      {
        name: 'Commission Ledger',
        rows: report.ledger.map((l) => ({
          Date: l.date,
          Reference: l.transactionReference,
          Employee: l.employeeName,
          Service: l.serviceName,
          GrossUGX: l.grossEarnings,
          LunchAllocUGX: l.lunchAllocation,
          NetBaseUGX: l.netCommissionableEarnings,
          Rate: `${Math.round(l.commissionRate * 100)}%`,
          EmployeeCommissionUGX: l.employeeCommission,
          SalonShareUGX: l.salonShare,
        })),
      },
      {
        name: 'Expenses',
        rows: report.expenses.map((e) => ({
          Date: e.date,
          Category: e.category,
          Description: e.description,
          AmountUGX: e.amount,
          Status: e.status,
        })),
      },
    ]);
  };

  const handleExportPdf = () => {
    if (!report) return;
    if (activeTab === 'employees') {
      exportReportToPdf(
        'Employee Performance & Commission Report',
        `Period: ${startDate} to ${endDate}`,
        ['Employee', 'Services', 'Gross Sales', 'Lunch Deducted', 'Period Comm.', 'All-Time Paid', 'Outstanding'],
        report.employeeReport.map((e) => [
          e.fullName,
          e.periodServices,
          formatUGX(e.periodGross),
          formatUGX(e.periodLunch),
          formatUGX(e.periodCommission),
          formatUGX(e.totalPaid),
          formatUGX(e.outstandingBalance),
        ])
      );
      return;
    }

    const summaryLines = report.financialPnL
      ? [
          `Total Billed Revenue: ${formatUGX(report.financialPnL.totalRevenue)} (Services: ${formatUGX(report.financialPnL.serviceRevenue)} | Retail: ${formatUGX(report.financialPnL.retailRevenue)})`,
          `Employee Commissions: ${formatUGX(report.financialPnL.totalEmployeeCommissions)} | Lunch Deducted: ${formatUGX(report.financialPnL.totalLunchDeducted)} | Salon Share: ${formatUGX(report.financialPnL.salonShareFromServices)}`,
          `Approved Expenses: ${formatUGX(report.financialPnL.totalExpenses)} | Retail COGS: ${formatUGX(report.financialPnL.retailCostOfGoods)} | Actual Net Profit: ${formatUGX(report.financialPnL.actualNetProfit)}`,
        ]
      : [`Total Billed Sales: ${formatUGX(report.salesSummary.totalBilledSales)} | Collected: ${formatUGX(report.salesSummary.totalCollectedPayments)}`];

    exportReportToPdf(
      'Trendy Unisex Salon Financial & Sales Report',
      `Period: ${startDate} to ${endDate}`,
      ['Reference', 'Date', 'Customer', 'Cashier', 'Total', 'Paid', 'Due', 'Status'],
      report.transactions.map((t) => [
        t.reference,
        t.date,
        t.customerName,
        t.cashierName,
        formatUGX(t.totalAmount),
        formatUGX(t.amountPaid),
        formatUGX(t.balanceDue),
        t.status,
      ]),
      summaryLines
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-mono"
          />
          <span className="text-xs text-[#1D1717]/50">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-mono"
          />
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs"
          >
            <option value="">All Employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" /> Export PDF
          </button>
          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1D1717] text-white text-xs font-semibold cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Export Excel
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-semibold cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}

      <div className="flex items-center gap-2 p-1 bg-white border border-[#1D1717]/10 rounded-xl w-fit no-print">
        {report?.financialPnL && (
          <button
            onClick={() => setActiveTab('pnl')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              activeTab === 'pnl' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
            }`}
          >
            Profit &amp; Loss Statement
          </button>
        )}
        <button
          onClick={() => setActiveTab('sales')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            activeTab === 'sales' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
          }`}
        >
          Sales &amp; Payments
        </button>
        <button
          onClick={() => setActiveTab('employees')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            activeTab === 'employees' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
          }`}
        >
          Employee Performance
        </button>
        <button
          onClick={() => setActiveTab('operations')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
            activeTab === 'operations' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
          }`}
        >
          Appointments, CRM &amp; Inventory
        </button>
      </div>

      {loading && !report && (
        <div className="space-y-6">
          <div className="h-80 rounded-2xl bg-white border border-[#1D1717]/10 animate-pulse" />
          <div className="h-72 rounded-2xl bg-white border border-[#1D1717]/10 animate-pulse" />
        </div>
      )}

      {report && activeTab === 'pnl' && report.financialPnL && (
        <div className="space-y-6">
          <MonthlyRevenueExpensesChart
            data={report.monthlyTrend || []}
            filteredByEmployee={Boolean(employeeId)}
          />

          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
            <div>
              <h3 className="text-lg font-bold">Profit &amp; Loss Reconciliation ({startDate} to {endDate})</h3>
              <p className="text-xs text-[#1D1717]/60">
                Clearly separates gross sales revenue, lunch deductions, employee commissions, salon share, retail COGS, and operating expenses.
              </p>
            </div>
          <div className="divide-y divide-[#1D1717]/10 text-sm">
            <PnLRow label="Service Revenue (Gross Billed)" value={formatUGX(report.financialPnL.serviceRevenue)} />
            <PnLRow label="Retail Product Sales" value={formatUGX(report.financialPnL.retailRevenue)} />
            <PnLRow label="Total Billed Sales Revenue" value={formatUGX(report.financialPnL.totalRevenue)} bold />
            <PnLRow label="Less: Daily Lunch Deductions (Allocated Before Commission)" value={`-${formatUGX(report.financialPnL.totalLunchDeducted)}`} />
            <PnLRow label="Less: Employee Service Commissions Earned" value={`-${formatUGX(report.financialPnL.totalEmployeeCommissions)}`} />
            <PnLRow label="Salon Share from Services (After Lunch & Commission)" value={formatUGX(report.financialPnL.salonShareFromServices)} bold />
            <PnLRow label="Less: Retail Cost of Goods Sold (COGS)" value={`-${formatUGX(report.financialPnL.retailCostOfGoods)}`} />
            <PnLRow label="Less: Operating Expenses (Approved / Active)" value={`-${formatUGX(report.financialPnL.totalExpenses)}`} />
            <PnLRow label="Actual Net Operating Profit" value={formatUGX(report.financialPnL.actualNetProfit)} highlight />
            <PnLRow label="Separate Liability: Active Unredeemed Gift Cards" value={formatUGX(report.financialPnL.giftCardLiability)} />
          </div>
          </div>
        </div>
      )}

      {report && activeTab === 'sales' && (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-[#F8EEEB]">
              <div className="text-[#1D1717]/60">Transactions</div>
              <div className="text-lg font-bold font-mono mt-1">{report.salesSummary.transactionCount}</div>
            </div>
            <div className="p-4 rounded-xl bg-[#F8EEEB]">
              <div className="text-[#1D1717]/60">Total Billed</div>
              <div className="text-lg font-bold font-mono mt-1">{formatUGX(report.salesSummary.totalBilledSales)}</div>
            </div>
            <div className="p-4 rounded-xl bg-[#F8EEEB]">
              <div className="text-[#1D1717]/60">Cash / MoMo Collected</div>
              <div className="text-lg font-bold font-mono mt-1 text-emerald-700">
                {formatUGX(report.salesSummary.totalCollectedPayments)}
              </div>
            </div>
            <div className="p-4 rounded-xl bg-[#F8EEEB]">
              <div className="text-[#1D1717]/60">Receivables Due</div>
              <div className="text-lg font-bold font-mono mt-1 text-amber-700">
                {formatUGX(report.salesSummary.outstandingCustomerBalances)}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                  <th className="py-2.5 px-3">Ref</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Customer</th>
                  <th className="py-2.5 px-3">Cashier</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                  <th className="py-2.5 px-3 text-right">Paid</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D1717]/10">
                {report.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 px-3 font-mono font-semibold">{t.reference}</td>
                    <td className="py-2.5 px-3 font-mono">{t.date}</td>
                    <td className="py-2.5 px-3">{t.customerName}</td>
                    <td className="py-2.5 px-3">{t.cashierName}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatUGX(t.totalAmount)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{formatUGX(t.amountPaid)}</td>
                    <td className="py-2.5 px-3 font-semibold">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report && activeTab === 'employees' && (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                <th className="py-3 px-3">Employee</th>
                <th className="py-3 px-3 text-right">Services</th>
                <th className="py-3 px-3 text-right">Period Gross</th>
                <th className="py-3 px-3 text-right">Period Lunch</th>
                <th className="py-3 px-3 text-right">Period Comm.</th>
                <th className="py-3 px-3 text-right">Total Paid</th>
                <th className="py-3 px-3 text-right">Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1D1717]/10">
              {report.employeeReport.map((e) => (
                <tr key={e.employeeId}>
                  <td className="py-3 px-3 font-semibold">{e.fullName}</td>
                  <td className="py-3 px-3 text-right font-mono">{e.periodServices}</td>
                  <td className="py-3 px-3 text-right font-mono">{formatUGX(e.periodGross)}</td>
                  <td className="py-3 px-3 text-right font-mono">{formatUGX(e.periodLunch)}</td>
                  <td className="py-3 px-3 text-right font-mono font-bold text-[#E83B84]">
                    {formatUGX(e.periodCommission)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-700">{formatUGX(e.totalPaid)}</td>
                  <td className="py-3 px-3 text-right font-mono font-bold">{formatUGX(e.outstandingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && activeTab === 'operations' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-2 text-xs">
            <h4 className="font-bold text-sm">Appointment Summary</h4>
            <div className="flex justify-between py-1"><span>Total Scheduled</span><strong className="font-mono">{report.appointmentReport.total}</strong></div>
            <div className="flex justify-between py-1"><span>Completed</span><strong className="font-mono text-emerald-700">{report.appointmentReport.completed}</strong></div>
            <div className="flex justify-between py-1"><span>Cancelled</span><strong className="font-mono text-amber-700">{report.appointmentReport.cancelled}</strong></div>
            <div className="flex justify-between py-1"><span>No Show</span><strong className="font-mono text-red-700">{report.appointmentReport.noShow}</strong></div>
            <div className="flex justify-between py-1"><span>Walk-Ins Logged</span><strong className="font-mono">{report.appointmentReport.walkIns}</strong></div>
          </div>
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-2 text-xs">
            <h4 className="font-bold text-sm">Customer Retention</h4>
            <div className="flex justify-between py-1"><span>Registered Customers</span><strong className="font-mono">{report.customerReport.totalCustomers}</strong></div>
            <div className="flex justify-between py-1"><span>Returning Clients (2+ visits)</span><strong className="font-mono">{report.customerReport.returningCustomers}</strong></div>
            <div className="pt-2 border-t border-[#1D1717]/10">
              <div className="font-semibold mb-1">Top Customers</div>
              {report.customerReport.topCustomers.slice(0, 4).map((c) => (
                <div key={c.id} className="flex justify-between py-1">
                  <span>{c.fullName}</span>
                  <span className="font-mono">{formatUGX(c.totalSpent)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-2 text-xs">
            <h4 className="font-bold text-sm">Inventory Valuation</h4>
            <div className="flex justify-between py-1"><span>Total SKUs</span><strong className="font-mono">{report.inventoryReport.totalSkus}</strong></div>
            <div className="flex justify-between py-1"><span>Stock Cost Value</span><strong className="font-mono">{formatUGX(report.inventoryReport.inventoryCostValuation)}</strong></div>
            <div className="flex justify-between py-1"><span>Period Movements</span><strong className="font-mono">{report.inventoryReport.movementsCount}</strong></div>
            <div className="flex justify-between py-1"><span>Low-Stock Items</span><strong className="font-mono text-red-700">{report.inventoryReport.lowStockItems.length}</strong></div>
          </div>
        </div>
      )}
    </div>
  );
};

const PnLRow: React.FC<{ label: string; value: string; bold?: boolean; highlight?: boolean }> = ({
  label,
  value,
  bold,
  highlight,
}) => (
  <div
    className={`py-3 px-2 flex items-center justify-between gap-4 ${
      highlight ? 'bg-[#F3BFD3]/45 rounded-xl px-4 font-bold text-[#1D1717]' : bold ? 'font-bold' : ''
    }`}
  >
    <span>{label}</span>
    <span className={`font-mono tabular-nums ${highlight ? 'text-[#E83B84] text-base' : ''}`}>{value}</span>
  </div>
);

function formatCompactUGX(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }
  return String(value);
}

const MonthlyRevenueExpensesChart: React.FC<{
  data: MonthlyTrendPoint[];
  filteredByEmployee: boolean;
}> = ({ data, filteredByEmployee }) => {
  const totalRev6M = data.reduce((sum, pt) => sum + pt.revenue, 0);
  const totalExp6M = data.reduce((sum, pt) => sum + pt.expenses, 0);
  const net6M = totalRev6M - totalExp6M;
  const hasAnyData = totalRev6M > 0 || totalExp6M > 0;
  const periodLabel =
    data.length >= 2 ? `${data[0].label} – ${data[data.length - 1].label}` : 'Past 6 Months';

  return (
    <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-[#1D1717]">
            Monthly Revenue vs. Operational Expenses (6-Month Trend)
          </h3>
          <p className="text-xs text-[#1D1717]/60 mt-0.5">
            {periodLabel} &middot;{' '}
            {filteredByEmployee
              ? 'Revenue filtered for selected stylist; expenses reflect salon-wide operations'
              : 'Billed POS revenue compared against approved and active operational expenses'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-[#1D1717]/80 shrink-0">
          <span>
            6M Revenue: <strong className="text-[#E83B84]">{formatUGX(totalRev6M)}</strong>
          </span>
          <span aria-hidden="true" className="text-[#1D1717]/25">&middot;</span>
          <span>
            6M Expenses: <strong className="text-[#1D1717]">{formatUGX(totalExp6M)}</strong>
          </span>
          <span aria-hidden="true" className="text-[#1D1717]/25">&middot;</span>
          <span>
            Spread:{' '}
            <strong className={net6M >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {formatUGX(net6M)}
            </strong>
          </span>
        </div>
      </div>

      {!hasAnyData && (
        <div className="px-4 py-2.5 rounded-xl bg-[#F8EEEB] text-xs text-[#1D1717]/75">
          No POS sales or operating expenses have been logged in this 6-month window yet. Monthly
          points update automatically as transactions and expenses are recorded.
        </div>
      )}

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(29, 23, 23, 0.08)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: '#1D1717', fontSize: 12, opacity: 0.7 }}
              axisLine={{ stroke: 'rgba(29, 23, 23, 0.15)' }}
              tickLine={false}
              dy={6}
            />
            <YAxis
              tickFormatter={formatCompactUGX}
              tick={{ fill: '#1D1717', fontSize: 11, opacity: 0.65, fontFamily: 'monospace' }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const pt = payload[0].payload as MonthlyTrendPoint;
                const diff = pt.revenue - pt.expenses;
                return (
                  <div className="bg-white border border-[#1D1717]/15 rounded-xl p-3.5 shadow-sm text-xs space-y-1.5 min-w-[210px]">
                    <div className="font-bold text-[#1D1717] border-b border-[#1D1717]/10 pb-1">
                      {label}
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#1D1717]/75">Monthly Revenue</span>
                      <span className="font-mono tabular-nums font-bold text-[#E83B84]">
                        {formatUGX(pt.revenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 text-[11px] text-[#1D1717]/55 pl-2">
                      <span>Services / Retail</span>
                      <span className="font-mono tabular-nums">
                        {formatCompactUGX(pt.serviceRevenue)} / {formatCompactUGX(pt.retailRevenue)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[#1D1717]/75">Operational Expenses</span>
                      <span className="font-mono tabular-nums font-bold text-[#1D1717]">
                        {formatUGX(pt.expenses)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-[#1D1717]/10 pt-1">
                      <span className="font-semibold text-[#1D1717]">Net Spread</span>
                      <span
                        className={`font-mono tabular-nums font-bold ${
                          diff >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {formatUGX(diff)}
                      </span>
                    </div>
                  </div>
                );
              }}
            />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="line"
              wrapperStyle={{ fontSize: '12px', paddingBottom: '10px' }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              name="Monthly Revenue (UGX)"
              stroke="#E83B84"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: '#E83B84', strokeWidth: 0 }}
              activeDot={{ r: 5.5, fill: '#E83B84', stroke: '#FFFFFF', strokeWidth: 2 }}
            />
            <Line
              type="monotone"
              dataKey="expenses"
              name="Operational Expenses (UGX)"
              stroke="#1D1717"
              strokeWidth={2.25}
              strokeDasharray="5 4"
              dot={{ r: 3.5, fill: '#1D1717', strokeWidth: 0 }}
              activeDot={{ r: 5.5, fill: '#1D1717', stroke: '#FFFFFF', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
