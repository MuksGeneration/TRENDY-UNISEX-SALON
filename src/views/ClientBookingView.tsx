import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  Scissors,
  Search,
  Printer,
  ArrowLeft,
  Phone,
  MapPin,
  X,
} from 'lucide-react';
import { apiFetch, formatUGX } from '../lib/api';
import {
  getSalonTodayIso,
  msUntilNextSalonMidnight,
  SALON_MIDNIGHT_OPERATING_HOURS,
} from '../lib/date';
import type { SalonBranding } from '../types';

interface PublicStylist {
  id: string;
  fullName: string;
  roleTitle: string;
  specialties: string[];
  avatarUrl?: string;
  workingDays: string[];
  defaultShiftStart: string;
  defaultShiftEnd: string;
}

interface PublicService {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  durationMinutes: number;
  qualifiedEmployeeIds: string[];
}

interface PublicCategory {
  id: string;
  name: string;
  description: string;
}

interface AvailabilitySlot {
  time: string;
  available: boolean;
  availableStylistCount: number;
  reason?: string;
}

interface ConfirmedBooking {
  reference: string;
  customerName: string;
  customerPhone?: string;
  employeeName: string;
  serviceNames: string[];
  date: string;
  startTime: string;
  durationMinutes: number;
  estimatedTotal: number;
  status: string;
  source: string;
  notes?: string;
}

interface ClientBookingViewProps {
  standalone?: boolean;
  branding?: SalonBranding;
  onBackToLogin?: () => void;
  onBookingCreated?: () => void;
}

