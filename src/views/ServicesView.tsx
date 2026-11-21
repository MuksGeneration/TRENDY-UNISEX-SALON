import React, { useEffect, useState } from 'react';
import { Plus, Edit3, Image as ImageIcon } from 'lucide-react';
import { apiFetch, formatUGX } from '../lib/api';
import type { SalonBranding, ServiceCategory, ServiceItem, SessionUser } from '../types';

export const ServicesView: React.FC<{ user: SessionUser; branding?: SalonBranding }> = ({
  user,
  branding,
}) => {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [pricingHistory, setPricingHistory] = useState<
    Array<{ id: string; serviceName: string; oldPrice: number; newPrice: number; changedBy: string; changedAt: string }>
  >([]);
  const [catFilter, setCatFilter] = useState('all');
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [price, setPrice] = useState(25000);
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [error, setError] = useState('');

  const canManage = ['owner', 'manager'].includes(user.role);

  const load = async () => {
    try {
      const res = await apiFetch<{
        categories: ServiceCategory[];
        services: ServiceItem[];
        pricingHistory: typeof pricingHistory;
      }>('/api/services');
      setCategories(res.categories);
      setServices(res.services);
      setPricingHistory(res.pricingHistory);
      if (res.categories.length > 0 && !categoryId) setCategoryId(res.categories[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load services.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setName('');
    setPrice(25000);
    setDurationMinutes(45);
    setShowModal(true);
  };

  const openEdit = (srv: ServiceItem) => {
    setEditing(srv);
    setName(srv.name);
    setCategoryId(srv.categoryId);
    setPrice(srv.price);
    setDurationMinutes(srv.durationMinutes);
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editing) {
        await apiFetch(`/api/services/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, categoryId, price, durationMinutes }),
        });
      } else {
        await apiFetch('/api/services', {
          method: 'POST',
          body: JSON.stringify({ name, categoryId, price, durationMinutes }),
        });
      }
      setShowModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const toggleActive = async (srv: ServiceItem) => {
    await apiFetch(`/api/services/${srv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !srv.active }),
    });
    await load();
  };

  const filtered = services.filter((s) => catFilter === 'all' || s.categoryId === catFilter);

  const bannerUrl =
    branding?.promotionalBannerUrl || '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg';

  return (
    <div className="space-y-6">
      {/* Unboxed Salon Service Menu Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#1D1717]/10">
        <div className="space-y-0.5">
          <div className="text-sm font-bold text-[#1D1717]">
            {branding?.businessName || 'Trendy Unisex Salon'} &middot; Service Menu &amp; Commission Rates
          </div>
          <div className="text-xs text-[#1D1717]/65">
            {branding?.audienceTagline || 'For Him · For Her · For Everyone'}
            {branding?.walkInsWelcome !== false ? ' · Walk-Ins Welcome' : ''}
            {' · '}
            <span className="font-mono font-semibold text-[#E83B84]">Book: {branding?.phone || '0740301726'}</span>
            {' · '}
            {branding?.socialHandle || '@Trendyunisex.salon'} ({(branding?.socialPlatforms || ['TikTok', 'Instagram', 'Facebook']).join(' · ')})
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowBanner((v) => !v)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F3BFD3]/30 text-xs font-semibold text-[#1D1717] w-fit cursor-pointer"
        >
          <ImageIcon className="w-3.5 h-3.5 text-[#E83B84]" />
          <span>{showBanner ? 'Hide Service Banner' : 'View Service Banner'}</span>
        </button>
      </div>

      {showBanner && bannerUrl && (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-3">
          <img
            src={bannerUrl}
            alt="Trendy Unisex Salon Services Banner"
            referrerPolicy="no-referrer"
            className="w-full max-h-96 object-contain rounded-xl bg-[#F8EEEB]/40 mx-auto block"
          />
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white text-xs font-medium"
          >
            <option value="all">All Service Categories ({categories.length})</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({Math.round(c.commissionRate * 100)}% comm.)
              </option>
            ))}
          </select>
        </div>

        {canManage && (
          <button
            onClick={openNew}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> Add Service
          </button>
        )}
      </div>

      {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}

      <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                <th className="py-3 px-3">Service Name</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3 text-right">Duration</th>
                <th className="py-3 px-3 text-right">Commission Rate</th>
                <th className="py-3 px-3 text-right">Price (UGX)</th>
                <th className="py-3 px-3">Status</th>
                {canManage && <th className="py-3 px-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1D1717]/10">
              {filtered.map((s) => {
                const cat = categories.find((c) => c.id === s.categoryId);
                const rate = s.commissionRateOverride ?? cat?.commissionRate ?? 0.4;
                return (
                  <tr key={s.id} className="hover:bg-[#F8EEEB]/50">
                    <td className="py-3 px-3 font-semibold text-[#1D1717]">{s.name}</td>
                    <td className="py-3 px-3 text-[#1D1717]/75">{s.categoryName}</td>
                    <td className="py-3 px-3 text-right font-mono">{s.durationMinutes} min</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-[#E83B84]">
                      {Math.round(rate * 100)}%
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold">
                      {formatUGX(s.price)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={s.active ? 'text-emerald-700 font-semibold' : 'text-[#1D1717]/45'}>
                        {s.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="py-3 px-3 text-right space-x-2 whitespace-nowrap">
                        <button
                          onClick={() => openEdit(s)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={() => void toggleActive(s)}
                          className="px-2.5 py-1 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] cursor-pointer"
                        >
                          {s.active ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pricingHistory.length > 0 && (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6">
          <h3 className="text-sm font-bold mb-3">Service Price Change History (Historical Transactions Unaffected)</h3>
          <div className="space-y-1.5 text-xs">
            {pricingHistory.slice(0, 10).map((h) => (
              <div key={h.id} className="flex justify-between py-1.5 border-b border-[#1D1717]/10">
                <span>
                  <strong>{h.serviceName}</strong>: {formatUGX(h.oldPrice)} &rarr; {formatUGX(h.newPrice)}
                </span>
                <span className="text-[#1D1717]/55 font-mono">
                  {h.changedBy} &middot; {h.changedAt.slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleSave}
            className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 text-xs"
          >
            <h3 className="text-base font-bold">{editing ? 'Edit Service' : 'Add New Service'}</h3>
            <div>
              <label className="block font-semibold mb-1">Service Name *</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Category *</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({Math.round(c.commissionRate * 100)}% commission)
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold mb-1">Price (UGX) *</label>
                <input
                  type="number"
                  min={500}
                  step={500}
                  required
                  value={price}
                  onChange={(e) => setPrice(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Duration (Min)</label>
                <input
                  type="number"
                  min={10}
                  step={5}
                  required
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
              >
                Save Service
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
