import React, { useEffect, useState } from 'react';
import { Gift, Plus, Search, Ban } from 'lucide-react';
import { apiFetch, formatUGX } from '../lib/api';
import { ConfirmModal } from '../components/ConfirmModal';
import type { CustomerRecord, GiftCardRecord, SessionUser } from '../types';

export const GiftCardsView: React.FC<{ user: SessionUser }> = ({ user }) => {
  const [cards, setCards] = useState<GiftCardRecord[]>([]);
  const [txs, setTxs] = useState<
    Array<{ id: string; code: string; type: string; amount: number; balanceAfter: number; createdAt: string; performedBy: string }>
  >([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [lookupCode, setLookupCode] = useState('');
  const [lookupResult, setLookupResult] = useState<GiftCardRecord | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [custId, setCustId] = useState('');
  const [initialValue, setInitialValue] = useState(50000);
  const [expirationDate, setExpirationDate] = useState('');
  const [cancelTarget, setCancelTarget] = useState<GiftCardRecord | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const [gcRes, cRes] = await Promise.all([
        apiFetch<{ giftCards: GiftCardRecord[]; transactions: typeof txs }>('/api/gift-cards'),
        apiFetch<{ customers: CustomerRecord[] }>('/api/customers'),
      ]);
      setCards(gcRes.giftCards);
      setTxs(gcRes.transactions);
      setCustomers(cRes.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gift cards.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/gift-cards', {
        method: 'POST',
        body: JSON.stringify({
          customerId: custId || undefined,
          initialValue,
          expirationDate: expirationDate || undefined,
        }),
      });
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to issue gift card.');
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLookupResult(null);
    try {
      const res = await apiFetch<{ giftCard: GiftCardRecord }>(
        `/api/gift-cards/lookup/${encodeURIComponent(lookupCode)}`
      );
      setLookupResult(res.giftCard);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gift card not found.');
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    try {
      await apiFetch(`/api/gift-cards/${cancelTarget.id}/cancel`, { method: 'POST' });
      setCancelTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.');
      setCancelTarget(null);
    }
  };

  const activeLiability = cards
    .filter((c) => c.status === 'Active')
    .reduce((s, c) => s + c.balance, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl px-5 py-3.5 flex items-center gap-4">
          <Gift className="w-5 h-5 text-[#E83B84]" />
          <div>
            <div className="text-xs text-[#1D1717]/60">Outstanding Gift Card Liability (Tracked Separately from Revenue)</div>
            <div className="text-lg font-bold font-mono">{formatUGX(activeLiability)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleLookup} className="flex items-center gap-1.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#1D1717]/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={lookupCode}
                onChange={(e) => setLookupCode(e.target.value)}
                placeholder="Check code (TUS-GC-...)"
                className="pl-9 pr-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-semibold cursor-pointer"
            >
              Check
            </button>
          </form>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Issue Gift Card
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {lookupResult && (
        <div className="p-4 rounded-xl bg-[#F3BFD3]/40 border border-[#E83B84]/30 text-xs flex justify-between items-center">
          <div>
            <strong>{lookupResult.code}</strong> &middot; Status: {lookupResult.status} &middot; Holder:{' '}
            {lookupResult.customerName || 'Bearer'}
          </div>
          <div className="font-mono font-bold text-sm text-[#E83B84]">
            Balance: {formatUGX(lookupResult.balance)}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <h3 className="text-base font-bold mb-4">Issued Gift Cards</h3>
          {cards.length === 0 ? (
            <p className="text-xs text-[#1D1717]/60 py-8 text-center">No gift cards issued yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-2.5 px-2">Code</th>
                    <th className="py-2.5 px-2">Holder</th>
                    <th className="py-2.5 px-2 text-right">Initial</th>
                    <th className="py-2.5 px-2 text-right">Balance</th>
                    <th className="py-2.5 px-2">Status</th>
                    {['owner', 'manager'].includes(user.role) && <th className="py-2.5 px-2 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {cards.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2.5 px-2 font-mono font-bold">{c.code}</td>
                      <td className="py-2.5 px-2">{c.customerName || 'Bearer'}</td>
                      <td className="py-2.5 px-2 text-right font-mono">{formatUGX(c.initialValue)}</td>
                      <td className="py-2.5 px-2 text-right font-mono font-bold text-[#E83B84]">
                        {formatUGX(c.balance)}
                      </td>
                      <td className="py-2.5 px-2 font-semibold">{c.status}</td>
                      {['owner', 'manager'].includes(user.role) && (
                        <td className="py-2.5 px-2 text-right">
                          {c.status === 'Active' && (
                            <button
                              onClick={() => setCancelTarget(c)}
                              className="inline-flex items-center gap-1 text-red-700 hover:underline cursor-pointer"
                            >
                              <Ban className="w-3 h-3" /> Cancel
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <h3 className="text-base font-bold mb-4">Gift Card Activity</h3>
          {txs.length === 0 ? (
            <p className="text-xs text-[#1D1717]/60">No gift card activity yet.</p>
          ) : (
            <div className="divide-y divide-[#1D1717]/10 text-xs">
              {txs.slice(0, 15).map((t) => (
                <div key={t.id} className="py-2.5 flex justify-between">
                  <div>
                    <div className="font-mono font-semibold">{t.code}</div>
                    <div className="text-[#1D1717]/60">
                      {t.type} &middot; {t.performedBy}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <div className="font-bold">{formatUGX(t.amount)}</div>
                    <div className="text-[#1D1717]/60">Bal: {formatUGX(t.balanceAfter)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleIssue}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold">Issue New Gift Card</h3>
            <div>
              <label className="block font-semibold mb-1">Customer (Optional)</label>
              <select
                value={custId}
                onChange={(e) => setCustId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
              >
                <option value="">Bearer / Unassigned</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.phone})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Value (UGX) *</label>
                <input
                  type="number"
                  min={5000}
                  step={1000}
                  required
                  value={initialValue}
                  onChange={(e) => setInitialValue(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Expiry Date (Optional)</label>
                <input
                  type="date"
                  value={expirationDate}
                  onChange={(e) => setExpirationDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Issue Card
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmModal
        open={Boolean(cancelTarget)}
        title={`Cancel Gift Card ${cancelTarget?.code}?`}
        description={`This will permanently deactivate gift card ${cancelTarget?.code} and void its remaining balance of ${formatUGX(cancelTarget?.balance)}.`}
        confirmLabel="Cancel Gift Card"
        destructive
        onConfirm={() => void handleConfirmCancel()}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
};
