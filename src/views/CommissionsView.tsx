import React, { useEffect, useState } from 'react';
import { Wallet, CheckCircle2, FileDown, Calendar } from 'lucide-react';
import { apiFetch, exportReportToPdf, formatUGX } from '../lib/api';
import { getSalonTodayIso, msUntilNextSalonMidnight } from '../lib/date';
import type {
  CommissionLedgerEntry,
  CommissionPaymentRecord,
  CommissionPolicy,
  EmployeeSummary,
  LunchDeductionRecord,
  PaymentMethod,
  SessionUser,
} from '../types';

interface CommissionsViewProps {
  mode: 'commissions' | 'payments' | 'lunch';
  user: SessionUser;
}

interface SummaryRow extends EmployeeSummary {
  employeeId: string;
  employeeName: string;
  roleTitle?: string;
}

interface DailyBalanceRow {
  employeeId: string;
  employeeName: string;
  roleTitle?: string;
  date: string;
  grossEarnings: number;
  totalLunchDeducted: number;
  netCommissionable: number;
  totalCommissionEarned: number;
  totalPaid: number;
  outstandingBalance: number;
  totalSalonShare: number;
  directTips: number;
  servicesCount: number;
}

export const CommissionsView: React.FC<CommissionsViewProps> = ({ mode, user }) => {
  const [today, setToday] = useState(() => getSalonTodayIso());
  const [policies, setPolicies] = useState<CommissionPolicy[]>([]);
  const [ledger, setLedger] = useState<CommissionLedgerEntry[]>([]);
  const [lunchDeductions, setLunchDeductions] = useState<LunchDeductionRecord[]>([]);
  const [payments, setPayments] = useState<CommissionPaymentRecord[]>([]);
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [dailyBalances, setDailyBalances] = useState<DailyBalanceRow[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Date-scoped filtering & payout mode
  const [ledgerDateFilter, setLedgerDateFilter] = useState('');
  const [payoutView, setPayoutView] = useState<'by_date' | 'unpaid_days' | 'all_time'>('by_date');
  const [selectedPayoutDate, setSelectedPayoutDate] = useState(() => getSalonTodayIso());

  // Policy modal (Owner only)
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [effDate, setEffDate] = useState(() => getSalonTodayIso());
  const [plaitingPct, setPlaitingPct] = useState(50);
  const [blowDryPct, setBlowDryPct] = useState(30);
  const [otherPct, setOtherPct] = useState(40);
  const [lunchAmt, setLunchAmt] = useState(2500);
  const [lunchMethod, setLunchMethod] = useState<CommissionPolicy['lunchAllocationMethod']>('proportional');

  // Date-scoped Commission payment modal
  const [payTarget, setPayTarget] = useState<DailyBalanceRow | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [payDate, setPayDate] = useState(() => getSalonTodayIso());
  const [payNotes, setPayNotes] = useState('');

  // Commission adjustment modal (Owner only)
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjEmpId, setAdjEmpId] = useState('');
  const [adjDate, setAdjDate] = useState(() => getSalonTodayIso());
  const [adjAmount, setAdjAmount] = useState(0);
  const [adjReason, setAdjReason] = useState('');

  const load = async () => {
    try {
      const res = await apiFetch<{
        policies: CommissionPolicy[];
        ledger: CommissionLedgerEntry[];
        lunchDeductions: LunchDeductionRecord[];
        payments: CommissionPaymentRecord[];
        summaries: SummaryRow[];
        dailyBalances?: DailyBalanceRow[];
      }>('/api/commissions');
      setPolicies(res.policies);
      setLedger(res.ledger);
      setLunchDeductions(res.lunchDeductions);
      setPayments(res.payments);
      setSummaries(res.summaries);
      setDailyBalances(res.dailyBalances || []);
      if (res.summaries.length > 0 && !adjEmpId) {
        setAdjEmpId(res.summaries[0].employeeId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commission records.');
    }
  };

  useEffect(() => {
    void load();
  }, [mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextToday = getSalonTodayIso();
      if (nextToday !== today) {
        setToday(nextToday);
        setSelectedPayoutDate((prev) => (prev === today ? nextToday : prev));
        setPayDate((prev) => (prev === today ? nextToday : prev));
      }
    }, msUntilNextSalonMidnight());
    return () => window.clearTimeout(timer);
  }, [today]);

  const activePolicy = policies[policies.length - 1];

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/commission-policies', {
        method: 'POST',
        body: JSON.stringify({
          effectiveDate: effDate,
          plaitingRate: plaitingPct / 100,
          blowDryRate: blowDryPct / 100,
          defaultOtherRate: otherPct / 100,
          lunchDeductionAmount: lunchAmt,
          lunchAllocationMethod: lunchMethod,
        }),
      });
      setShowPolicyModal(false);
      setMsg(`New commission policy created effective ${effDate} (historical records untouched).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save policy.');
    }
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payTarget) return;
    setError('');
    try {
      await apiFetch('/api/commission-payments', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: payTarget.employeeId,
          commissionDate: payTarget.date,
          amount: payAmount,
          paymentDate: payDate,
          paymentMethod: payMethod,
          notes: payNotes,
        }),
      });
      setPayTarget(null);
      setPayNotes('');
      setMsg(
        `Recorded ${formatUGX(payAmount)} payout to ${payTarget.employeeName} for ${payTarget.date} commission (paid on ${payDate}).`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/commission-adjustments', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: adjEmpId,
          date: adjDate,
          amount: adjAmount,
          reason: adjReason,
        }),
      });
      setShowAdjModal(false);
      setAdjReason('');
      setAdjAmount(0);
      setMsg(`Commission adjustment for ${adjDate} recorded in audit log.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed.');
    }
  };

  const filteredLedger = ledgerDateFilter
    ? ledger.filter((row) => row.date === ledgerDateFilter)
    : ledger;

  const dailyBalanceLookup = new Map<string, DailyBalanceRow>();
  for (const row of dailyBalances) {
    dailyBalanceLookup.set(`${row.date}|${row.employeeId}`, row);
  }

  // Group ledger rows by (date, employeeId) so lunch is shown deducted once per daily total, never per sale
  const groupedLedgerDays = Array.from(
    filteredLedger
      .reduce((map, row) => {
        const key = `${row.date}|${row.employeeId}`;
        const existing = map.get(key);
        if (existing) {
          existing.rows.push(row);
        } else {
          map.set(key, {
            key,
            date: row.date,
            employeeId: row.employeeId,
            employeeName: row.employeeName,
            rows: [row],
          });
        }
        return map;
      }, new Map<string, { key: string; date: string; employeeId: string; employeeName: string; rows: CommissionLedgerEntry[] }>())
      .values()
  ).sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName));

  const selectedDateRows = dailyBalances.filter((row) => row.date === selectedPayoutDate);
  const unpaidDayRows = dailyBalances.filter((row) => row.outstandingBalance > 0);
  const unpaidDateTotals = Array.from(
    unpaidDayRows.reduce((map, row) => {
      map.set(row.date, (map.get(row.date) || 0) + row.outstandingBalance);
      return map;
    }, new Map<string, number>())
  ).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="space-y-6">
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {msg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {/* COMMISSION MANAGEMENT */}
      {mode === 'commissions' && (
        <>
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-[#E83B84]">
                ACTIVE COMMISSION &amp; LUNCH POLICY (Effective {activePolicy?.effectiveDate || '2026-01-01'})
              </div>
              <h2 className="text-lg font-bold text-[#1D1717]">
                Plaiting Hair {Math.round((activePolicy?.plaitingRate ?? 0.5) * 100)}% &middot; Blow Dry{' '}
                {Math.round((activePolicy?.blowDryRate ?? 0.3) * 100)}% &middot; Other Services{' '}
                {Math.round((activePolicy?.defaultOtherRate ?? 0.4) * 100)}%
              </h2>
              <p className="text-xs text-[#1D1717]/70">
                Daily Lunch Deduction: <span className="font-mono font-semibold">{formatUGX(activePolicy?.lunchDeductionAmount ?? 2500)}</span>{' '}
                deducted ONCE from total daily sales BEFORE calculating commission (never deducted on every individual sale).
              </p>
            </div>

            {user.role === 'owner' && (
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  onClick={() => setShowAdjModal(true)}
                  className="px-3.5 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold hover:bg-[#F8EEEB] cursor-pointer"
                >
                  Record Adjustment
                </button>
                <button
                  onClick={() => setShowPolicyModal(true)}
                  className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
                >
                  Update Policy (New Effective Date)
                </button>
              </div>
            )}
          </div>

          {/* Commission Ledger Table */}
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">Detailed Commission Ledger</h3>
                <p className="text-xs text-[#1D1717]/60 mt-0.5">
                  Individual sales record gross service amounts; daily lunch is deducted once per employee on total daily sales below each day&rsquo;s services.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-[#F8EEEB] border border-[#1D1717]/10 rounded-xl px-2.5 py-1 text-xs">
                  <Calendar className="w-3.5 h-3.5 text-[#E83B84]" />
                  <input
                    type="date"
                    value={ledgerDateFilter}
                    onChange={(e) => setLedgerDateFilter(e.target.value)}
                    aria-label="Filter commission ledger by date"
                    className="bg-transparent focus:outline-none font-mono"
                  />
                  {ledgerDateFilter && (
                    <button
                      type="button"
                      onClick={() => setLedgerDateFilter('')}
                      className="px-2 py-0.5 rounded-md bg-white border border-[#1D1717]/15 text-[11px] font-semibold text-[#1D1717] hover:bg-[#F3BFD3]/40 cursor-pointer"
                    >
                      All Dates
                    </button>
                  )}
                </div>
                <button
                  onClick={() =>
                    exportReportToPdf(
                      'Commission Ledger Report',
                      'Trendy Unisex Salon',
                      ['Date', 'Ref', 'Employee', 'Service', 'Sale Amount', 'Rate', 'Service Comm.', 'Status'],
                      filteredLedger.map((l) => [
                        l.date,
                        l.transactionReference,
                        l.employeeName,
                        l.serviceName,
                        formatUGX(l.grossEarnings),
                        `${Math.round(l.commissionRate * 100)}%`,
                        formatUGX(l.employeeCommission),
                        l.paymentStatus,
                      ]),
                      groupedLedgerDays.slice(0, 25).map((grp) => {
                        const dayBal = dailyBalanceLookup.get(grp.key);
                        const gross = dayBal?.grossEarnings ?? grp.rows.reduce((s, r) => s + r.grossEarnings, 0);
                        const lunch = dayBal?.totalLunchDeducted ?? 0;
                        const net = dayBal?.netCommissionable ?? Math.max(0, gross - lunch);
                        const comm = dayBal?.totalCommissionEarned ?? grp.rows.reduce((s, r) => s + r.employeeCommission, 0);
                        return `${grp.date} | ${grp.employeeName}: Daily Sales ${formatUGX(gross)} - Lunch ${formatUGX(lunch)} = Net Base ${formatUGX(net)} -> Daily Commission ${formatUGX(comm)}`;
                      })
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1D1717]/15 text-xs font-semibold hover:bg-[#F8EEEB] cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> Export PDF
                </button>
              </div>
            </div>

            {filteredLedger.length === 0 ? (
              <p className="text-sm text-[#1D1717]/60 py-8 text-center">
                {ledgerDateFilter
                  ? `No commission entries found on ${ledgerDateFilter}.`
                  : 'No commission entries yet. Complete a service transaction in POS to generate automatic commission rows.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                      <th className="py-3 px-2.5">Date &amp; Ref</th>
                      <th className="py-3 px-2.5">Employee</th>
                      <th className="py-3 px-2.5">Service (Category)</th>
                      <th className="py-3 px-2.5 text-right">Sale Amount</th>
                      <th className="py-3 px-2.5 text-right">Rate</th>
                      <th className="py-3 px-2.5 text-right">Service Comm.</th>
                      <th className="py-3 px-2.5 text-right">Salon Share</th>
                      <th className="py-3 px-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D1717]/10">
                    {groupedLedgerDays.map((group) => {
                      const dayBal = dailyBalanceLookup.get(group.key);
                      const dailyGross = dayBal?.grossEarnings ?? group.rows.reduce((s, r) => s + r.grossEarnings, 0);
                      const dailyLunch = dayBal?.totalLunchDeducted ?? 0;
                      const dailyNet = dayBal?.netCommissionable ?? Math.max(0, dailyGross - dailyLunch);
                      const dailyComm = dayBal?.totalCommissionEarned ?? group.rows.reduce((s, r) => s + r.employeeCommission, 0);
                      const dailySalon = dayBal?.totalSalonShare ?? group.rows.reduce((s, r) => s + r.salonShare, 0);
                      const allPaid = dayBal ? dayBal.outstandingBalance === 0 && dailyComm > 0 : group.rows.every((r) => r.paymentStatus === 'Paid');

                      return (
                        <React.Fragment key={group.key}>
                          {group.rows.map((row) => (
                            <tr key={row.id} className="hover:bg-[#F8EEEB]/40">
                              <td className="py-2.5 px-2.5 font-mono">
                                <div>{row.date}</div>
                                <div className="text-[11px] text-[#1D1717]/55">{row.transactionReference}</div>
                              </td>
                              <td className="py-2.5 px-2.5 font-semibold">{row.employeeName}</td>
                              <td className="py-2.5 px-2.5">
                                <div>{row.serviceName}</div>
                                <div className="text-[11px] text-[#1D1717]/55">{row.serviceCategory}</div>
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                                {formatUGX(row.grossEarnings)}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono">
                                {Math.round(row.commissionRate * 100)}%
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#1D1717]/80">
                                {formatUGX(row.employeeCommission)}
                              </td>
                              <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#1D1717]/70">
                                {formatUGX(row.salonShare)}
                              </td>
                              <td className="py-2.5 px-2.5 font-semibold">{row.paymentStatus}</td>
                            </tr>
                          ))}
                          <tr className="bg-[#F8EEEB]/75 border-b-2 border-[#1D1717]/15">
                            <td colSpan={3} className="py-2.5 px-2.5 text-[11px] font-semibold text-[#1D1717]">
                              <span>Daily Summary &mdash; {group.employeeName} ({group.date})</span>
                              <span className="ml-2 font-normal text-[#1D1717]/65">
                                Total Daily Sales {formatUGX(dailyGross)} &minus; Daily Lunch {formatUGX(dailyLunch)} = Net Base{' '}
                                <strong className="font-mono text-[#1D1717]">{formatUGX(dailyNet)}</strong>
                              </span>
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-bold text-[#1D1717]">
                              {formatUGX(dailyGross)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono text-[11px] text-[#1D1717]/65">
                              {dailyLunch > 0 ? `-${formatUGX(dailyLunch)} lunch` : 'No lunch'}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-bold text-[#E83B84]">
                              {formatUGX(dailyComm)}
                            </td>
                            <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold text-[#1D1717]">
                              {formatUGX(dailySalon)}
                            </td>
                            <td className="py-2.5 px-2.5 text-[11px] font-bold">
                              {allPaid ? (
                                <span className="text-emerald-700">Paid</span>
                              ) : dayBal && dayBal.totalPaid > 0 ? (
                                <span className="text-amber-700">Bal {formatUGX(dayBal.outstandingBalance)}</span>
                              ) : (
                                <span className="text-[#E83B84]">Unpaid</span>
                              )}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* COMMISSION PAYMENTS (STRICTLY DATE-ISOLATED) */}
      {mode === 'payments' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-[#E83B84]" />
                  <span>Daily Commission Balances &amp; Payouts</span>
                </h3>
                <p className="text-xs text-[#1D1717]/60 mt-0.5">
                  Commissions are settled strictly by earning date so yesterday&rsquo;s balance never mixes with today&rsquo;s when paying out.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {payoutView === 'by_date' && (
                  <div className="flex items-center gap-1.5 bg-[#F8EEEB] border border-[#1D1717]/10 rounded-xl px-2.5 py-1 text-xs">
                    <Calendar className="w-3.5 h-3.5 text-[#E83B84]" />
                    <input
                      type="date"
                      value={selectedPayoutDate}
                      onChange={(e) => {
                        if (e.target.value) setSelectedPayoutDate(e.target.value);
                      }}
                      aria-label="Select commission earning date"
                      className="bg-transparent focus:outline-none font-mono"
                    />
                    {selectedPayoutDate !== today && (
                      <button
                        type="button"
                        onClick={() => setSelectedPayoutDate(today)}
                        className="px-2 py-0.5 rounded-md bg-white border border-[#1D1717]/15 text-[11px] font-semibold text-[#1D1717] hover:bg-[#F3BFD3]/40 cursor-pointer whitespace-nowrap"
                      >
                        Today
                      </button>
                    )}
                  </div>
                )}

                <div className="inline-flex items-center gap-1 bg-[#F8EEEB] p-1 rounded-xl border border-[#1D1717]/10 text-xs">
                  <button
                    type="button"
                    onClick={() => setPayoutView('by_date')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      payoutView === 'by_date'
                        ? 'bg-[#E83B84] text-white'
                        : 'text-[#1D1717]/70 hover:text-[#1D1717]'
                    }`}
                  >
                    Selected Date
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutView('unpaid_days')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      payoutView === 'unpaid_days'
                        ? 'bg-[#E83B84] text-white'
                        : 'text-[#1D1717]/70 hover:text-[#1D1717]'
                    }`}
                  >
                    All Unpaid Days ({unpaidDayRows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutView('all_time')}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      payoutView === 'all_time'
                        ? 'bg-[#E83B84] text-white'
                        : 'text-[#1D1717]/70 hover:text-[#1D1717]'
                    }`}
                  >
                    All-Time Totals
                  </button>
                </div>
              </div>
            </div>

            {/* Quick switcher for any dates with unpaid commissions */}
            {unpaidDateTotals.length > 0 && payoutView === 'by_date' && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1D1717]/10 text-xs">
                <span className="text-[#1D1717]/60">Dates with unpaid commissions:</span>
                {unpaidDateTotals.map(([d, amt]) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSelectedPayoutDate(d)}
                    className={`px-2.5 py-1 rounded-lg border font-mono tabular-nums text-[11px] font-semibold cursor-pointer whitespace-nowrap transition-colors ${
                      selectedPayoutDate === d
                        ? 'bg-[#E83B84] text-white border-[#E83B84]'
                        : 'bg-[#F8EEEB]/60 hover:bg-[#F3BFD3]/50 text-[#1D1717] border-[#1D1717]/10'
                    }`}
                  >
                    {d === today ? `Today (${d})` : d} &middot; {formatUGX(amt)}
                  </button>
                ))}
              </div>
            )}

            {/* Selected Date Table */}
            {payoutView === 'by_date' && (
              selectedDateRows.length === 0 ? (
                <div className="py-8 px-4 text-center border border-dashed border-[#1D1717]/15 rounded-xl bg-[#F8EEEB]/35 space-y-2.5">
                  <p className="text-xs text-[#1D1717]/70">
                    No commission earnings or payouts recorded for{' '}
                    <span className="font-mono font-semibold">{selectedPayoutDate}</span>.
                  </p>
                  {unpaidDayRows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPayoutView('unpaid_days')}
                      className="px-3.5 py-1.5 rounded-lg bg-[#E83B84] text-white text-xs font-semibold hover:bg-[#d12d73] cursor-pointer"
                    >
                      View Unpaid Days ({unpaidDayRows.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                        <th className="py-3 px-3">Employee</th>
                        <th className="py-3 px-3">Earning Date</th>
                        <th className="py-3 px-3 text-right">Gross Services</th>
                        <th className="py-3 px-3 text-right">Lunch Deducted</th>
                        <th className="py-3 px-3 text-right">Earned ({selectedPayoutDate})</th>
                        <th className="py-3 px-3 text-right">Paid ({selectedPayoutDate})</th>
                        <th className="py-3 px-3 text-right">Outstanding ({selectedPayoutDate})</th>
                        {['owner', 'manager'].includes(user.role) && (
                          <th className="py-3 px-3 text-right">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1D1717]/10">
                      {selectedDateRows.map((row) => (
                        <tr key={`${row.employeeId}-${row.date}`} className="hover:bg-[#F8EEEB]/50">
                          <td className="py-3 px-3 font-semibold">{row.employeeName}</td>
                          <td className="py-3 px-3 font-mono text-[#1D1717]/75">{row.date}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatUGX(row.grossEarnings)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatUGX(row.totalLunchDeducted)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                            {formatUGX(row.totalCommissionEarned)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                            {formatUGX(row.totalPaid)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#E83B84]">
                            {formatUGX(row.outstandingBalance)}
                          </td>
                          {['owner', 'manager'].includes(user.role) && (
                            <td className="py-3 px-3 text-right">
                              <button
                                disabled={row.outstandingBalance <= 0}
                                onClick={() => {
                                  setPayTarget(row);
                                  setPayAmount(row.outstandingBalance);
                                  setPayDate(today);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-[#E83B84] text-white font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap"
                              >
                                {row.outstandingBalance > 0 ? `Pay ${row.date}` : 'Settled'}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* All Unpaid Days (Separated Strictly by Date) */}
            {payoutView === 'unpaid_days' && (
              unpaidDayRows.length === 0 ? (
                <div className="py-8 text-center text-xs text-emerald-700 border border-dashed border-emerald-200 rounded-xl bg-emerald-50/40">
                  All daily commissions across all dates are fully paid.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                        <th className="py-3 px-3">Earning Date</th>
                        <th className="py-3 px-3">Employee</th>
                        <th className="py-3 px-3 text-right">Gross Services</th>
                        <th className="py-3 px-3 text-right">Lunch</th>
                        <th className="py-3 px-3 text-right">Earned That Day</th>
                        <th className="py-3 px-3 text-right">Paid That Day</th>
                        <th className="py-3 px-3 text-right">Unpaid Balance</th>
                        {['owner', 'manager'].includes(user.role) && (
                          <th className="py-3 px-3 text-right">Action</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1D1717]/10">
                      {unpaidDayRows.map((row) => (
                        <tr key={`${row.employeeId}-${row.date}`} className="hover:bg-[#F8EEEB]/50">
                          <td className="py-3 px-3 font-mono font-semibold text-[#1D1717]">{row.date}</td>
                          <td className="py-3 px-3 font-semibold">{row.employeeName}</td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatUGX(row.grossEarnings)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatUGX(row.totalLunchDeducted)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                            {formatUGX(row.totalCommissionEarned)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                            {formatUGX(row.totalPaid)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#E83B84]">
                            {formatUGX(row.outstandingBalance)}
                          </td>
                          {['owner', 'manager'].includes(user.role) && (
                            <td className="py-3 px-3 text-right">
                              <button
                                onClick={() => {
                                  setPayTarget(row);
                                  setPayAmount(row.outstandingBalance);
                                  setPayDate(today);
                                }}
                                className="px-3 py-1.5 rounded-lg bg-[#E83B84] text-white font-semibold cursor-pointer whitespace-nowrap"
                              >
                                Pay {row.date}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {/* All-Time Cumulative Reference */}
            {payoutView === 'all_time' && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                      <th className="py-3 px-3">Employee</th>
                      <th className="py-3 px-3 text-right">Gross Services</th>
                      <th className="py-3 px-3 text-right">Lunch Deducted</th>
                      <th className="py-3 px-3 text-right">Total Commission</th>
                      <th className="py-3 px-3 text-right">Paid to Date</th>
                      <th className="py-3 px-3 text-right">Total Unpaid</th>
                      {['owner', 'manager'].includes(user.role) && (
                        <th className="py-3 px-3 text-right">Pay by Date</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D1717]/10">
                    {summaries.map((s) => (
                      <tr key={s.employeeId} className="hover:bg-[#F8EEEB]/50">
                        <td className="py-3 px-3 font-semibold">{s.employeeName}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">{formatUGX(s.grossEarnings)}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">{formatUGX(s.totalLunchDeducted)}</td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                          {formatUGX(s.totalCommissionEarned)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-emerald-700">
                          {formatUGX(s.totalPaid)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#E83B84]">
                          {formatUGX(s.outstandingBalance)}
                        </td>
                        {['owner', 'manager'].includes(user.role) && (
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              disabled={s.outstandingBalance <= 0}
                              onClick={() => setPayoutView('unpaid_days')}
                              className="px-3 py-1.5 rounded-lg bg-[#1D1717] text-white font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap"
                            >
                              Choose Date
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold">Commission Payment History</h3>
            {payments.length === 0 ? (
              <p className="text-xs text-[#1D1717]/60">No commission payouts recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                      <th className="py-2.5 px-3">Reference</th>
                      <th className="py-2.5 px-3">Commission For</th>
                      <th className="py-2.5 px-3">Paid On</th>
                      <th className="py-2.5 px-3">Employee</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3">Paid By</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D1717]/10">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 px-3 font-mono font-semibold">{p.reference}</td>
                        <td className="py-2.5 px-3 font-mono font-semibold text-[#E83B84]">
                          {p.commissionDate || p.paymentDate}
                        </td>
                        <td className="py-2.5 px-3 font-mono">{p.paymentDate}</td>
                        <td className="py-2.5 px-3 font-semibold">{p.employeeName}</td>
                        <td className="py-2.5 px-3">{p.paymentMethod}</td>
                        <td className="py-2.5 px-3">{p.paidByName}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-emerald-700">
                          {formatUGX(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* LUNCH DEDUCTIONS */}
      {mode === 'lunch' && (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
          <div>
            <h3 className="text-base font-bold">Daily Lunch Deduction Ledger (Once Per Working Day)</h3>
            <p className="text-xs text-[#1D1717]/60 mt-0.5">
              UGX 2,500 is deducted once per eligible employee on total daily sales BEFORE commission calculation, never deducted per sale.
            </p>
          </div>
          {lunchDeductions.length === 0 ? (
            <p className="text-xs text-[#1D1717]/60 py-8 text-center">No lunch deductions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Employee</th>
                    <th className="py-3 px-3 text-right">Total Daily Sales</th>
                    <th className="py-3 px-3 text-right">Lunch Deducted (Once/Day)</th>
                    <th className="py-3 px-3 text-right">Net Daily Sales Base</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {lunchDeductions.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-3 font-mono">{l.date}</td>
                      <td className="py-2.5 px-3 font-semibold">{l.employeeName}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatUGX(l.grossDailyEarnings)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[#E83B84]">
                        -{formatUGX(l.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold">
                        {formatUGX(Math.max(0, l.grossDailyEarnings - l.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pay Commission Modal (Date-Isolated) */}
      {payTarget && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordPayment}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
          >
            <div>
              <h3 className="text-base font-bold">Pay Commission &mdash; {payTarget.employeeName}</h3>
              <p className="text-[#1D1717]/65 mt-0.5">
                Paying strictly for earning date{' '}
                <strong className="font-mono text-[#1D1717]">{payTarget.date}</strong> (isolated from other days).
              </p>
            </div>
            <div className="bg-[#F8EEEB]/60 border border-[#1D1717]/10 rounded-xl p-3 flex items-center justify-between">
              <span className="text-[#1D1717]/75">Unpaid for {payTarget.date}</span>
              <strong className="font-mono tabular-nums text-sm text-[#E83B84]">
                {formatUGX(payTarget.outstandingBalance)}
              </strong>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Amount (UGX) *</label>
                <input
                  type="number"
                  min={1}
                  max={payTarget.outstandingBalance}
                  required
                  value={payAmount}
                  onChange={(e) => setPayAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Payment Method</label>
                <select
                  value={payMethod}
                  onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                >
                  <option value="Cash">Cash</option>
                  <option value="Mobile Money">Mobile Money</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Commission For Date</label>
                <input
                  type="date"
                  value={payTarget.date}
                  disabled
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/10 bg-[#F8EEEB]/60 text-[#1D1717]/70 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Payout Date (Paid On)</label>
                <input
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
            </div>
            <input
              value={payNotes}
              onChange={(e) => setPayNotes(e.target.value)}
              placeholder="Optional payment note or MoMo reference"
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Confirm Payout
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Update Commission Policy Modal */}
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePolicy}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold">Configure New Commission Policy</h3>
            <p className="text-[#1D1717]/65">
              Applies strictly to new transactions from the chosen effective date. Past records remain unchanged.
            </p>
            <div>
              <label className="block font-semibold mb-1">Effective Date *</label>
              <input
                type="date"
                required
                value={effDate}
                onChange={(e) => setEffDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-semibold mb-1">Plaiting %</label>
                <input
                  type="number"
                  value={plaitingPct}
                  onChange={(e) => setPlaitingPct(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Blow Dry %</label>
                <input
                  type="number"
                  value={blowDryPct}
                  onChange={(e) => setBlowDryPct(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Other %</label>
                <input
                  type="number"
                  value={otherPct}
                  onChange={(e) => setOtherPct(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block font-semibold mb-1">Daily Lunch Deduction (UGX, deducted once from total daily sales)</label>
              <input
                type="number"
                value={lunchAmt}
                onChange={(e) => setLunchAmt(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowPolicyModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Save Policy
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Commission Adjustment Modal */}
      {showAdjModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveAdjustment}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold">Record Commission Adjustment</h3>
            <div className="grid grid-cols-2 gap-3">
              <select
                value={adjEmpId}
                onChange={(e) => setAdjEmpId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
              >
                {summaries.map((s) => (
                  <option key={s.employeeId} value={s.employeeId}>
                    {s.employeeName}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={adjDate}
                onChange={(e) => setAdjDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
              />
            </div>
            <input
              type="number"
              required
              value={adjAmount}
              onChange={(e) => setAdjAmount(Number(e.target.value))}
              placeholder="Amount (positive or negative UGX)"
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
            />
            <input
              required
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="Mandatory audit reason..."
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdjModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Apply Adjustment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
