import React, { useEffect, useState } from 'react';
import { Wallet, Plus, CheckCircle2, FileDown } from 'lucide-react';
import { apiFetch, exportReportToPdf, formatUGX } from '../lib/api';
import { getSalonTodayIso } from '../lib/date';
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

export const CommissionsView: React.FC<CommissionsViewProps> = ({ mode, user }) => {
  const [policies, setPolicies] = useState<CommissionPolicy[]>([]);
  const [ledger, setLedger] = useState<CommissionLedgerEntry[]>([]);
  const [lunchDeductions, setLunchDeductions] = useState<LunchDeductionRecord[]>([]);
  const [payments, setPayments] = useState<CommissionPaymentRecord[]>([]);
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Policy modal (Owner only)
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [effDate, setEffDate] = useState(() => getSalonTodayIso());
  const [plaitingPct, setPlaitingPct] = useState(50);
  const [blowDryPct, setBlowDryPct] = useState(30);
  const [otherPct, setOtherPct] = useState(40);
  const [lunchAmt, setLunchAmt] = useState(2500);
  const [lunchMethod, setLunchMethod] = useState<CommissionPolicy['lunchAllocationMethod']>('proportional');

  // Commission payment modal
  const [payEmp, setPayEmp] = useState<SummaryRow | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('Cash');
  const [payDate, setPayDate] = useState(() => getSalonTodayIso());
  const [payNotes, setPayNotes] = useState('');

  // Commission adjustment modal (Owner only)
  const [showAdjModal, setShowAdjModal] = useState(false);
  const [adjEmpId, setAdjEmpId] = useState('');
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
      }>('/api/commissions');
      setPolicies(res.policies);
      setLedger(res.ledger);
      setLunchDeductions(res.lunchDeductions);
      setPayments(res.payments);
      setSummaries(res.summaries);
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
    if (!payEmp) return;
    setError('');
    try {
      await apiFetch('/api/commission-payments', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: payEmp.employeeId,
          amount: payAmount,
          paymentDate: payDate,
          paymentMethod: payMethod,
          notes: payNotes,
        }),
      });
      setPayEmp(null);
      setPayNotes('');
      setMsg(`Recorded commission payment of ${formatUGX(payAmount)} to ${payEmp.employeeName}.`);
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
          amount: adjAmount,
          reason: adjReason,
        }),
      });
      setShowAdjModal(false);
      setAdjReason('');
      setAdjAmount(0);
      setMsg('Commission adjustment recorded in audit log.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed.');
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {msg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
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
                deducted once per working day BEFORE commission &middot; Allocation method:{' '}
                <span className="font-semibold capitalize">{activePolicy?.lunchAllocationMethod?.replace(/_/g, ' ') || 'proportional'}</span>
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
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">Detailed Commission Ledger</h3>
              <button
                onClick={() =>
                  exportReportToPdf(
                    'Commission Ledger Report',
                    'Trendy Unisex Salon',
                    ['Date', 'Ref', 'Employee', 'Service', 'Gross', 'Lunch Alloc', 'Net Base', 'Rate', 'Commission', 'Salon Share'],
                    ledger.map((l) => [
                      l.date,
                      l.transactionReference,
                      l.employeeName,
                      l.serviceName,
                      formatUGX(l.grossEarnings),
                      formatUGX(l.lunchAllocation),
                      formatUGX(l.netCommissionableEarnings),
                      `${Math.round(l.commissionRate * 100)}%`,
                      formatUGX(l.employeeCommission),
                      formatUGX(l.salonShare),
                    ])
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1D1717]/15 text-xs font-semibold hover:bg-[#F8EEEB] cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" /> Export PDF
              </button>
            </div>

            {ledger.length === 0 ? (
              <p className="text-sm text-[#1D1717]/60 py-8 text-center">
                No commission entries yet. Complete a service transaction in POS to generate automatic commission rows.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                      <th className="py-3 px-2.5">Date &amp; Ref</th>
                      <th className="py-3 px-2.5">Employee</th>
                      <th className="py-3 px-2.5">Service (Category)</th>
                      <th className="py-3 px-2.5 text-right">Gross</th>
                      <th className="py-3 px-2.5 text-right">Lunch Alloc</th>
                      <th className="py-3 px-2.5 text-right">Net Base</th>
                      <th className="py-3 px-2.5 text-right">Rate</th>
                      <th className="py-3 px-2.5 text-right">Employee Comm.</th>
                      <th className="py-3 px-2.5 text-right">Salon Share</th>
                      <th className="py-3 px-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D1717]/10">
                    {ledger.map((row) => (
                      <tr key={row.id} className="hover:bg-[#F8EEEB]/50">
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
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-[#1D1717]/70">
                          -{formatUGX(row.lunchAllocation)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-semibold">
                          {formatUGX(row.netCommissionableEarnings)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono">
                          {Math.round(row.commissionRate * 100)}%
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums font-bold text-[#E83B84]">
                          {formatUGX(row.employeeCommission)}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums">
                          {formatUGX(row.salonShare)}
                        </td>
                        <td className="py-2.5 px-2.5 font-semibold">{row.paymentStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* COMMISSION PAYMENTS */}
      {mode === 'payments' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
            <h3 className="text-base font-bold flex items-center gap-2">
              <Wallet className="w-4 h-4 text-[#E83B84]" /> Employee Commission Balances
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-3 px-3">Employee</th>
                    <th className="py-3 px-3 text-right">Gross Services</th>
                    <th className="py-3 px-3 text-right">Lunch Deducted</th>
                    <th className="py-3 px-3 text-right">Total Commission</th>
                    <th className="py-3 px-3 text-right">Paid to Date</th>
                    <th className="py-3 px-3 text-right">Outstanding</th>
                    {['owner', 'manager'].includes(user.role) && (
                      <th className="py-3 px-3 text-right">Action</th>
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
                            disabled={s.outstandingBalance <= 0}
                            onClick={() => {
                              setPayEmp(s);
                              setPayAmount(s.outstandingBalance);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#E83B84] text-white font-semibold disabled:opacity-40 cursor-pointer"
                          >
                            Pay Commission
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                      <th className="py-2.5 px-3">Date</th>
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
                        <td className="py-2.5 px-3 font-mono">{p.paymentDate}</td>
                        <td className="py-2.5 px-3 font-semibold">{p.employeeName}</td>
                        <td className="py-2.5 px-3">{p.paymentMethod}</td>
                        <td className="py-2.5 px-3">{p.paidByName}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700">
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
              UGX 2,500 is deducted exactly once per eligible employee per working day BEFORE commission calculation, never per customer.
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
                    <th className="py-3 px-3 text-right">Gross Daily Earnings</th>
                    <th className="py-3 px-3 text-right">Lunch Deducted (Once/Day)</th>
                    <th className="py-3 px-3">Allocation Method</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {lunchDeductions.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 px-3 font-mono">{l.date}</td>
                      <td className="py-2.5 px-3 font-semibold">{l.employeeName}</td>
                      <td className="py-2.5 px-3 text-right font-mono">{formatUGX(l.grossDailyEarnings)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-[#E83B84]">
                        {formatUGX(l.amount)}
                      </td>
                      <td className="py-2.5 px-3 capitalize">{l.allocationMethod.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pay Commission Modal */}
      {payEmp && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordPayment}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold">Pay Commission — {payEmp.employeeName}</h3>
            <p className="text-[#1D1717]/70">
              Outstanding Commission Balance:{' '}
              <strong className="font-mono text-[#E83B84]">{formatUGX(payEmp.outstandingBalance)}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Amount (UGX) *</label>
                <input
                  type="number"
                  min={1}
                  max={payEmp.outstandingBalance}
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
            <div>
              <label className="block font-semibold mb-1">Payment Date</label>
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
              />
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
                onClick={() => setPayEmp(null)}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Daily Lunch (UGX)</label>
                <input
                  type="number"
                  value={lunchAmt}
                  onChange={(e) => setLunchAmt(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Lunch Allocation</label>
                <select
                  value={lunchMethod}
                  onChange={(e) => setLunchMethod(e.target.value as CommissionPolicy['lunchAllocationMethod'])}
                  className="w-full px-2 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                >
                  <option value="proportional">Proportional</option>
                  <option value="highest_earning_category">Highest Earning First</option>
                  <option value="lowest_rate_first">Lowest Rate First</option>
                </select>
              </div>
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