export const ClientBookingView: React.FC<ClientBookingViewProps> = ({
  standalone = false,
  branding: initialBranding,
  onBackToLogin,
  onBookingCreated,
}) => {
  const [today, setToday] = useState<string>(() => getSalonTodayIso());

  const [branding, setBranding] = useState<SalonBranding & { operatingHours?: string }>(
    initialBranding || {
      businessName: 'Trendy Unisex Salon',
      tagline: 'Where Beauty Meets Style',
      audienceTagline: 'For Him · For Her · For Everyone',
      location: "Busia District Road, near ASA Microfinance, Madibira 'A', Uganda",
      phone: '0740301726',
      socialHandle: '@Trendyunisex.salon',
      socialPlatforms: ['TikTok', 'Instagram', 'Facebook'],
      walkInsWelcome: true,
      promotionalBannerUrl: '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg',
      backgroundImageUrl:
        '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg',
    }
  );
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [services, setServices] = useState<PublicService[]>([]);
  const [stylists, setStylists] = useState<PublicStylist[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [catFilter, setCatFilter] = useState('all');
  const [serviceSearch, setServiceSearch] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [selectedStylistId, setSelectedStylistId] = useState<string>('any');
  const [selectedDate, setSelectedDate] = useState<string>(() => getSalonTodayIso());
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string>('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextToday = getSalonTodayIso();
      setToday((prev) => {
        if (prev !== nextToday) {
          setSelectedDate((cur) => (cur === prev ? nextToday : cur));
        }
        return nextToday;
      });
    }, msUntilNextSalonMidnight());
    return () => window.clearTimeout(timer);
  }, [today]);

  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientGender, setClientGender] = useState<'' | 'Female' | 'Male' | 'Other'>('');
  const [clientNotes, setClientNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmedBooking, setConfirmedBooking] = useState<ConfirmedBooking | null>(null);

  // Lookup existing booking
  const [lookupRef, setLookupRef] = useState('');
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [lookupResult, setLookupResult] = useState<ConfirmedBooking | null>(null);

  const [avatarErrors, setAvatarErrors] = useState<Record<string, boolean>>({});
  const [heroImgError, setHeroImgError] = useState(false);

  useEffect(() => {
    (async () => {
      setLoadingCatalog(true);
      try {
        const res = await apiFetch<{
          branding: SalonBranding & { operatingHours?: string };
          categories: PublicCategory[];
          services: PublicService[];
          stylists: PublicStylist[];
        }>('/api/public/booking-catalog');
        setBranding(res.branding);
        setCategories(res.categories);
        setServices(res.services);
        setStylists(res.stylists);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load salon booking catalog.');
      } finally {
        setLoadingCatalog(false);
      }
    })();
  }, []);

  const selectedServices = services.filter((s) => selectedServiceIds.includes(s.id));
  const totalDuration =
    selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0) || 60;
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const loadAvailability = async (date: string, employeeId: string, duration: number) => {
    setLoadingSlots(true);
    try {
      const qs = new URLSearchParams({
        date,
        employeeId,
        duration: String(duration),
      });
      const res = await apiFetch<{ date: string; slots: AvailabilitySlot[] }>(
        `/api/public/availability?${qs.toString()}`
      );
      setSlots(res.slots);
      setSelectedTime((prev) => {
        if (prev && res.slots.some((s) => s.time === prev && s.available)) return prev;
        const firstOpen = res.slots.find((s) => s.available);
        return firstOpen ? firstOpen.time : '';
      });
    } catch {
      setSlots([]);
    } finally {
      setLoadingSlots(false);
    }
  };

  useEffect(() => {
    void loadAvailability(selectedDate, selectedStylistId, totalDuration);
  }, [selectedDate, selectedStylistId, totalDuration]);

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (selectedServiceIds.length === 0) {
      setError('Please choose at least one salon service before confirming.');
      return;
    }
    if (!selectedTime) {
      setError('Please select an available time slot.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch<{ booking: ConfirmedBooking }>('/api/public/bookings', {
        method: 'POST',
        body: JSON.stringify({
          fullName: clientName,
          phone: clientPhone,
          email: clientEmail || undefined,
          gender: clientGender || undefined,
          serviceIds: selectedServiceIds,
          employeeId: selectedStylistId,
          date: selectedDate,
          startTime: selectedTime,
          notes: clientNotes || undefined,
        }),
      });
      setConfirmedBooking(res.booking);
      onBookingCreated?.();
      void loadAvailability(selectedDate, selectedStylistId, totalDuration);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete booking.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetBooking = () => {
    setConfirmedBooking(null);
    setSelectedServiceIds([]);
    setClientNotes('');
    setError('');
  };

  const handleLookupBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError('');
    setLookupResult(null);
    setLookupLoading(true);
    try {
      const qs = new URLSearchParams({
        reference: lookupRef.trim(),
        phone: lookupPhone.trim(),
      });
      const res = await apiFetch<{ booking: ConfirmedBooking }>(
        `/api/public/bookings/lookup?${qs.toString()}`
      );
      setLookupResult(res.booking);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Booking lookup failed.');
    } finally {
      setLookupLoading(false);
    }
  };

  const activeCategories = categories.filter((c) =>
    services.some((s) => s.categoryId === c.id)
  );

  const filteredServices = services.filter((s) => {
    if (catFilter !== 'all' && s.categoryId !== catFilter) return false;
    if (
      serviceSearch.trim() &&
      !s.name.toLowerCase().includes(serviceSearch.toLowerCase()) &&
      !s.categoryName.toLowerCase().includes(serviceSearch.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const salonName = branding.businessName || 'Trendy Unisex Salon';
  const backgroundUrl =
    branding.backgroundImageUrl ||
    '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg';

  const bookingContent = (
    <div className="space-y-8">
      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
          {error}
        </div>
      )}

      {loadingCatalog ? (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-10 text-center text-sm text-[#1D1717]/60">
          Loading Trendy Unisex Salon services &amp; live stylist availability...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Service Selection, Stylist & Date/Time */}
          <div className="lg:col-span-8 space-y-6">
            {/* Step 1: Services */}
            <section
              id="booking-services"
              className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1D1717]/10">
                <div>
                  <h2 className="text-lg font-bold text-[#1D1717]">01. Select Salon Services</h2>
                  <p className="text-xs text-[#1D1717]/65 mt-0.5">
                    Choose one or more services · Prices in Uganda Shillings (UGX)
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-[#1D1717]/40 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={serviceSearch}
                    onChange={(e) => setServiceSearch(e.target.value)}
                    placeholder="Search braids, haircut, nails..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs focus:outline-none focus:border-[#E83B84]"
                  />
                </div>
              </div>

              {/* Category segmented filter */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCatFilter('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    catFilter === 'all'
                      ? 'bg-[#E83B84] text-white'
                      : 'bg-[#F8EEEB] text-[#1D1717]/75 hover:bg-[#F3BFD3]/50'
                  }`}
                >
                  All Services ({services.length})
                </button>
                {activeCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCatFilter(cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      catFilter === cat.id
                        ? 'bg-[#E83B84] text-white'
                        : 'bg-[#F8EEEB] text-[#1D1717]/75 hover:bg-[#F3BFD3]/50'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {filteredServices.length === 0 ? (
                <p className="text-xs text-[#1D1717]/60 py-8 text-center">
                  No active services match your search filter.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {filteredServices.map((srv) => {
                    const isSelected = selectedServiceIds.includes(srv.id);
                    return (
                      <button
                        key={srv.id}
                        type="button"
                        onClick={() => toggleService(srv.id)}
                        className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                          isSelected
                            ? 'border-[#E83B84] bg-[#F3BFD3]/20'
                            : 'border-[#1D1717]/10 hover:border-[#E83B84]/50 hover:bg-[#F8EEEB]/60'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-bold text-[#1D1717]">{srv.name}</span>
                          <span className="text-xs font-mono tabular-nums font-bold text-[#E83B84] shrink-0">
                            {formatUGX(srv.price)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1.5 text-xs text-[#1D1717]/65">
                          <span>
                            {srv.categoryName} &middot;{' '}
                            <span className="font-mono tabular-nums">{srv.durationMinutes} min</span>
                          </span>
                          {isSelected && (
                            <span className="inline-flex items-center gap-1 text-[#E83B84] font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Selected
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Step 2: Stylist */}
            <section
              id="booking-stylists"
              className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4"
            >
              <div className="pb-3 border-b border-[#1D1717]/10">
                <h2 className="text-lg font-bold text-[#1D1717]">02. Choose Your Stylist</h2>
                <p className="text-xs text-[#1D1717]/65 mt-0.5">
                  Select a specialist or let us assign the first available stylist for your services.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedStylistId('any')}
                  className={`text-left p-4 rounded-xl border transition-colors cursor-pointer flex items-center gap-3 ${
                    selectedStylistId === 'any'
                      ? 'border-[#E83B84] bg-[#F3BFD3]/20'
                      : 'border-[#1D1717]/10 hover:border-[#E83B84]/50'
                  }`}
                >
                  <div className="w-11 h-11 rounded-full bg-[#1D1717] text-white flex items-center justify-center shrink-0">
                    <Scissors className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#1D1717]">Any Available Stylist</div>
                    <div className="text-xs text-[#1D1717]/60">
                      Fastest confirmation · Matched to your service
                    </div>
                  </div>
                </button>

                {stylists.map((emp) => {
                  const isSelected = selectedStylistId === emp.id;
                  const showAvatar = Boolean(emp.avatarUrl) && !avatarErrors[emp.id];
                  const initials = emp.fullName
                    .split(' ')
                    .map((p) => p[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => setSelectedStylistId(emp.id)}
                      className={`text-left p-4 rounded-xl border transition-colors cursor-pointer flex items-start gap-3 ${
                        isSelected
                          ? 'border-[#E83B84] bg-[#F3BFD3]/20'
                          : 'border-[#1D1717]/10 hover:border-[#E83B84]/50'
                      }`}
                    >
                      {showAvatar ? (
                        <img
                          src={emp.avatarUrl}
                          alt={emp.fullName}
                          referrerPolicy="no-referrer"
                          onError={() => setAvatarErrors((p) => ({ ...p, [emp.id]: true }))}
                          className="w-11 h-11 rounded-full object-cover border border-[#1D1717]/15 shrink-0"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-[#F3BFD3]/70 text-[#1D1717] font-bold text-xs flex items-center justify-center shrink-0">
                          {initials}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-[#1D1717] truncate">
                          {emp.fullName}
                        </div>
                        <div className="text-xs text-[#E83B84] font-medium truncate">
                          {emp.roleTitle}
                        </div>
                        <div className="text-[11px] text-[#1D1717]/60 mt-1 line-clamp-2">
                          {emp.specialties.join(' · ')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Step 3: Date & Available Time Slots */}
            <section className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1D1717]/10">
                <div>
                  <h2 className="text-lg font-bold text-[#1D1717]">03. Pick Date &amp; Time Slot</h2>
                  <p className="text-xs text-[#1D1717]/65 mt-0.5">
                    Live schedule check · Estimated duration:{' '}
                    <span className="font-mono tabular-nums font-semibold">{totalDuration} min</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-[#F8EEEB]/50">
                  <Calendar className="w-4 h-4 text-[#E83B84]" />
                  <input
                    type="date"
                    min={today}
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="text-xs font-mono bg-transparent focus:outline-none"
                  />
                </div>
              </div>

              {loadingSlots ? (
                <div className="py-8 text-center text-xs text-[#1D1717]/60">
                  Checking real-time stylist availability...
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 gap-2">
                  {slots.map((slot) => {
                    const isPicked = selectedTime === slot.time && slot.available;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        disabled={!slot.available}
                        onClick={() => setSelectedTime(slot.time)}
                        className={`px-3 py-2.5 rounded-xl border text-center transition-colors ${
                          !slot.available
                            ? 'border-[#1D1717]/10 bg-[#F8EEEB]/70 text-[#1D1717]/35 cursor-not-allowed'
                            : isPicked
                            ? 'border-[#E83B84] bg-[#E83B84] text-white cursor-pointer'
                            : 'border-[#1D1717]/15 bg-white hover:border-[#E83B84] hover:bg-[#F3BFD3]/20 text-[#1D1717] cursor-pointer'
                        }`}
                      >
                        <div className="text-xs font-mono tabular-nums font-bold">{slot.time}</div>
                        <div className="text-[10px] mt-0.5">
                          {slot.available
                            ? selectedStylistId === 'any'
                              ? `${slot.availableStylistCount} open`
                              : 'Open'
                            : slot.reason || 'Booked'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Right Sticky Column: Booking Summary & Client Form / Confirmation */}
          <div className="lg:col-span-4 space-y-6 lg:sticky lg:top-24">
            {confirmedBooking ? (
              <div className="bg-white border border-emerald-300 rounded-2xl p-6 space-y-4">
                <div className="flex items-start gap-3 pb-3 border-b border-[#1D1717]/10">
                  <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">
                      Booking Confirmed
                    </div>
                    <h3 className="text-lg font-bold text-[#1D1717]">
                      {confirmedBooking.customerName}
                    </h3>
                    <div className="text-xs font-mono text-[#1D1717]/65 mt-0.5">
                      Ref: <strong className="text-[#1D1717]">{confirmedBooking.reference}</strong>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-[#1D1717]/60">Date &amp; Time</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {confirmedBooking.date} at {confirmedBooking.startTime}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#1D1717]/60">Stylist</span>
                    <span className="font-semibold text-[#1D1717]">
                      {confirmedBooking.employeeName}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#1D1717]/60">Duration</span>
                    <span className="font-mono tabular-nums">
                      {confirmedBooking.durationMinutes} min
                    </span>
                  </div>
                  <div className="pt-2 border-t border-[#1D1717]/10">
                    <div className="text-[#1D1717]/60 mb-1">Booked Services</div>
                    <div className="font-semibold text-[#1D1717]">
                      {confirmedBooking.serviceNames.join(' · ')}
                    </div>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-[#1D1717]/10">
                    <span className="font-bold text-[#1D1717]">Estimated Total</span>
                    <span className="text-base font-mono tabular-nums font-bold text-[#E83B84]">
                      {formatUGX(confirmedBooking.estimatedTotal)}
                    </span>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-[#F8EEEB] text-[11px] text-[#1D1717]/75 space-y-1">
                  <div className="font-semibold text-[#1D1717]">{salonName}</div>
                  <div>{branding.location}</div>
                  <div className="font-mono">Need to reschedule? Call {branding.phone || '0740301726'}</div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-1 no-print">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-xs font-semibold cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print Pass
                  </button>
                  <button
                    type="button"
                    onClick={handleResetBooking}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white text-xs font-semibold cursor-pointer"
                  >
                    Book Another
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={handleSubmitBooking}
                className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4"
              >
                <div className="pb-3 border-b border-[#1D1717]/10">
                  <h3 className="text-base font-bold text-[#1D1717]">Your Booking Summary</h3>
                  <p className="text-xs text-[#1D1717]/60 mt-0.5">
                    No prepayment required · Pay at the salon after service
                  </p>
                </div>

                {/* Selected services */}
                <div className="space-y-2">
                  {selectedServices.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-[#1D1717]/15 text-center text-xs text-[#1D1717]/55">
                      Select one or more services on the left to start your booking.
                    </div>
                  ) : (
                    selectedServices.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-2 py-2 border-b border-[#1D1717]/10 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-[#1D1717] truncate">{s.name}</div>
                          <div className="text-[11px] text-[#1D1717]/60 font-mono tabular-nums">
                            {s.durationMinutes} min &middot; {formatUGX(s.price)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleService(s.id)}
                          className="p-1 text-[#1D1717]/45 hover:text-red-700 cursor-pointer"
                          aria-label={`Remove ${s.name}`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Slot & total */}
                <div className="p-3.5 rounded-xl bg-[#F8EEEB]/80 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#1D1717]/65">Stylist</span>
                    <span className="font-semibold text-[#1D1717]">
                      {selectedStylistId === 'any'
                        ? 'Any Available Stylist'
                        : stylists.find((e) => e.id === selectedStylistId)?.fullName || 'Selected'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#1D1717]/65">Date &amp; Time</span>
                    <span className="font-mono tabular-nums font-semibold">
                      {selectedDate} {selectedTime ? `· ${selectedTime}` : '· Pick time'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#1D1717]/65">Est. Duration</span>
                    <span className="font-mono tabular-nums">
                      {selectedServices.length > 0 ? `${totalDuration} min` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-[#1D1717]/10">
                    <span className="font-bold text-[#1D1717]">Estimated Total</span>
                    <span className="text-sm font-mono tabular-nums font-bold text-[#E83B84]">
                      {formatUGX(totalPrice)}
                    </span>
                  </div>
                </div>

                {/* Client info */}
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-[#1D1717] mb-1">
                      Full Name *
                    </label>
                    <input
                      required
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="e.g. Sarah Namukasa"
                      className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 focus:outline-none focus:border-[#E83B84]"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-[#1D1717] mb-1">
                      Phone Number *
                    </label>
                    <input
                      required
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="e.g. 0772 123 456"
                      className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono focus:outline-none focus:border-[#E83B84]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block font-semibold text-[#1D1717] mb-1">
                        Email (Optional)
                      </label>
                      <input
                        type="email"
                        value={clientEmail}
                        onChange={(e) => setClientEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 focus:outline-none focus:border-[#E83B84]"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#1D1717] mb-1">
                        Category
                      </label>
                      <select
                        value={clientGender}
                        onChange={(e) =>
                          setClientGender(e.target.value as typeof clientGender)
                        }
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                      >
                        <option value="">Prefer not to say</option>
                        <option value="Female">For Her</option>
                        <option value="Male">For Him</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block font-semibold text-[#1D1717] mb-1">
                      Styling Notes (Optional)
                    </label>
                    <textarea
                      rows={2}
                      value={clientNotes}
                      onChange={(e) => setClientNotes(e.target.value)}
                      placeholder="Preferred braid size, hair dye shade, or special instructions..."
                      className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 focus:outline-none focus:border-[#E83B84]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || selectedServiceIds.length === 0 || !selectedTime}
                  className="w-full py-3 px-4 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Confirming Booking...' : 'Confirm Booking'}
                </button>
              </form>
            )}

            {/* Booking Lookup Card */}
            <div
              id="booking-lookup"
              className="bg-white border border-[#1D1717]/10 rounded-2xl p-5 space-y-3 text-xs no-print"
            >
              <div>
                <h4 className="font-bold text-[#1D1717]">Check Existing Booking</h4>
                <p className="text-[11px] text-[#1D1717]/60 mt-0.5">
                  Enter your booking reference and phone number to verify your slot.
                </p>
              </div>
              <form onSubmit={handleLookupBooking} className="space-y-2">
                <input
                  required
                  value={lookupRef}
                  onChange={(e) => setLookupRef(e.target.value)}
                  placeholder="Booking Reference (e.g. APT-...)"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono uppercase"
                />
                <input
                  required
                  value={lookupPhone}
                  onChange={(e) => setLookupPhone(e.target.value)}
                  placeholder="Phone Number"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
                <button
                  type="submit"
                  disabled={lookupLoading}
                  className="w-full py-2 rounded-xl border border-[#1D1717]/15 bg-[#F8EEEB] hover:bg-[#F3BFD3]/40 font-semibold text-[#1D1717] cursor-pointer"
                >
                  {lookupLoading ? 'Checking...' : 'Find My Booking'}
                </button>
              </form>
              {lookupError && <div className="text-red-700 text-[11px]">{lookupError}</div>}
              {lookupResult && (
                <div className="p-3 rounded-xl bg-[#F8EEEB] space-y-1 text-[11px]">
                  <div className="font-bold text-[#1D1717]">
                    {lookupResult.customerName} &middot; {lookupResult.status}
                  </div>
                  <div className="font-mono tabular-nums">
                    {lookupResult.date} at {lookupResult.startTime} ({lookupResult.durationMinutes} min)
                  </div>
                  <div>Stylist: {lookupResult.employeeName}</div>
                  <div className="text-[#1D1717]/75">{lookupResult.serviceNames.join(' · ')}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (!standalone) {
    return bookingContent;
  }

  return (
    <div className="min-h-screen bg-[#F8EEEB] text-[#1D1717] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-[#1D1717]/10 px-4 sm:px-8 h-16 flex items-center justify-between gap-8 no-print">
        <a
          href="#top"
          className="flex items-center gap-2.5 text-base font-bold text-[#1D1717] whitespace-nowrap shrink-0"
        >
          {branding.salonLogoUrl ? (
            <img
              src={branding.salonLogoUrl}
              alt={`${salonName} logo`}
              className="w-8 h-8 rounded-lg object-contain bg-[#F8EEEB] p-0.5 shrink-0"
            />
          ) : (
            <span className="w-8 h-8 rounded-lg bg-[#E83B84] text-white flex items-center justify-center shrink-0">
              <Scissors className="w-4 h-4" />
            </span>
          )}
          <span>{salonName}</span>
        </a>

        <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-[#1D1717]/70">
          <a href="#booking-services" className="hover:text-[#E83B84] whitespace-nowrap shrink-0">
            Services
          </a>
          <a href="#booking-stylists" className="hover:text-[#E83B84] whitespace-nowrap shrink-0">
            Stylists
          </a>
          <a href="#booking-lookup" className="hover:text-[#E83B84] whitespace-nowrap shrink-0">
            Check Booking
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {onBackToLogin && (
            <button
              type="button"
              onClick={onBackToLogin}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F3BFD3]/35 text-xs font-semibold text-[#1D1717] whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Staff Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Salon Hero Banner with Storefront Background */}
      <section id="top" className="relative bg-[#1D1717] text-white overflow-hidden no-print">
        {!heroImgError && backgroundUrl ? (
          <img
            src={backgroundUrl}
            alt={`${salonName} storefront`}
            referrerPolicy="no-referrer"
            onError={() => setHeroImgError(true)}
            className="absolute inset-0 w-full h-full object-cover opacity-55"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#1D1717] via-[#3A1B29] to-[#E83B84]/40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1D1717]/95 via-[#1D1717]/65 to-[#1D1717]/70" />

        <div className="relative z-10 max-w-[1280px] mx-auto px-4 sm:px-8 py-10 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-3">
            <p className="text-[#F3BFD3] text-xs font-semibold uppercase tracking-wider">
              {branding.audienceTagline || 'For Him · For Her · For Everyone'}
              {branding.walkInsWelcome !== false ? ' · Walk-Ins Welcome' : ''}
            </p>
            <h1 className="text-3xl lg:text-4xl font-bold leading-tight text-balance">
              Book Your Appointment Online at {salonName}
            </h1>
            <p className="text-white/80 text-sm max-w-xl">
              {branding.tagline || 'Where Beauty Meets Style'} &middot; Choose your services,
              preferred stylist, and real-time slot with instant confirmation.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-white/85 pt-2">
              <span className="inline-flex items-center gap-1.5 font-mono font-semibold text-[#F3BFD3]">
                <Phone className="w-3.5 h-3.5" /> {branding.phone || '0740301726'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#F3BFD3]" /> {branding.location}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#F3BFD3]" />{' '}
                {branding.operatingHours || SALON_MIDNIGHT_OPERATING_HOURS}
              </span>
            </div>
          </div>

          {branding.promotionalBannerUrl && (
            <div className="lg:col-span-5">
              <div className="rounded-2xl overflow-hidden border border-white/15 bg-white/5 shadow-lg">
                <img
                  src={branding.promotionalBannerUrl}
                  alt={`${salonName} promotional services banner`}
                  referrerPolicy="no-referrer"
                  className="w-full aspect-[2/1] object-cover block"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Main Booking Container */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-8 py-8">
        {bookingContent}
      </main>

      <footer className="border-t border-[#1D1717]/10 bg-white/80 px-4 sm:px-8 py-5 text-xs text-[#1D1717]/65 no-print">
        <div className="max-w-[1280px] mx-auto flex flex-wrap items-center justify-between gap-3">
          <span>
            {salonName} &middot; {branding.tagline || 'Where Beauty Meets Style'}
          </span>
          <span>
            {branding.socialHandle || '@Trendyunisex.salon'} (
            {(branding.socialPlatforms || ['TikTok', 'Instagram', 'Facebook']).join(' · ')})
            {' · '}Booking: {branding.phone || '0740301726'}
          </span>
        </div>
      </footer>
    </div>
  );
};
