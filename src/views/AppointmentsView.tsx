import React, { useEffect, useState } from 'react';
import { Calendar, Clock, Plus, UserPlus, Send, CheckCircle2, Search } from 'lucide-react';
import { apiFetch, formatUGX } from '../lib/api';
import type {
  AppointmentRecord,
  AppointmentStatus,
  CustomerRecord,
  EmployeeRecord,
  ServiceItem,
  SessionUser,
  WalkInRecord,
} from '../types';

interface AppointmentsViewProps {
  user: SessionUser;
  onCheckoutAppointment: (payload: {
    customerId: string;
    customerName: string;
    appointmentId?: string;
    walkInId?: string;
    serviceIds: string[];
    employeeId?: string;
  }) => void;
}

const ALL_STATUSES: AppointmentStatus[] = [
  'Pending',
  'Confirmed',
  'Checked In',
  'In Progress',
  'Completed',
  'Cancelled',
  'No Show',
  'Rescheduled',
];

export const AppointmentsView: React.FC<AppointmentsViewProps> = ({
  user,
  onCheckoutAppointment,
}) => {
  const [tab, setTab] = useState<'bookings' | 'walkins'>('bookings');
  const [calendarMode, setCalendarMode] = useState<'day' | 'week' | 'month'>('day');
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [stylistFilter, setStylistFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [walkIns, setWalkIns] = useState<WalkInRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showWalkInModal, setShowWalkInModal] = useState(false);

  // Booking form state
  const [useNewCustomer, setUseNewCustomer] = useState(false);
  const [bookingCustomerId, setBookingCustomerId] = useState('');
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [bookingEmployeeId, setBookingEmployeeId] = useState('');
  const [bookingServiceIds, setBookingServiceIds] = useState<string[]>([]);
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().slice(0, 10));
  const [bookingTime, setBookingTime] = useState('10:00');
  const [bookingDuration, setBookingDuration] = useState(60);
  const [bookingNotes, setBookingNotes] = useState('');

  // Walk-in form state
  const [walkInNewCustomer, setWalkInNewCustomer] = useState(true);
  const [walkInCustomerId, setWalkInCustomerId] = useState('');
  const [walkInCustName, setWalkInCustName] = useState('');
  const [walkInCustPhone, setWalkInCustPhone] = useState('');
  const [walkInServiceIds, setWalkInServiceIds] = useState<string[]>([]);
  const [walkInEmployeeId, setWalkInEmployeeId] = useState('');

  const canManage = ['owner', 'manager'].includes(user.role);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [aptRes, empRes, srvRes, custRes] = await Promise.all([
        apiFetch<{ appointments: AppointmentRecord[]; walkIns: WalkInRecord[] }>('/api/appointments'),
        apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
        apiFetch<{ services: ServiceItem[] }>('/api/services'),
        apiFetch<{ customers: CustomerRecord[] }>('/api/customers'),
      ]);
      setAppointments(aptRes.appointments);
      setWalkIns(aptRes.walkIns);
      setEmployees(empRes.employees.filter((e) => e.active));
      setServices(srvRes.services.filter((s) => s.active));
      setCustomers(custRes.customers);
      if (empRes.employees.length > 0 && !bookingEmployeeId) {
        setBookingEmployeeId(empRes.employees[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appointments.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setFeedbackMsg('');
    try {
      await apiFetch('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: useNewCustomer ? undefined : bookingCustomerId,
          newCustomer: useNewCustomer ? { fullName: newCustName, phone: newCustPhone } : undefined,
          employeeId: bookingEmployeeId,
          serviceIds: bookingServiceIds,
          date: bookingDate,
          startTime: bookingTime,
          durationMinutes: bookingDuration,
          notes: bookingNotes,
        }),
      });
      setShowBookingModal(false);
      setBookingServiceIds([]);
      setNewCustName('');
      setNewCustPhone('');
      setBookingNotes('');
      setFeedbackMsg('Appointment booked successfully (verified no stylist overlap).');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed.');
    }
  };

  const handleStatusChange = async (aptId: string, status: AppointmentStatus) => {
    setError('');
    try {
      await apiFetch(`/api/appointments/${aptId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setFeedbackMsg(`Appointment updated to ${status}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    }
  };

  const handleSendReminder = async (aptId: string) => {
    setError('');
    setFeedbackMsg('');
    try {
      await apiFetch(`/api/appointments/${aptId}`, {
        method: 'PATCH',
        body: JSON.stringify({ sendReminder: true }),
      });
      setFeedbackMsg('Customer reminder dispatched via configured provider.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reminder dispatch failed.');
    }
  };

  const handleCreateWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/walkins', {
        method: 'POST',
        body: JSON.stringify({
          customerId: walkInNewCustomer ? undefined : walkInCustomerId,
          newCustomer: walkInNewCustomer ? { fullName: walkInCustName, phone: walkInCustPhone } : undefined,
          requestedServiceIds: walkInServiceIds,
          assignedEmployeeId: walkInEmployeeId || undefined,
        }),
      });
      setShowWalkInModal(false);
      setWalkInCustName('');
      setWalkInCustPhone('');
      setWalkInServiceIds([]);
      setFeedbackMsg('Walk-in customer registered in waiting queue.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Walk-in registration failed.');
    }
  };

  const handleWalkInUpdate = async (id: string, status: WalkInRecord['status'], assignedEmployeeId?: string) => {
    try {
      await apiFetch(`/api/walkins/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, assignedEmployeeId }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Walk-in update failed.');
    }
  };

  // Filter appointments by calendarMode
  const filteredAppointments = appointments.filter((a) => {
    if (stylistFilter !== 'all' && a.employeeId !== stylistFilter) return false;
    if (
      searchQuery &&
      !a.customerName.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !a.customerPhone.includes(searchQuery)
    ) {
      return false;
    }
    if (calendarMode === 'day') return a.date === selectedDate;
    if (calendarMode === 'month') return a.date.slice(0, 7) === selectedDate.slice(0, 7);
    // week
    const ref = new Date(selectedDate);
    const diff = (new Date(a.date).getTime() - ref.getTime()) / (1000 * 60 * 60 * 24);
    return diff >= -3 && diff <= 7;
  });

  const toggleService = (id: string, list: string[], setter: (v: string[]) => void) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    setter(next);
    const dur = services
      .filter((s) => next.includes(s.id))
      .reduce((sum, s) => sum + s.durationMinutes, 0);
    if (dur > 0) setBookingDuration(dur);
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 p-1 bg-white border border-[#1D1717]/10 rounded-xl w-fit">
          <button
            onClick={() => setTab('bookings')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'bookings' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70 hover:text-[#1D1717]'
            }`}
          >
            Scheduled Appointments ({appointments.length})
          </button>
          <button
            onClick={() => setTab('walkins')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'walkins' ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70 hover:text-[#1D1717]'
            }`}
          >
            Walk-In Queue ({walkIns.filter((w) => w.status !== 'Completed' && w.status !== 'Left').length})
          </button>
        </div>

        {canManage && (
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowWalkInModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F3BFD3]/40 text-xs font-semibold text-[#1D1717] cursor-pointer whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5 text-[#E83B84]" />
              <span>Register Walk-In</span>
            </button>
            <button
              onClick={() => setShowBookingModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12d73] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Book Appointment</span>
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-medium">
          {error}
        </div>
      )}
      {feedbackMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
          {feedbackMsg}
        </div>
      )}

      {tab === 'bookings' ? (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
          {/* Calendar Filter Toolbar */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-[#1D1717]/10">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-[#F8EEEB] rounded-lg">
                {(['day', 'week', 'month'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setCalendarMode(m)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold capitalize cursor-pointer ${
                      calendarMode === m ? 'bg-white text-[#1D1717] shadow-xs' : 'text-[#1D1717]/65'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1D1717]/15 text-xs">
                <Calendar className="w-3.5 h-3.5 text-[#E83B84]" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="font-mono focus:outline-none"
                />
              </div>
              <select
                value={stylistFilter}
                onChange={(e) => setStylistFilter(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-[#1D1717]/15 text-xs bg-white focus:outline-none"
              >
                <option value="all">All Stylists</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative w-full lg:w-64">
              <Search className="w-3.5 h-3.5 text-[#1D1717]/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer or phone..."
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-[#1D1717]/15 text-xs focus:outline-none focus:border-[#E83B84]"
              />
            </div>
          </div>

          {loading ? (
            <div className="h-40 animate-pulse bg-[#F8EEEB] rounded-xl" />
          ) : filteredAppointments.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-[#1D1717]/65">
                No appointments found for {selectedDate} ({calendarMode} view).
              </p>
              {canManage && (
                <button
                  onClick={() => setShowBookingModal(true)}
                  className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
                >
                  Schedule First Appointment
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-3 px-3 font-semibold">Date &amp; Time</th>
                    <th className="py-3 px-3 font-semibold">Customer</th>
                    <th className="py-3 px-3 font-semibold">Services</th>
                    <th className="py-3 px-3 font-semibold">Stylist</th>
                    <th className="py-3 px-3 font-semibold">Status</th>
                    {canManage && <th className="py-3 px-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {filteredAppointments.map((apt) => (
                    <tr key={apt.id} className="hover:bg-[#F8EEEB]/50">
                      <td className="py-3 px-3 font-mono tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-[#1D1717]">{apt.date}</div>
                        <div className="text-[#1D1717]/60">
                          {apt.startTime} ({apt.durationMinutes}m)
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-semibold text-[#1D1717]">{apt.customerName}</div>
                        <div className="text-[#1D1717]/60 font-mono">{apt.customerPhone}</div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-[#1D1717]">{apt.serviceNames.join(', ')}</div>
                        {apt.notes && <div className="text-[#1D1717]/55 italic">{apt.notes}</div>}
                      </td>
                      <td className="py-3 px-3 font-medium">{apt.employeeName}</td>
                      <td className="py-3 px-3">
                        {canManage ? (
                          <select
                            value={apt.status}
                            onChange={(e) =>
                              void handleStatusChange(apt.id, e.target.value as AppointmentStatus)
                            }
                            className="px-2 py-1 rounded-lg border border-[#1D1717]/15 bg-white text-xs font-medium"
                          >
                            {ALL_STATUSES.map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="font-medium text-[#E83B84]">{apt.status}</span>
                        )}
                      </td>
                      {canManage && (
                        <td className="py-3 px-3 text-right whitespace-nowrap space-x-2">
                          <button
                            onClick={() => void handleSendReminder(apt.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] text-[#1D1717] cursor-pointer"
                            title="Send appointment reminder"
                          >
                            <Send className="w-3 h-3" />
                            <span>{apt.reminderSent ? 'Reminded' : 'Remind'}</span>
                          </button>
                          {apt.status !== 'Completed' && apt.status !== 'Cancelled' && (
                            <button
                              onClick={() =>
                                onCheckoutAppointment({
                                  customerId: apt.customerId,
                                  customerName: apt.customerName,
                                  appointmentId: apt.id,
                                  serviceIds: apt.serviceIds,
                                  employeeId: apt.employeeId,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E83B84] text-white font-semibold hover:bg-[#d12d73] cursor-pointer"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              <span>Checkout POS</span>
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
      ) : (
        /* WALK-IN QUEUE */
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-[#1D1717]">Walk-In Waiting Queue</h3>
            <span className="text-xs text-[#1D1717]/60">Track arrival time &amp; stylist assignment</span>
          </div>

          {walkIns.length === 0 ? (
            <p className="text-sm text-[#1D1717]/60 py-8 text-center">
              No walk-in customers in queue. Click &ldquo;Register Walk-In&rdquo; when a guest arrives.
            </p>
          ) : (
            <div className="divide-y divide-[#1D1717]/10">
              {walkIns.map((w) => {
                const waitMins = Math.max(
                  0,
                  Math.round((Date.now() - new Date(w.arrivalTime).getTime()) / 60000)
                );
                return (
                  <div
                    key={w.id}
                    className="py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-sm text-[#1D1717]">
                        {w.customerName}{' '}
                        <span className="text-xs font-mono text-[#1D1717]/60">&middot; {w.customerPhone}</span>
                      </div>
                      <div className="text-xs text-[#1D1717]/65 mt-0.5">
                        Requested: {w.requestedServiceNames.join(', ') || 'General consultation'} &middot;{' '}
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" /> Arrived {new Date(w.arrivalTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({waitMins}m ago)
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {canManage && (
                        <select
                          value={w.assignedEmployeeId || ''}
                          onChange={(e) => void handleWalkInUpdate(w.id, 'Being Served', e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-[#1D1717]/15 text-xs bg-white"
                        >
                          <option value="">Assign Stylist...</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>
                              {emp.fullName}
                            </option>
                          ))}
                        </select>
                      )}
                      <span className="text-xs font-semibold text-[#E83B84] px-2">{w.status}</span>
                      {canManage && w.status !== 'Completed' && (
                        <button
                          onClick={() =>
                            onCheckoutAppointment({
                              customerId: w.customerId,
                              customerName: w.customerName,
                              walkInId: w.id,
                              serviceIds: w.requestedServiceIds,
                              employeeId: w.assignedEmployeeId,
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
                        >
                          Complete via POS
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Book Appointment Modal */}
      {showBookingModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleCreateAppointment}
            className="w-full max-w-xl bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4 my-8"
          >
            <h3 className="text-lg font-bold text-[#1D1717]">Book New Appointment</h3>

            <div className="flex items-center gap-3 text-xs">
              <button
                type="button"
                onClick={() => setUseNewCustomer(false)}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  !useNewCustomer ? 'bg-[#1D1717] text-white' : 'bg-[#F8EEEB] text-[#1D1717]'
                }`}
              >
                Existing Customer
              </button>
              <button
                type="button"
                onClick={() => setUseNewCustomer(true)}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  useNewCustomer ? 'bg-[#1D1717] text-white' : 'bg-[#F8EEEB] text-[#1D1717]'
                }`}
              >
                New Customer
              </button>
            </div>

            {!useNewCustomer ? (
              <div>
                <label className="block text-xs font-semibold mb-1">Select Customer</label>
                <select
                  required
                  value={bookingCustomerId}
                  onChange={(e) => setBookingCustomerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm bg-white"
                >
                  <option value="">-- Choose customer --</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fullName} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1">Customer Full Name</label>
                  <input
                    required
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    placeholder="e.g. Brenda Namono"
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Phone Number</label>
                  <input
                    required
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    placeholder="+256 7XX XXX XXX"
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1.5">Select Services</label>
              <div className="max-h-40 overflow-y-auto border border-[#1D1717]/15 rounded-xl p-2 space-y-1">
                {services.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-[#F8EEEB] text-xs cursor-pointer"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={bookingServiceIds.includes(s.id)}
                        onChange={() => toggleService(s.id, bookingServiceIds, setBookingServiceIds)}
                      />
                      <span className="font-medium">{s.name}</span>
                    </span>
                    <span className="font-mono text-[#1D1717]/70">
                      {formatUGX(s.price)} &middot; {s.durationMinutes}m
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Preferred Stylist</label>
                <select
                  required
                  value={bookingEmployeeId}
                  onChange={(e) => setBookingEmployeeId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs bg-white"
                >
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Date</label>
                <input
                  type="date"
                  required
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Time &amp; Duration</label>
                <div className="flex gap-1.5">
                  <input
                    type="time"
                    required
                    value={bookingTime}
                    onChange={(e) => setBookingTime(e.target.value)}
                    className="flex-1 px-2 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-mono"
                  />
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={bookingDuration}
                    onChange={(e) => setBookingDuration(Number(e.target.value))}
                    className="w-16 px-2 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-mono"
                    title="Duration in minutes"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Customer Instructions / Notes</label>
              <input
                value={bookingNotes}
                onChange={(e) => setBookingNotes(e.target.value)}
                placeholder="Optional style preferences or hair notes"
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm"
              />
            </div>

            <div className="flex justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowBookingModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bookingServiceIds.length === 0}
                className="px-5 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                Confirm Booking
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Register Walk-In Modal */}
      {showWalkInModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateWalkIn}
            className="w-full max-w-lg bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-4"
          >
            <h3 className="text-lg font-bold text-[#1D1717]">Register Walk-In Customer</h3>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setWalkInNewCustomer(true)}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  walkInNewCustomer ? 'bg-[#1D1717] text-white' : 'bg-[#F8EEEB]'
                }`}
              >
                New Guest
              </button>
              <button
                type="button"
                onClick={() => setWalkInNewCustomer(false)}
                className={`px-3 py-1.5 rounded-lg font-semibold cursor-pointer ${
                  !walkInNewCustomer ? 'bg-[#1D1717] text-white' : 'bg-[#F8EEEB]'
                }`}
              >
                Returning Customer
              </button>
            </div>

            {walkInNewCustomer ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  value={walkInCustName}
                  onChange={(e) => setWalkInCustName(e.target.value)}
                  placeholder="Guest Full Name"
                  className="px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm"
                />
                <input
                  required
                  value={walkInCustPhone}
                  onChange={(e) => setWalkInCustPhone(e.target.value)}
                  placeholder="Phone (+256...)"
                  className="px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm"
                />
              </div>
            ) : (
              <select
                required
                value={walkInCustomerId}
                onChange={(e) => setWalkInCustomerId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm bg-white"
              >
                <option value="">-- Select customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.fullName} ({c.phone})
                  </option>
                ))}
              </select>
            )}

            <div>
              <label className="block text-xs font-semibold mb-1">Requested Services</label>
              <div className="max-h-36 overflow-y-auto border border-[#1D1717]/15 rounded-xl p-2 space-y-1">
                {services.map((s) => (
                  <label key={s.id} className="flex items-center justify-between text-xs px-2 py-1 hover:bg-[#F8EEEB] rounded cursor-pointer">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={walkInServiceIds.includes(s.id)}
                        onChange={() => toggleService(s.id, walkInServiceIds, setWalkInServiceIds)}
                      />
                      <span>{s.name}</span>
                    </span>
                    <span className="font-mono">{formatUGX(s.price)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Assign Stylist (Optional)</label>
              <select
                value={walkInEmployeeId}
                onChange={(e) => setWalkInEmployeeId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 text-sm bg-white"
              >
                <option value="">Add to Waiting List (Unassigned)</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowWalkInModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
              >
                Add to Queue
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
