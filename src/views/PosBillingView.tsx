import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Printer,
  FileDown,
  Search,
  RotateCcw,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { apiFetch, downloadReceiptPdf, formatUGX } from '../lib/api';
import { ConfirmModal } from '../components/ConfirmModal';
import type {
  CustomerRecord,
  EmployeeRecord,
  PaymentMethod,
  POSTransactionRecord,
  SalonBranding,
  ServiceItem,
  SessionUser,
  StockItem,
} from '../types';

interface PosPrefill {
  customerId: string;
  customerName: string;
  appointmentId?: string;
  walkInId?: string;
  serviceIds: string[];
  employeeId?: string;
}

interface PosBillingViewProps {
  user: SessionUser;
  branding?: SalonBranding;
  prefill?: PosPrefill | null;
  onClearPrefill?: () => void;
}

interface CartLine {
  key: string;
  itemType: 'service' | 'product';
  refId: string;
  name: string;
  categoryName: string;
  employeeId: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}

interface PaymentSplit {
  method: PaymentMethod;
  amount: number;
  reference: string;
  giftCardCode: string;
}

export const PosBillingView: React.FC<PosBillingViewProps> = ({
  user,
  branding,
  prefill,
  onClearPrefill,
}) => {
  const [subTab, setSubTab] = useState<'terminal' | 'history'>('terminal');
  const [catalogTab, setCatalogTab] = useState<'services' | 'products'>('services');
  const [catalogSearch, setCatalogSearch] = useState('');

  const [services, setServices] = useState<ServiceItem[]>([]);
  const [products, setProducts] = useState<StockItem[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [transactions, setTransactions] = useState<POSTransactionRecord[]>([]);

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [guestName, setGuestName] = useState('Walk-in Guest');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [tipAmount, setTipAmount] = useState(0);
  const [tipEmployeeId, setTipEmployeeId] = useState('');
  const [notes, setNotes] = useState('');
  const [payments, setPayments] = useState<PaymentSplit[]>([
    { method: 'Cash', amount: 0, reference: '', giftCardCode: '' },
  ]);
  const [paymentTouched, setPaymentTouched] = useState(false);

  const [lastReceipt, setLastReceipt] = useState<POSTransactionRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingSync, setRetryingSync] = useState(false);
  const [syncWarning, setSyncWarning] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Partial payment follow-up modal
  const [payingTx, setPayingTx] = useState<POSTransactionRecord | null>(null);
  const [followUpMethod, setFollowUpMethod] = useState<PaymentMethod>('Cash');
  const [followUpAmount, setFollowUpAmount] = useState(0);
  const [followUpRef, setFollowUpRef] = useState('');

  // Reversal confirm modal
  const [reverseTarget, setReverseTarget] = useState<POSTransactionRecord | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const loadData = async () => {
    try {
      const [srvRes, invRes, empRes, custRes, txRes] = await Promise.all([
        apiFetch<{ services: ServiceItem[] }>('/api/services'),
        apiFetch<{ items: StockItem[] }>('/api/inventory'),
        apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
        apiFetch<{ customers: CustomerRecord[] }>('/api/customers'),
        apiFetch<{ transactions: POSTransactionRecord[] }>('/api/pos/transactions'),
      ]);
      const activeSrvs = srvRes.services.filter((s) => s.active);
      const activeEmps = empRes.employees.filter((e) => e.active);
      setServices(activeSrvs);
      setProducts(
        invRes.items.filter(
          (i) =>
            i.active !== false &&
            (i.inventoryGroup === 'for_sale' || (i.inventoryGroup !== 'salon_owned' && i.isRetail))
        )
      );
      setEmployees(activeEmps);
      setCustomers(custRes.customers);
      setTransactions(txRes.transactions);

      if (prefill && activeEmps.length > 0) {
        setSelectedCustomerId(prefill.customerId);
        setGuestName(prefill.customerName);
        const defaultEmp = prefill.employeeId || activeEmps[0].id;
        const lines: CartLine[] = [];
        for (const sid of prefill.serviceIds) {
          const s = activeSrvs.find((x) => x.id === sid);
          if (s) {
            lines.push({
              key: `${s.id}-${Date.now()}-${Math.random()}`,
              itemType: 'service',
              refId: s.id,
              name: s.name,
              categoryName: s.categoryName,
              employeeId: defaultEmp,
              quantity: 1,
              unitPrice: s.price,
              discount: 0,
            });
          }
        }
        if (lines.length > 0) setCart(lines);
        setSubTab('terminal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load POS catalog.');
    }
  };

  useEffect(() => {
    void loadData();
  }, [prefill]);

  const subtotal = cart.reduce(
    (sum, line) => sum + Math.max(0, line.unitPrice * line.quantity - line.discount),
    0
  );
  const grandTotal = Math.max(0, subtotal - discountTotal) + Math.max(0, tipAmount);
  const totalPaidInput = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const balanceDue = Math.max(0, grandTotal - totalPaidInput);

  // Auto-sync single Cash payment to grandTotal unless user manually edits splits
  useEffect(() => {
    if (!paymentTouched && payments.length === 1) {
      setPayments([{ ...payments[0], amount: grandTotal }]);
    }
  }, [grandTotal, paymentTouched]);

  const addServiceToCart = (srv: ServiceItem) => {
    const defaultEmp =
      srv.qualifiedEmployeeIds.find((id) => employees.some((e) => e.id === id)) ||
      employees[0]?.id ||
      '';
    setCart((prev) => [
      ...prev,
      {
        key: `${srv.id}-${Date.now()}-${Math.random()}`,
        itemType: 'service',
        refId: srv.id,
        name: srv.name,
        categoryName: srv.categoryName,
        employeeId: defaultEmp,
        quantity: 1,
        unitPrice: srv.price,
        discount: 0,
      },
    ]);
  };

  const addProductToCart = (stk: StockItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemType === 'product' && l.refId === stk.id);
      if (existing) {
        return prev.map((l) =>
          l.key === existing.key ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          key: `${stk.id}-${Date.now()}-${Math.random()}`,
          itemType: 'product',
          refId: stk.id,
          name: stk.name,
          categoryName: stk.category,
          employeeId: '',
          quantity: 1,
          unitPrice: stk.sellingPrice,
          discount: 0,
        },
      ];
    });
  };

  const handleCloudSyncFeedback = (
    cloudSync?: { synced?: boolean; configured?: boolean; error?: string },
    syncedLabel?: string,
    localOnlyLabel?: string
  ) => {
    if (cloudSync?.configured) {
      if (cloudSync.synced) {
        setSyncWarning('');
        return `${syncedLabel || 'Saved & synced to Google Sheets!'}`;
      }
      setSyncWarning(
        cloudSync.error ||
          'Google Sheets sync did not finish for this sale. Click Retry Sync Now to push it to Google Sheets.'
      );
      return `${localOnlyLabel || 'Saved locally (Google Sheets sync pending).'} `;
    }
    setSyncWarning('');
    return localOnlyLabel || syncedLabel || 'Saved!';
  };

  const handleRetrySync = async () => {
    setRetryingSync(true);
    setError('');
    try {
      await apiFetch('/api/workspace/sheets/sync', { method: 'POST' });
      setSyncWarning('');
      setSuccessMsg('Pending POS transactions synced to Google Sheets successfully.');
      await loadData();
    } catch (err) {
      setSyncWarning(err instanceof Error ? err.message : 'Google Sheets sync retry failed.');
    } finally {
      setRetryingSync(false);
    }
  };

  const handleCompleteSale = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setSyncWarning('');
    if (cart.length === 0) {
      setError('Add at least one service or retail product to checkout.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{
        transaction: POSTransactionRecord;
        cloudSync?: { synced?: boolean; configured?: boolean; error?: string };
      }>('/api/pos/transactions', {
        method: 'POST',
        body: JSON.stringify({
          date: txDate,
          customerId: selectedCustomerId || undefined,
          customerName: selectedCustomerId ? undefined : guestName,
          appointmentId: prefill?.appointmentId,
          walkInId: prefill?.walkInId,
          items: cart.map((c) => ({
            itemType: c.itemType,
            refId: c.refId,
            employeeId: c.employeeId || undefined,
            quantity: c.quantity,
            unitPrice: c.unitPrice,
            discount: c.discount,
          })),
          discountTotal,
          tipAmount,
          tipEmployeeId: tipAmount > 0 ? tipEmployeeId || cart.find((c) => c.employeeId)?.employeeId : undefined,
          payments: payments.filter((p) => Number(p.amount) > 0),
          notes,
        }),
      });
      setLastReceipt(res.transaction);
      setCart([]);
      setDiscountTotal(0);
      setTipAmount(0);
      setNotes('');
      setPaymentTouched(false);
      setPayments([{ method: 'Cash', amount: 0, reference: '', giftCardCode: '' }]);
      onClearPrefill?.();
      setSuccessMsg(
        handleCloudSyncFeedback(
          res.cloudSync,
          `Transaction ${res.transaction.reference} saved & synced to Google Sheets! Commissions, lunch deduction, and inventory updated.`,
          `Transaction ${res.transaction.reference} saved! Commissions, lunch deduction, and inventory updated.`
        )
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFollowUpPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payingTx) return;
    setError('');
    setSyncWarning('');
    try {
      const res = await apiFetch<{
        cloudSync?: { synced?: boolean; configured?: boolean; error?: string };
      }>(`/api/pos/transactions/${payingTx.id}/payment`, {
        method: 'POST',
        body: JSON.stringify({
          method: followUpMethod,
          amount: followUpAmount,
          reference: followUpRef,
        }),
      });
      setPayingTx(null);
      setSuccessMsg(
        handleCloudSyncFeedback(
          res.cloudSync,
          `Recorded balance payment of ${formatUGX(followUpAmount)} and synced to Google Sheets.`,
          `Recorded balance payment of ${formatUGX(followUpAmount)}.`
        )
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const handleConfirmReverse = async () => {
    if (!reverseTarget) return;
    setError('');
    setSyncWarning('');
    try {
      const res = await apiFetch<{
        cloudSync?: { synced?: boolean; configured?: boolean; error?: string };
      }>(`/api/pos/transactions/${reverseTarget.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reverseReason || 'Authorized POS Reversal' }),
      });
      setReverseTarget(null);
      setReverseReason('');
      setSuccessMsg(
        handleCloudSyncFeedback(
          res.cloudSync,
          'Transaction reversed, commissions/inventory recalculated, and synced to Google Sheets.',
          'Transaction reversed and commissions/inventory recalculated.'
        )
      );
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reversal failed.');
      setReverseTarget(null);
    }
  };

  const filteredServices = services.filter(
    (s) =>
      s.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      s.categoryName.toLowerCase().includes(catalogSearch.toLowerCase())
  );
  const filteredProducts = products.filter(
    (p) =>
      p.name.toLowerCase().includes(catalogSearch.toLowerCase()) ||
      p.brand.toLowerCase().includes(catalogSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 p-1 bg-white border border-[#1D1717]/10 rounded-xl">
          <button
            onClick={() => setSubTab('terminal')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'terminal' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
            }`}
          >
            POS Checkout Terminal
          </button>
          <button
            onClick={() => setSubTab('history')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
              subTab === 'history' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
            }`}
          >
            Sales &amp; Transaction Ledger ({transactions.length})
          </button>
        </div>

        {lastReceipt && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadReceiptPdf(lastReceipt, branding)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1D1717] text-white text-xs font-semibold cursor-pointer"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Download Last Receipt ({lastReceipt.reference})</span>
            </button>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-semibold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
          {error}
        </div>
      )}
      {syncWarning && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs font-medium flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="leading-relaxed">
              <strong>Google Sheets Sync Pending:</strong> {syncWarning}
            </span>
          </div>
          <button
            type="button"
            disabled={retryingSync}
            onClick={() => void handleRetrySync()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1D1717] text-white text-xs font-semibold hover:bg-[#1D1717]/85 disabled:opacity-50 cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retryingSync ? 'animate-spin' : ''}`} />
            <span>{retryingSync ? 'Syncing...' : 'Retry Sync Now'}</span>
          </button>
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {subTab === 'terminal' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Service & Product Catalog */}
          <div className="lg:col-span-7 bg-white border border-[#1D1717]/10 rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-[#F8EEEB] rounded-lg w-fit">
                <button
                  onClick={() => setCatalogTab('services')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                    catalogTab === 'services' ? 'bg-white text-[#1D1717] shadow-xs' : 'text-[#1D1717]/65'
                  }`}
                >
                  Salon Services ({services.length})
                </button>
                <button
                  onClick={() => setCatalogTab('products')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                    catalogTab === 'products' ? 'bg-white text-[#1D1717] shadow-xs' : 'text-[#1D1717]/65'
                  }`}
                >
                  Retail Products ({products.length})
                </button>
              </div>

              <div className="relative flex-1 sm:max-w-xs">
                <Search className="w-3.5 h-3.5 text-[#1D1717]/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search services or products..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs focus:outline-none focus:border-[#E83B84]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[540px] overflow-y-auto pr-1">
              {catalogTab === 'services'
                ? filteredServices.map((srv) => (
                    <button
                      key={srv.id}
                      type="button"
                      onClick={() => addServiceToCart(srv)}
                      className="text-left p-3.5 rounded-xl border border-[#1D1717]/10 hover:border-[#E83B84] hover:bg-[#F3BFD3]/20 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-[#1D1717]">{srv.name}</span>
                        <span className="text-xs font-mono font-bold text-[#E83B84] shrink-0">
                          {formatUGX(srv.price)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#1D1717]/60 mt-1">
                        {srv.categoryName} &middot; {srv.durationMinutes} min
                      </div>
                    </button>
                  ))
                : filteredProducts.map((prd) => (
                    <button
                      key={prd.id}
                      type="button"
                      disabled={prd.currentQuantity <= 0}
                      onClick={() => addProductToCart(prd)}
                      className="text-left p-3.5 rounded-xl border border-[#1D1717]/10 hover:border-[#E83B84] hover:bg-[#F3BFD3]/20 transition-colors disabled:opacity-45 cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-[#1D1717]">{prd.name}</span>
                        <span className="text-xs font-mono font-bold text-[#E83B84] shrink-0">
                          {formatUGX(prd.sellingPrice)}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#1D1717]/60 mt-1 font-mono">
                        {prd.brand} &middot; Stock: {prd.currentQuantity} {prd.unit}
                      </div>
                    </button>
                  ))}
            </div>
          </div>

          {/* Right: POS Cart, Stylist Assignment & Split Payments */}
          <form
            onSubmit={handleCompleteSale}
            className="lg:col-span-5 bg-white border border-[#1D1717]/10 rounded-2xl p-5 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1D1717]/10">
                <h3 className="text-base font-bold text-[#1D1717]">Current Bill</h3>
                <input
                  type="date"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="px-2.5 py-1 rounded-lg border border-[#1D1717]/15 text-xs font-mono"
                />
              </div>

              {/* Customer selection */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#1D1717]/70 mb-1">
                    Registered Customer
                  </label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs bg-white"
                  >
                    <option value="">Walk-In / Unregistered Guest</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.fullName} ({c.phone})
                      </option>
                    ))}
                  </select>
                </div>
                {!selectedCustomerId && (
                  <div>
                    <label className="block text-[11px] font-semibold text-[#1D1717]/70 mb-1">
                      Guest Name
                    </label>
                    <input
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Cart Lines */}
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[#1D1717]/50 border border-dashed border-[#1D1717]/15 rounded-xl">
                    Tap a service or retail product on the left to build the bill.
                  </div>
                ) : (
                  cart.map((line) => (
                    <div
                      key={line.key}
                      className="p-3 rounded-xl bg-[#F8EEEB]/70 border border-[#1D1717]/10 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#1D1717] truncate">
                          {line.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-mono font-semibold">
                            {formatUGX(line.unitPrice * line.quantity - line.discount)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setCart((p) => p.filter((x) => x.key !== line.key))}
                            className="text-red-600 hover:text-red-800 cursor-pointer"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-2 items-center text-xs">
                        {line.itemType === 'service' ? (
                          <select
                            required
                            value={line.employeeId}
                            onChange={(e) =>
                              setCart((p) =>
                                p.map((x) =>
                                  x.key === line.key ? { ...x, employeeId: e.target.value } : x
                                )
                              )
                            }
                            className="col-span-6 px-2 py-1 rounded-lg border border-[#1D1717]/15 bg-white text-xs"
                          >
                            <option value="">Assign Stylist *</option>
                            {employees.map((emp) => (
                              <option key={emp.id} value={emp.id}>
                                {emp.fullName}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="col-span-6 text-[11px] text-[#1D1717]/60">Retail Stock</span>
                        )}
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) =>
                            setCart((p) =>
                              p.map((x) =>
                                x.key === line.key ? { ...x, quantity: Math.max(1, Number(e.target.value)) } : x
                              )
                            )
                          }
                          className="col-span-2 px-2 py-1 rounded-lg border border-[#1D1717]/15 bg-white text-xs font-mono text-center"
                          title="Qty"
                        />
                        <input
                          type="number"
                          min={0}
                          step={500}
                          value={line.unitPrice}
                          onChange={(e) =>
                            setCart((p) =>
                              p.map((x) =>
                                x.key === line.key ? { ...x, unitPrice: Math.max(0, Number(e.target.value)) } : x
                              )
                            )
                          }
                          className="col-span-4 px-2 py-1 rounded-lg border border-[#1D1717]/15 bg-white text-xs font-mono text-right"
                          title="Unit Price UGX"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Discount & Tips */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1D1717]/10 text-xs">
                <div>
                  <label className="block text-[11px] font-semibold text-[#1D1717]/70 mb-1">
                    Discount (UGX)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={discountTotal}
                    onChange={(e) => setDiscountTotal(Math.max(0, Number(e.target.value)))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#1D1717]/70 mb-1">
                    Tip (UGX)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={tipAmount}
                    onChange={(e) => setTipAmount(Math.max(0, Number(e.target.value)))}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#1D1717]/70 mb-1">
                    Tip For
                  </label>
                  <select
                    value={tipEmployeeId}
                    onChange={(e) => setTipEmployeeId(e.target.value)}
                    disabled={tipAmount <= 0}
                    className="w-full px-2 py-1.5 rounded-lg border border-[#1D1717]/15 bg-white text-xs disabled:opacity-45"
                  >
                    <option value="">Stylist</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Split Payments */}
              <div className="space-y-2 pt-2 border-t border-[#1D1717]/10">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#1D1717]">
                    Payment Reconciliation (Split or Partial)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPaymentTouched(true);
                      setPayments((p) => [
                        ...p,
                        { method: 'Mobile Money', amount: balanceDue, reference: '', giftCardCode: '' },
                      ]);
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E83B84] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3 h-3" /> Add Split Method
                  </button>
                </div>

                {payments.map((pay, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center text-xs">
                    <select
                      value={pay.method}
                      onChange={(e) => {
                        setPaymentTouched(true);
                        const m = e.target.value as PaymentMethod;
                        setPayments((p) => p.map((x, i) => (i === idx ? { ...x, method: m } : x)));
                      }}
                      className="col-span-4 px-2 py-1.5 rounded-lg border border-[#1D1717]/15 bg-white"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Mobile Money">Mobile Money</option>
                      <option value="Bank Transfer">Bank Transfer</option>
                      <option value="Card">Card</option>
                      <option value="Gift Card">Gift Card</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={pay.amount}
                      onChange={(e) => {
                        setPaymentTouched(true);
                        const val = Math.max(0, Number(e.target.value));
                        setPayments((p) => p.map((x, i) => (i === idx ? { ...x, amount: val } : x)));
                      }}
                      className="col-span-4 px-2 py-1.5 rounded-lg border border-[#1D1717]/15 font-mono text-right"
                      placeholder="Amount"
                    />
                    {pay.method === 'Gift Card' ? (
                      <input
                        value={pay.giftCardCode}
                        onChange={(e) =>
                          setPayments((p) =>
                            p.map((x, i) => (i === idx ? { ...x, giftCardCode: e.target.value } : x))
                          )
                        }
                        placeholder="Card Code"
                        className="col-span-3 px-2 py-1.5 rounded-lg border border-[#1D1717]/15 font-mono"
                      />
                    ) : (
                      <input
                        value={pay.reference}
                        onChange={(e) =>
                          setPayments((p) =>
                            p.map((x, i) => (i === idx ? { ...x, reference: e.target.value } : x))
                          )
                        }
                        placeholder="Ref / MoMo ID"
                        className="col-span-3 px-2 py-1.5 rounded-lg border border-[#1D1717]/15"
                      />
                    )}
                    {payments.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentTouched(true);
                          setPayments((p) => p.filter((_, i) => i !== idx));
                        }}
                        className="col-span-1 text-red-600 flex justify-center cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Totals & Checkout CTA */}
            <div className="pt-3 border-t border-[#1D1717]/10 space-y-2">
              <div className="flex justify-between text-xs text-[#1D1717]/70">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">{formatUGX(subtotal)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-[#1D1717]">
                <span>Bill Total</span>
                <span className="font-mono tabular-nums text-[#E83B84]">{formatUGX(grandTotal)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span>Paying Now</span>
                <span className="font-mono tabular-nums font-semibold">{formatUGX(totalPaidInput)}</span>
              </div>
              {balanceDue > 0 && (
                <div className="flex justify-between text-xs text-amber-700 font-semibold">
                  <span>Remaining Balance Due (Partial Deposit)</span>
                  <span className="font-mono tabular-nums">{formatUGX(balanceDue)}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || cart.length === 0}
                className="w-full mt-2 py-3 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white font-semibold text-sm transition-colors disabled:opacity-50 cursor-pointer"
              >
                {submitting
                  ? 'Processing Transaction...'
                  : balanceDue > 0
                  ? 'Save Partial Payment & Generate Receipt'
                  : 'Complete Sale & Calculate Commissions'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* POS TRANSACTION HISTORY */
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <h3 className="text-base font-bold text-[#1D1717] mb-4">POS Transaction Ledger</h3>
          {transactions.length === 0 ? (
            <p className="text-sm text-[#1D1717]/60 py-8 text-center">
              No POS transactions recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-3 px-3">Reference</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3">Items</th>
                    <th className="py-3 px-3 text-right">Total</th>
                    <th className="py-3 px-3 text-right">Paid</th>
                    <th className="py-3 px-3 text-right">Due</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#F8EEEB]/50">
                      <td className="py-3 px-3 font-mono font-semibold text-[#1D1717]">
                        {tx.reference}
                        {tx.isHistorical && (
                          <span className="ml-1.5 text-[10px] text-[#1D1717]/50">(Hist)</span>
                        )}
                      </td>
                      <td className="py-3 px-3 font-mono">{tx.date}</td>
                      <td className="py-3 px-3 font-medium">{tx.customerName}</td>
                      <td className="py-3 px-3 text-[#1D1717]/75">
                        {tx.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold">
                        {formatUGX(tx.totalAmount)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums">
                        {formatUGX(tx.amountPaid)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-amber-700">
                        {formatUGX(tx.balanceDue)}
                      </td>
                      <td className="py-3 px-3 font-semibold">
                        <span
                          className={
                            tx.status === 'Completed'
                              ? 'text-emerald-700'
                              : tx.status === 'Partial'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap space-x-2">
                        <button
                          onClick={() => downloadReceiptPdf(tx, branding)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] cursor-pointer"
                        >
                          <FileDown className="w-3 h-3" /> PDF
                        </button>
                        {tx.balanceDue > 0 && tx.status === 'Partial' && (
                          <button
                            onClick={() => {
                              setPayingTx(tx);
                              setFollowUpAmount(tx.balanceDue);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#E83B84] text-white font-semibold cursor-pointer"
                          >
                            <CreditCard className="w-3 h-3" /> Collect
                          </button>
                        )}
                        {['owner', 'manager'].includes(user.role) &&
                          !tx.isHistorical &&
                          tx.status !== 'Reversed' && (
                            <button
                              onClick={() => setReverseTarget(tx)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" /> Reverse
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Follow-up Partial Payment Modal */}
      {payingTx && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleFollowUpPayment}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4"
          >
            <h3 className="text-base font-bold">
              Collect Balance — {payingTx.reference}
            </h3>
            <p className="text-xs text-[#1D1717]/70">
              Customer: {payingTx.customerName} &middot; Remaining Due:{' '}
              <span className="font-mono font-bold text-[#E83B84]">
                {formatUGX(payingTx.balanceDue)}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Method</label>
                <select
                  value={followUpMethod}
                  onChange={(e) => setFollowUpMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                >
                  <option value="Cash">Cash</option>
                  <option value="Mobile Money">Mobile Money</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Card">Card</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold mb-1">Amount (UGX)</label>
                <input
                  type="number"
                  min={1}
                  max={payingTx.balanceDue}
                  required
                  value={followUpAmount}
                  onChange={(e) => setFollowUpAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
            </div>
            <input
              value={followUpRef}
              onChange={(e) => setFollowUpRef(e.target.value)}
              placeholder="Payment reference (optional)"
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPayingTx(null)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
              >
                Record Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Controlled Reversal Modal */}
      {reverseTarget && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4">
            <h3 className="text-base font-bold text-red-700">
              Reverse Transaction {reverseTarget.reference}?
            </h3>
            <p className="text-xs text-[#1D1717]/75">
              This preserves the audit trail, restores retail inventory, and recalculates employee
              commissions for {reverseTarget.date}.
            </p>
            <input
              required
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="Enter mandatory reversal reason..."
              className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReverseTarget(null)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!reverseReason.trim()}
                onClick={() => void handleConfirmReverse()}
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Confirm Reversal
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={false}
        title=""
        description=""
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </div>
  );
};
