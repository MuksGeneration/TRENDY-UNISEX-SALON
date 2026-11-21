import React, { useEffect, useState } from 'react';
import {
  Plus,
  AlertTriangle,
  ArrowUpDown,
  Check,
  X,
  FileText,
  FileDown,
  ClipboardList,
} from 'lucide-react';
import { apiFetch, exportReportToPdf, exportRowsToExcel, formatUGX } from '../lib/api';
import type { ExpenseRecord, PaymentMethod, SessionUser, StockItem } from '../types';

interface RestockReportLine {
  stockItemId: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  unit: string;
  currentQuantity: number;
  reorderLevel: number;
  reorderPercent: number;
  priority: 'Stock Low (<10%)' | 'Below Reorder';
  suggestedOrderQty: number;
  unitPurchasePrice: number;
  estimatedCost: number;
  supplierName: string;
  supplierPhone: string;
}

interface RestockReport {
  id: string;
  generatedAt: string;
  generatedBy: string;
  scope: 'critical' | 'all_low';
  criticalCount: number;
  totalItems: number;
  totalEstimatedCost: number;
  items: RestockReportLine[];
}

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
  const [stockFilter, setStockFilter] = useState<'all' | 'stock_low' | 'below_reorder'>('all');
  const [showStockModal, setShowStockModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [creatingRestockReport, setCreatingRestockReport] = useState(false);
  const [restockReport, setRestockReport] = useState<RestockReport | null>(null);

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

  const downloadRestockPdf = (report: RestockReport) => {
    exportReportToPdf(
      `Inventory Restock Report (${report.id})`,
      `Generated by ${report.generatedBy} · ${new Date(report.generatedAt).toLocaleString()}`,
      [
        'SKU',
        'Product',
        'Current Qty',
        'Reorder Level',
        '% Reorder',
        'Alert Status',
        'Suggested Order',
        'Supplier & Contact',
        'Est. Cost (UGX)',
      ],
      report.items.map((item) => [
        item.sku,
        item.name,
        `${item.currentQuantity} ${item.unit}`,
        `${item.reorderLevel} ${item.unit}`,
        `${item.reorderPercent}%`,
        item.priority,
        `${item.suggestedOrderQty} ${item.unit}`,
        `${item.supplierName} (${item.supplierPhone})`,
        formatUGX(item.estimatedCost),
      ]),
      [
        `Critical Stock Low (<10% of Reorder Level): ${report.criticalCount} item(s)`,
        `Total Items Requiring Restock: ${report.totalItems} item(s)`,
        `Estimated Total Restock Budget: ${formatUGX(report.totalEstimatedCost)}`,
      ]
    );
  };

  const downloadRestockExcel = (report: RestockReport) => {
    exportRowsToExcel(`restock_report_${report.id}.xlsx`, [
      {
        name: 'Restock Order Plan',
        rows: report.items.map((item) => ({
          ReportID: report.id,
          SKU: item.sku,
          Product: item.name,
          Category: item.category,
          Brand: item.brand,
          CurrentQty: item.currentQuantity,
          Unit: item.unit,
          ReorderLevel: item.reorderLevel,
          PercentOfReorder: `${item.reorderPercent}%`,
          Priority: item.priority,
          SuggestedOrderQty: item.suggestedOrderQty,
          UnitCostUGX: item.unitPurchasePrice,
          EstimatedCostUGX: item.estimatedCost,
          Supplier: item.supplierName,
          SupplierPhone: item.supplierPhone,
        })),
      },
    ]);
  };

  const handleCreateRestockReport = async (scope: 'critical' | 'all_low' = 'all_low') => {
    setError('');
    setMsg('');
    setCreatingRestockReport(true);
    try {
      const res = await apiFetch<{ report: RestockReport }>('/api/inventory/restock-report', {
        method: 'POST',
        body: JSON.stringify({ scope }),
      });
      setRestockReport(res.report);
      downloadRestockPdf(res.report);
      setMsg(
        `Restock report ${res.report.id} created and downloaded (${res.report.totalItems} item(s), ${res.report.criticalCount} critical Stock Low).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create restock report.');
    } finally {
      setCreatingRestockReport(false);
    }
  };

  const openQuickRestock = (item: StockItem, suggestedQty: number) => {
    setMovItemId(item.id);
    setMovType('Purchase');
    setMovQty(suggestedQty);
    setMovNotes(`Restock triggered by Stock Low alert (${item.sku})`);
    setShowMoveModal(true);
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
  const isCriticalStockLow = (item: StockItem) =>
    item.active !== false && item.minStockLevel > 0 && item.currentQuantity < item.minStockLevel * 0.1;

  const isBelowReorder = (item: StockItem) =>
    item.active !== false && item.currentQuantity <= item.minStockLevel;

  const getReorderPercent = (item: StockItem) =>
    item.minStockLevel > 0 ? Math.round((item.currentQuantity / item.minStockLevel) * 100) : 100;

  const getSuggestedRestockQty = (item: StockItem) => {
    const target = Math.max(
      item.openingQuantity || 0,
      item.minStockLevel * 2,
      item.minStockLevel + 5
    );
    return Math.max(1, target - item.currentQuantity);
  };

  const totalValuation = stockItems.reduce((s, i) => s + i.currentQuantity * i.purchasePrice, 0);
  const criticalStockLowItems = stockItems.filter(isCriticalStockLow);
  const belowReorderItems = stockItems.filter(isBelowReorder);
  const criticalRestockEstCost = criticalStockLowItems.reduce(
    (sum, i) => sum + getSuggestedRestockQty(i) * i.purchasePrice,
    0
  );

  const visibleStockItems = stockItems.filter((item) => {
    if (stockFilter === 'stock_low') return isCriticalStockLow(item);
    if (stockFilter === 'below_reorder') return isBelowReorder(item);
    return true;
  });

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
          <div className="text-xs font-mono tabular-nums">
            Valuation: <strong>{formatUGX(totalValuation)}</strong> &middot;{' '}
            <span className={criticalStockLowItems.length > 0 ? 'text-red-700 font-bold' : 'text-[#1D1717]/70'}>
              {criticalStockLowItems.length} Stock Low (&lt;10%)
            </span>
            {' · '}
            <span className={belowReorderItems.length > 0 ? 'text-amber-700 font-semibold' : 'text-emerald-700'}>
              {belowReorderItems.length} below reorder
            </span>
          </div>
          {canManageInv && belowReorderItems.length > 0 && criticalStockLowItems.length === 0 && (
            <button
              type="button"
              disabled={creatingRestockReport}
              onClick={() => void handleCreateRestockReport('all_low')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E83B84]/40 bg-[#F3BFD3]/35 hover:bg-[#F3BFD3]/60 text-xs font-semibold text-[#1D1717] cursor-pointer disabled:opacity-60"
            >
              <ClipboardList className="w-3.5 h-3.5 text-[#E83B84]" />
              <span>{creatingRestockReport ? 'Generating...' : 'Create Restock Report'}</span>
            </button>
          )}
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

      {/* Automated Stock Low Alert System (<10% of Reorder Level) */}
      {criticalStockLowItems.length > 0 && (
        <div
          role="alert"
          className="bg-red-50/85 border border-red-200 rounded-2xl p-5 space-y-4"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-red-900">
                  Automated Stock Low Alert &middot; {criticalStockLowItems.length} Item(s) Below 10% of Reorder Level
                </h3>
                <p className="text-xs text-red-800/85 mt-0.5 font-mono tabular-nums">
                  Immediate restock recommended &middot; Est. restock budget: {formatUGX(criticalRestockEstCost)}
                  {belowReorderItems.length > criticalStockLowItems.length
                    ? ` · +${belowReorderItems.length - criticalStockLowItems.length} additional item(s) below reorder level`
                    : ''}
                </p>
              </div>
            </div>

            {canManageInv && (
              <button
                type="button"
                disabled={creatingRestockReport}
                onClick={() => void handleCreateRestockReport('all_low')}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <FileText className="w-4 h-4" />
                <span>{creatingRestockReport ? 'Creating Restock Report...' : 'Create Restock Report'}</span>
              </button>
            )}
          </div>

          <div className="divide-y divide-red-200/80 border-t border-red-200/80">
            {criticalStockLowItems.map((item) => {
              const pct = getReorderPercent(item);
              const threshold10 = Number((item.minStockLevel * 0.1).toFixed(1));
              const suggestedQty = getSuggestedRestockQty(item);
              const estCost = suggestedQty * item.purchasePrice;
              return (
                <div
                  key={item.id}
                  className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-bold text-red-700 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Stock Low
                      </span>
                      <span className="text-[#1D1717]/35">&middot;</span>
                      <span className="font-semibold text-[#1D1717]">{item.name}</span>
                      <span className="font-mono text-[#1D1717]/60">({item.sku})</span>
                    </div>
                    <div className="text-[11px] text-[#1D1717]/75 font-mono tabular-nums mt-0.5">
                      On hand: <strong className="text-red-700">{item.currentQuantity} {item.unit}</strong>
                      {' · '}Reorder level: {item.minStockLevel} {item.unit} (10% threshold: {threshold10})
                      {' · '}{pct}% of reorder
                      {' · '}Suggested order: +{suggestedQty} {item.unit} ({formatUGX(estCost)})
                    </div>
                  </div>
                  {canManageInv && (
                    <button
                      type="button"
                      onClick={() => openQuickRestock(item, suggestedQty)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-red-300 hover:bg-red-100/70 text-red-800 font-semibold text-xs whitespace-nowrap shrink-0 cursor-pointer w-fit"
                    >
                      Restock +{suggestedQty} {item.unit}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {msg && <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}

      <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
        {invTab === 'items' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-[#F8EEEB] rounded-lg w-fit">
                {[
                  { id: 'all', label: `All Items (${stockItems.length})` },
                  { id: 'stock_low', label: `Stock Low <10% (${criticalStockLowItems.length})` },
                  { id: 'below_reorder', label: `Below Reorder (${belowReorderItems.length})` },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStockFilter(f.id as typeof stockFilter)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      stockFilter === f.id
                        ? 'bg-white text-[#1D1717] shadow-xs'
                        : 'text-[#1D1717]/65 hover:text-[#1D1717]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-[#1D1717]/60">
                Automated alert triggers when stock falls strictly below 10% of reorder level.
              </div>
            </div>

            <div className="overflow-x-auto">
              {visibleStockItems.length === 0 ? (
                <p className="text-xs text-[#1D1717]/60 py-8 text-center">
                  No inventory items match this stock filter.
                </p>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                      <th className="py-3 px-3">SKU</th>
                      <th className="py-3 px-3">Product Name</th>
                      <th className="py-3 px-3">Category &amp; Brand</th>
                      <th className="py-3 px-3 text-right">Stock Qty</th>
                      <th className="py-3 px-3 text-right">Reorder Level</th>
                      <th className="py-3 px-3">Stock Status</th>
                      <th className="py-3 px-3 text-right">Cost Price</th>
                      <th className="py-3 px-3 text-right">Retail Price</th>
                      <th className="py-3 px-3">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D1717]/10">
                    {visibleStockItems.map((item) => {
                      const criticalLow = isCriticalStockLow(item);
                      const belowMin = isBelowReorder(item);
                      const reorderPct = getReorderPercent(item);
                      return (
                        <tr
                          key={item.id}
                          className={
                            criticalLow
                              ? 'bg-red-50/60 hover:bg-red-50/90'
                              : belowMin
                              ? 'bg-amber-50/40 hover:bg-amber-50/70'
                              : 'hover:bg-[#F8EEEB]/50'
                          }
                        >
                          <td className="py-3 px-3 font-mono text-[#1D1717]/70">{item.sku}</td>
                          <td className="py-3 px-3 font-semibold text-[#1D1717]">
                            {item.name}
                          </td>
                          <td className="py-3 px-3">
                            {item.category} &middot; {item.brand}
                          </td>
                          <td
                            className={`py-3 px-3 text-right font-mono tabular-nums font-bold ${
                              criticalLow ? 'text-red-700' : belowMin ? 'text-amber-700' : ''
                            }`}
                          >
                            {item.currentQuantity} {item.unit}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {item.minStockLevel}
                            {item.minStockLevel > 0 && (
                              <span className="block text-[10px] text-[#1D1717]/50">
                                10% alert: &lt;{(item.minStockLevel * 0.1).toFixed(1)}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            {criticalLow ? (
                              <div>
                                <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                                  <AlertTriangle className="w-3.5 h-3.5" /> Stock Low
                                </span>
                                <div className="text-[11px] font-mono tabular-nums text-red-700/80">
                                  {reorderPct}% of reorder (&lt;10%)
                                </div>
                              </div>
                            ) : belowMin ? (
                              <div>
                                <span className="text-amber-700 font-semibold">Below Reorder</span>
                                <div className="text-[11px] font-mono tabular-nums text-amber-700/80">
                                  {reorderPct}% of reorder
                                </div>
                              </div>
                            ) : (
                              <div>
                                <span className="text-emerald-700 font-medium">Healthy</span>
                                <div className="text-[11px] font-mono tabular-nums text-[#1D1717]/55">
                                  {reorderPct}% of reorder
                                </div>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums">
                            {formatUGX(item.purchasePrice)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#E83B84]">
                            {item.isRetail ? formatUGX(item.sellingPrice) : 'Internal Use'}
                          </td>
                          <td className="py-3 px-3">{item.isRetail ? 'Retail + Salon' : 'Salon Supply'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
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
                <label className="block font-semibold mb-1">Reorder Level</label>
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
      {/* Generated Restock Report Modal */}
      {restockReport && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs max-h-[90vh] flex flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#1D1717]/10">
              <div>
                <h3 className="text-base font-bold text-[#1D1717]">
                  Inventory Restock Report &middot; {restockReport.id}
                </h3>
                <p className="text-[#1D1717]/65 mt-0.5 font-mono tabular-nums">
                  Generated {new Date(restockReport.generatedAt).toLocaleString()} &middot; By {restockReport.generatedBy}
                  {' · '}{restockReport.criticalCount} Stock Low (&lt;10%)
                  {' · '}{restockReport.totalItems} total item(s)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadRestockPdf(restockReport)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1D1717] text-white font-semibold cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadRestockExcel(restockReport)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] font-semibold cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5 text-[#E83B84]" /> Export Excel
                </button>
              </div>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-2.5 px-3">Product (SKU)</th>
                    <th className="py-2.5 px-3 text-right">Current Qty</th>
                    <th className="py-2.5 px-3 text-right">Reorder Level</th>
                    <th className="py-2.5 px-3">Alert Level</th>
                    <th className="py-2.5 px-3 text-right">Suggested Order</th>
                    <th className="py-2.5 px-3">Supplier</th>
                    <th className="py-2.5 px-3 text-right">Est. Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {restockReport.items.map((item) => (
                    <tr
                      key={item.stockItemId}
                      className={item.priority === 'Stock Low (<10%)' ? 'bg-red-50/50' : ''}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-[#1D1717]">{item.name}</div>
                        <div className="font-mono text-[11px] text-[#1D1717]/60">{item.sku}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-red-700">
                        {item.currentQuantity} {item.unit}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {item.reorderLevel} {item.unit} ({item.reorderPercent}%)
                      </td>
                      <td
                        className={`py-2.5 px-3 font-semibold ${
                          item.priority === 'Stock Low (<10%)' ? 'text-red-700' : 'text-amber-700'
                        }`}
                      >
                        {item.priority}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                        +{item.suggestedOrderQty} {item.unit}
                      </td>
                      <td className="py-2.5 px-3">
                        <div>{item.supplierName}</div>
                        <div className="font-mono text-[11px] text-[#1D1717]/60">{item.supplierPhone}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold">
                        {formatUGX(item.estimatedCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#1D1717]/10">
              <div className="text-sm font-bold font-mono tabular-nums">
                Total Estimated Restock Cost:{' '}
                <span className="text-[#E83B84]">{formatUGX(restockReport.totalEstimatedCost)}</span>
              </div>
              <button
                type="button"
                onClick={() => setRestockReport(null)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
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
