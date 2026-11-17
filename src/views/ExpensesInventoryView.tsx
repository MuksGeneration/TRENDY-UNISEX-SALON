import React, { useEffect, useState } from 'react';
import { Plus, AlertTriangle, ArrowUpDown, Check, X } from 'lucide-react';
import { apiFetch, formatUGX } from '../lib/api';
import type { ExpenseRecord, PaymentMethod, SessionUser, StockItem } from '../types';

export const ExpensesInventoryView: React.FC<{
  mode: 'expenses' | 'inventory';
  user: SessionUser;
}> = ({ mode, user }) => {
  // Expenses state
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [expCategories, setExpCategories] = useState<string[]>([]);
  const [showExpModal, setShowExpModal] = useState(false);
  const [expDate, setExpDate] = useState(new Date().toISOString().slice(0, 10));
  const [expCat, setExpCat] = useState('Salon supplies');
  const [expDesc, setExpDesc] = useState('');
  const [expAmt, setExpAmt] = useState(0);
  const [expMethod, setExpMethod] = useState<PaymentMethod>('Cash');

  // Inventory state
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [movements, setMovements] = useState<
    Array<{
      id: string;
      stockItemName: string;
      date: string;
      type: string;
      quantityDelta: number;
      quantityAfter: number;
      referenceId?: string;
      recordedBy: string;
      notes?: string;
    }>
  >([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [invTab, setInvTab] = useState<'items' | 'movements' | 'suppliers'>('items');
  const [showStockModal, setShowStockModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);

  const [stkName, setStkName] = useState('');
  const [stkCat, setStkCat] = useState('Hair products');
  const [stkBrand, setStkBrand] = useState('');
  const [stkUnit, setStkUnit] = useState('Bottle');
  const [stkOpenQty, setStkOpenQty] = useState(10);
  const [stkCost, setStkCost] = useState(10000);
  const [stkSell, setStkSell] = useState(20000);
  const [stkMin, setStkMin] = useState(3);
  const [stkRetail, setStkRetail] = useState(true);

  const [movItemId, setMovItemId] = useState('');
  const [movType, setMovType] = useState<
    'Purchase' | 'Service Usage' | 'Adjustment' | 'Damaged' | 'Expired' | 'Return'
  >('Purchase');
  const [movQty, setMovQty] = useState(1);
  const [movNotes, setMovNotes] = useState('');

  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const canManageInv = ['owner', 'manager'].includes(user.role);

  const load = async () => {
    setError('');
    try {
      if (mode === 'expenses') {
        const res = await apiFetch<{ expenses: ExpenseRecord[]; categories: string[] }>('/api/expenses');
        setExpenses(res.expenses);
        setExpCategories(res.categories);
      } else {
        const res = await apiFetch<{
          items: StockItem[];
          movements: typeof movements;
          suppliers: typeof suppliers;
        }>('/api/inventory');
        setStockItems(res.items);
        setMovements(res.movements);
        setSuppliers(res.suppliers);
        if (res.items.length > 0 && !movItemId) setMovItemId(res.items[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
    }
  };

  useEffect(() => {
    void load();
  }, [mode]);

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          date: expDate,
          category: expCat,
          description: expDesc,
          amount: expAmt,
          paymentMethod: expMethod,
        }),
      });
      setShowExpModal(false);
      setExpDesc('');
      setExpAmt(0);
      setMsg('Expense recorded.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record expense.');
    }
  };

  const handleExpenseDecision = async (id: string, status: 'Approved' | 'Rejected') => {
    try {
      await apiFetch(`/api/expenses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update expense.');
    }
  };

  const handleAddStock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          name: stkName,
          category: stkCat,
          brand: stkBrand,
          unit: stkUnit,
          openingQuantity: stkOpenQty,
          purchasePrice: stkCost,
          sellingPrice: stkRetail ? stkSell : 0,
          minStockLevel: stkMin,
          isRetail: stkRetail,
        }),
      });
      setShowStockModal(false);
      setStkName('');
      setMsg('Stock item registered.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add stock item.');
    }
  };

  const handleRecordMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/stock-movements', {
        method: 'POST',
        body: JSON.stringify({
          stockItemId: movItemId,
          type: movType,
          quantity: movQty,
          notes: movNotes,
        }),
      });
      setShowMoveModal(false);
      setMovNotes('');
      setMsg('Stock movement recorded and balance updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stock movement failed.');
    }
  };

  if (mode === 'expenses') {
    const approvedTotal = expenses
      .filter((e) => e.status === 'Approved')
      .reduce((s, e) => s + e.amount, 0);
    const pendingTotal = expenses
      .filter((e) => e.status === 'Pending')
      .reduce((s, e) => s + e.amount, 0);

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6 text-xs">
            <div>
              <div className="text-[#1D1717]/60">Approved Expenses</div>
              <div className="text-lg font-bold font-mono">{formatUGX(approvedTotal)}</div>
            </div>
            <div>
              <div className="text-[#1D1717]/60">Pending Approval</div>
              <div className="text-lg font-bold font-mono text-amber-700">{formatUGX(pendingTotal)}</div>
            </div>
          </div>

          <button
            onClick={() => setShowExpModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer w-fit"
          >
            <Plus className="w-3.5 h-3.5" /> Record Expense
          </button>
        </div>

        {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
        {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}

        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          {expenses.length === 0 ? (
            <p className="text-sm text-[#1D1717]/60 py-10 text-center">No salon expenses recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Description</th>
                    <th className="py-3 px-3">Method</th>
                    <th className="py-3 px-3">Recorded By</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3">Status</th>
                    {user.role === 'owner' && <th className="py-3 px-3 text-right">Approval</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-[#F8EEEB]/50">
                      <td className="py-2.5 px-3 font-mono">{e.date}</td>
                      <td className="py-2.5 px-3 font-semibold">{e.category}</td>
                      <td className="py-2.5 px-3">{e.description}</td>
                      <td className="py-2.5 px-3">{e.paymentMethod}</td>
                      <td className="py-2.5 px-3">{e.responsiblePerson}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">{formatUGX(e.amount)}</td>
                      <td className="py-2.5 px-3 font-semibold">
                        <span
                          className={
                            e.status === 'Approved'
                              ? 'text-emerald-700'
                              : e.status === 'Pending'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }
                        >
                          {e.status}
                        </span>
                      </td>
                      {user.role === 'owner' && (
                        <td className="py-2.5 px-3 text-right space-x-1 whitespace-nowrap">
                          {e.status === 'Pending' && !e.isHistorical && (
                            <>
                              <button
                                onClick={() => void handleExpenseDecision(e.id, 'Approved')}
                                className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 cursor-pointer"
                                title="Approve"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => void handleExpenseDecision(e.id, 'Rejected')}
                                className="p-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer"
                                title="Reject"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
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

        {showExpModal && (
          <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
            <form
              onSubmit={handleSaveExpense}
              className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
            >
              <h3 className="text-base font-bold">Record Salon Expense</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    value={expDate}
                    onChange={(e) => setExpDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Category</label>
                  <select
                    value={expCat}
                    onChange={(e) => setExpCat(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                  >
                    {expCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <input
                required
                value={expDesc}
                onChange={(e) => setExpDesc(e.target.value)}
                placeholder="Expense description (e.g. UMEME Electricity, Shampoo restock)"
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold mb-1">Amount (UGX) *</label>
                  <input
                    type="number"
                    min={500}
                    required
                    value={expAmt}
                    onChange={(e) => setExpAmt(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Payment Method</label>
                  <select
                    value={expMethod}
                    onChange={(e) => setExpMethod(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Mobile Money">Mobile Money</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowExpModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                >
                  Save Expense
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    );
  }

  // INVENTORY & STOCK MANAGEMENT
  const totalValuation = stockItems.reduce((s, i) => s + i.currentQuantity * i.purchasePrice, 0);
  const lowCount = stockItems.filter((i) => i.currentQuantity <= i.minStockLevel).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center gap-2 p-1 bg-white border border-[#1D1717]/10 rounded-xl w-fit">
          <button
            onClick={() => setInvTab('items')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              invTab === 'items' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
            }`}
          >
            Stock Items ({stockItems.length})
          </button>
          <button
            onClick={() => setInvTab('movements')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              invTab === 'movements' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
            }`}
          >
            Stock Movements ({movements.length})
          </button>
          <button
            onClick={() => setInvTab('suppliers')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              invTab === 'suppliers' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
            }`}
          >
            Suppliers ({suppliers.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-mono">
            Valuation: <strong>{formatUGX(totalValuation)}</strong> &middot;{' '}
            <span className={lowCount > 0 ? 'text-red-700 font-bold' : 'text-emerald-700'}>
              {lowCount} low-stock
            </span>
          </div>
          <button
            onClick={() => setShowMoveModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-semibold cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-[#E83B84]" /> Record Movement / Usage
          </button>
          {canManageInv && (
            <button
              onClick={() => setShowStockModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> Add Stock Item
            </button>
          )}
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}

      <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
        {invTab === 'items' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                  <th className="py-3 px-3">SKU</th>
                  <th className="py-3 px-3">Product Name</th>
                  <th className="py-3 px-3">Category &amp; Brand</th>
                  <th className="py-3 px-3 text-right">Stock Qty</th>
                  <th className="py-3 px-3 text-right">Min Level</th>
                  <th className="py-3 px-3 text-right">Cost Price</th>
                  <th className="py-3 px-3 text-right">Retail Price</th>
                  <th className="py-3 px-3">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D1717]/10">
                {stockItems.map((item) => {
                  const isLow = item.currentQuantity <= item.minStockLevel;
                  return (
                    <tr key={item.id} className="hover:bg-[#F8EEEB]/50">
                      <td className="py-3 px-3 font-mono text-[#1D1717]/70">{item.sku}</td>
                      <td className="py-3 px-3 font-semibold text-[#1D1717]">
                        {item.name}
                        {isLow && (
                          <span className="inline-flex items-center gap-1 ml-2 text-red-700 font-semibold">
                            <AlertTriangle className="w-3 h-3" /> Low
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {item.category} &middot; {item.brand}
                      </td>
                      <td className={`py-3 px-3 text-right font-mono font-bold ${isLow ? 'text-red-700' : ''}`}>
                        {item.currentQuantity} {item.unit}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">{item.minStockLevel}</td>
                      <td className="py-3 px-3 text-right font-mono">{formatUGX(item.purchasePrice)}</td>
                      <td className="py-3 px-3 text-right font-mono font-semibold text-[#E83B84]">
                        {item.isRetail ? formatUGX(item.sellingPrice) : 'Internal Use'}
                      </td>
                      <td className="py-3 px-3">{item.isRetail ? 'Retail + Salon' : 'Salon Supply'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {invTab === 'movements' && (
          <div className="overflow-x-auto">
            {movements.length === 0 ? (
              <p className="text-xs text-[#1D1717]/60 py-8 text-center">No stock movements logged yet.</p>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Product</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3 text-right">Change</th>
                    <th className="py-2.5 px-3 text-right">Balance After</th>
                    <th className="py-2.5 px-3">Recorded By</th>
                    <th className="py-2.5 px-3">Notes / Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td className="py-2.5 px-3 font-mono">{m.date}</td>
                      <td className="py-2.5 px-3 font-semibold">{m.stockItemName}</td>
                      <td className="py-2.5 px-3">{m.type}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-mono font-bold ${
                          m.quantityDelta > 0 ? 'text-emerald-700' : 'text-red-700'
                        }`}
                      >
                        {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono">{m.quantityAfter}</td>
                      <td className="py-2.5 px-3">{m.recordedBy}</td>
                      <td className="py-2.5 px-3 text-[#1D1717]/65">{m.notes || m.referenceId || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {invTab === 'suppliers' && (
          <div className="divide-y divide-[#1D1717]/10 text-xs">
            {suppliers.map((s) => (
              <div key={s.id} className="py-3 flex justify-between">
                <div>
                  <div className="font-bold text-sm">{s.name}</div>
                  <div className="font-mono text-[#1D1717]/65">{s.phone}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Stock Modal */}
      {showStockModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleAddStock}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-3 text-xs"
          >
            <h3 className="text-base font-bold">Register Inventory Item</h3>
            <input
              required
              value={stkName}
              onChange={(e) => setStkName(e.target.value)}
              placeholder="Product Name *"
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                required
                value={stkCat}
                onChange={(e) => setStkCat(e.target.value)}
                placeholder="Category"
                className="px-3 py-2 rounded-xl border border-[#1D1717]/15"
              />
              <input
                value={stkBrand}
                onChange={(e) => setStkBrand(e.target.value)}
                placeholder="Brand"
                className="px-3 py-2 rounded-xl border border-[#1D1717]/15"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-semibold mb-1">Opening Qty</label>
                <input
                  type="number"
                  min={0}
                  value={stkOpenQty}
                  onChange={(e) => setStkOpenQty(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Min Level</label>
                <input
                  type="number"
                  min={0}
                  value={stkMin}
                  onChange={(e) => setStkMin(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Unit</label>
                <input
                  value={stkUnit}
                  onChange={(e) => setStkUnit(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block font-semibold mb-1">Purchase Price (UGX)</label>
                <input
                  type="number"
                  min={0}
                  value={stkCost}
                  onChange={(e) => setStkCost(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Selling Price (UGX)</label>
                <input
                  type="number"
                  min={0}
                  disabled={!stkRetail}
                  value={stkSell}
                  onChange={(e) => setStkSell(Number(e.target.value))}
                  className="w-full px-2.5 py-2 rounded-xl border border-[#1D1717]/15 font-mono disabled:opacity-45"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 font-semibold cursor-pointer">
              <input
                type="checkbox"
                checked={stkRetail}
                onChange={(e) => setStkRetail(e.target.checked)}
              />
              <span>Available for Retail Sale in POS</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowStockModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Save Stock Item
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Movement Modal */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleRecordMovement}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-3 text-xs"
          >
            <h3 className="text-base font-bold">Record Stock Movement</h3>
            <select
              value={movItemId}
              onChange={(e) => setMovItemId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
            >
              {stockItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (Available: {i.currentQuantity} {i.unit})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={movType}
                onChange={(e) => setMovType(e.target.value as typeof movType)}
                className="px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
              >
                <option value="Purchase">Purchase (Restock +)</option>
                <option value="Service Usage">Service Usage (-)</option>
                <option value="Damaged">Damaged (-)</option>
                <option value="Expired">Expired (-)</option>
                <option value="Return">Return (+)</option>
                <option value="Adjustment">Adjustment (+/-)</option>
              </select>
              <input
                type="number"
                required
                value={movQty}
                onChange={(e) => setMovQty(Number(e.target.value))}
                placeholder="Qty"
                className="px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
              />
            </div>
            <input
              value={movNotes}
              onChange={(e) => setMovNotes(e.target.value)}
              placeholder="Notes / Supplier Invoice"
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMoveModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Save Movement
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
