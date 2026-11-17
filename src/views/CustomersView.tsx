import React, { useEffect, useState } from 'react';
import { Plus, Search, User, X } from 'lucide-react';
import { apiFetch, formatUGX } from '../lib/api';
import type {
  AppointmentRecord,
  CustomerRecord,
  EmployeeRecord,
  POSTransactionRecord,
  SessionUser,
} from '../types';

export const CustomersView: React.FC<{ user: SessionUser }> = ({ user }) => {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('');
  const [preferredStylistId, setPreferredStylistId] = useState('');
  const [preferences, setPreferences] = useState('');
  const [hairColorHistory, setHairColorHistory] = useState('');
  const [specialInstructions, setSpecialInstructions] = useState('');

  const [selectedHistory, setSelectedHistory] = useState<{
    customer: CustomerRecord;
    appointments: AppointmentRecord[];
    transactions: POSTransactionRecord[];
    notes: Array<{ id: string; authorName: string; note: string; createdAt: string }>;
  } | null>(null);
  const [newNote, setNewNote] = useState('');
  const [error, setError] = useState('');

  const canManage = ['owner', 'manager'].includes(user.role);

  const load = async () => {
    try {
      const [cRes, eRes] = await Promise.all([
        apiFetch<{ customers: CustomerRecord[] }>('/api/customers'),
        apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
      ]);
      setCustomers(cRes.customers);
      setEmployees(eRes.employees);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          phone,
          email,
          gender,
          preferredStylistId: preferredStylistId || undefined,
          preferences,
          hairColorHistory,
          specialInstructions,
        }),
      });
      setShowAdd(false);
      setFullName('');
      setPhone('');
      setEmail('');
      setPreferences('');
      setHairColorHistory('');
      setSpecialInstructions('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer.');
    }
  };

  const openProfile = async (id: string) => {
    if (!canManage) return;
    try {
      const res = await apiFetch<typeof selectedHistory>(`/api/customers/${id}/history`);
      setSelectedHistory(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customer history.');
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHistory || !newNote.trim()) return;
    try {
      await apiFetch(`/api/customers/${selectedHistory.customer.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ note: newNote }),
      });
      setNewNote('');
      await openProfile(selectedHistory.customer.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note.');
    }
  };

  const filtered = customers.filter((c) => {
    if (tierFilter !== 'all' && c.loyaltyTier !== tierFilter) return false;
    if (
      search &&
      !c.fullName.toLowerCase().includes(search.toLowerCase()) &&
      !(c.phone || '').includes(search)
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-[#1D1717]/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs"
            />
          </div>
          <div className="flex items-center gap-1 p-1 bg-white border border-[#1D1717]/10 rounded-xl">
            {['all', 'Bronze', 'Silver', 'Gold', 'VIP'].map((t) => (
              <button
                key={t}
                onClick={() => setTierFilter(t)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize cursor-pointer ${
                  tierFilter === t ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {canManage && (
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" /> Register Customer
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
      )}

      <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
        {filtered.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <p className="text-sm text-[#1D1717]/60">No customer profiles registered yet.</p>
            {canManage && (
              <button
                onClick={() => setShowAdd(true)}
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
              >
                Register First Customer
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">Preferences &amp; Hair Notes</th>
                  <th className="py-3 px-3">Loyalty</th>
                  <th className="py-3 px-3 text-right">Visits</th>
                  <th className="py-3 px-3 text-right">Total Spent</th>
                  <th className="py-3 px-3">Last Visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D1717]/10">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => void openProfile(c.id)}
                    className="hover:bg-[#F8EEEB]/60 cursor-pointer"
                  >
                    <td className="py-3 px-3">
                      <div className="font-semibold text-[#1D1717]">{c.fullName}</div>
                      <div className="text-[#1D1717]/55">{c.email || c.gender || 'Client'}</div>
                    </td>
                    <td className="py-3 px-3 font-mono">{c.phone}</td>
                    <td className="py-3 px-3 text-[#1D1717]/75 max-w-xs truncate">
                      {c.preferences || c.hairColorHistory || '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-semibold text-[#E83B84]">{c.loyaltyTier}</span>
                      <span className="text-[#1D1717]/55 font-mono ml-1.5">
                        ({c.loyaltyPoints} pts)
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{c.totalVisits}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                      {formatUGX(c.totalSpent)}
                    </td>
                    <td className="py-3 px-3 font-mono text-[#1D1717]/65">{c.lastVisitDate || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Customer Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreate}
            className="w-full max-w-lg bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4"
          >
            <h3 className="text-lg font-bold">Register New Customer</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Full Name *</label>
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Phone Number *</label>
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+256 7XX XXX XXX"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Email (Optional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Preferred Stylist</label>
                <select
                  value={preferredStylistId}
                  onChange={(e) => setPreferredStylistId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                >
                  <option value="">No preference</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Gender (Voluntary)</label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                >
                  <option value="">Not specified</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Hair Color History</label>
                <input
                  value={hairColorHistory}
                  onChange={(e) => setHairColorHistory(e.target.value)}
                  placeholder="e.g. Jet Black Tint"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
            </div>
            <div className="text-xs">
              <label className="block font-semibold mb-1">Styling Preferences &amp; Special Instructions</label>
              <textarea
                rows={2}
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
              >
                Save Customer
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Customer Profile & Treatment History Drawer */}
      {selectedHistory && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex justify-end">
          <div className="w-full max-w-xl bg-white h-full overflow-y-auto p-6 space-y-6">
            <div className="flex items-start justify-between border-b border-[#1D1717]/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#F3BFD3]/60 text-[#E83B84] flex items-center justify-center">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{selectedHistory.customer.fullName}</h3>
                  <p className="text-xs text-[#1D1717]/65 font-mono">
                    {selectedHistory.customer.phone} &middot; {selectedHistory.customer.loyaltyTier} ({selectedHistory.customer.loyaltyPoints} pts)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedHistory(null)}
                className="p-1.5 rounded-lg hover:bg-[#F8EEEB] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Total Visits</div>
                <div className="text-base font-bold font-mono mt-1">{selectedHistory.customer.totalVisits}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Total Spent</div>
                <div className="text-base font-bold font-mono mt-1">{formatUGX(selectedHistory.customer.totalSpent)}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Last Visit</div>
                <div className="text-base font-bold font-mono mt-1">{selectedHistory.customer.lastVisitDate || '—'}</div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <h4 className="font-bold text-sm">Treatment &amp; Purchase History</h4>
              {selectedHistory.transactions.length === 0 ? (
                <p className="text-[#1D1717]/55">No completed POS visits yet.</p>
              ) : (
                <div className="divide-y divide-[#1D1717]/10 border border-[#1D1717]/10 rounded-xl">
                  {selectedHistory.transactions.map((tx) => (
                    <div key={tx.id} className="p-3 flex justify-between gap-2">
                      <div>
                        <div className="font-semibold">{tx.items.map((i) => i.name).join(', ')}</div>
                        <div className="text-[#1D1717]/55 font-mono">{tx.date} &middot; {tx.reference}</div>
                      </div>
                      <div className="font-mono font-bold text-[#E83B84]">{formatUGX(tx.totalAmount)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 text-xs">
              <h4 className="font-bold text-sm">Stylist Notes &amp; Feedback</h4>
              <form onSubmit={handleAddNote} className="flex gap-2">
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Add treatment formula or customer preference note..."
                  className="flex-1 px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                >
                  Save
                </button>
              </form>
              <div className="space-y-2">
                {selectedHistory.notes.map((n) => (
                  <div key={n.id} className="p-3 rounded-xl bg-[#F8EEEB]/70">
                    <div className="text-[#1D1717]">{n.note}</div>
                    <div className="text-[11px] text-[#1D1717]/55 mt-1">
                      {n.authorName} &middot; {new Date(n.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
