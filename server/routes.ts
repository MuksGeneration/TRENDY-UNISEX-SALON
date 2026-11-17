import express from 'express';
import {
  appendAuditLog,
  createBackupSnapshot,
  createInitialDatabase,
  getBackupSnapshot,
  readDb,
  todayIsoDate,
  writeDb,
} from './db.ts';
import {
  hashPassword,
  requireAuth,
  requireRole,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  getEmployeeCommissionSummary,
  getPolicyForDate,
  recomputeEmployeeDailyCommission,
  resolveServiceCommissionRate,
} from './commissionEngine.ts';
import { askSalonAiAssistant } from './aiService.ts';
import {
  backupDatabaseToGoogleDrive,
  createSalonGoogleSpreadsheet,
  deleteGoogleDriveFile,
  ensureCategoryDriveFolder,
  fetchGoogleDriveFileMedia,
  listAppDriveFiles,
  parseDataUrl,
  readGoogleSheetTab,
  syncDatabaseToGoogleSheet,
  uploadBinaryToGoogleDrive,
} from './workspaceService.ts';
import { generateAppsScriptCode } from './appsScriptTemplate.ts';
import type {
  Appointment,
  CommissionAdjustment,
  CommissionPolicy,
  Customer,
  DriveDocumentCategory,
  DriveDocumentRecord,
  Employee,
  EmployeeStatus,
  ExpenseRecord,
  GiftCard,
  PaymentMethod,
  POSTransaction,
  SalonDatabase,
  StockItem,
  StockMovement,
  TransactionPayment,
  UserRole,
} from './types.ts';

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
}

function getLoyaltyTier(points: number): Customer['loyaltyTier'] {
  if (points >= 500) return 'VIP';
  if (points >= 250) return 'Gold';
  if (points >= 100) return 'Silver';
  return 'Bronze';
}

export function createApiRouter() {
  const router = express.Router();

  // ==================== AUTHENTICATION ====================
  router.post('/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const db = readDb();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'Invalid email or password, or account is deactivated.' });
      return;
    }

    user.lastLoginAt = new Date().toISOString();
    appendAuditLog(
      db,
      { userId: user.id, userName: user.name, userRole: user.role },
      'USER_LOGIN',
      'User',
      user.id,
      `Signed in via salon credentials (${user.role}).`
    );
    writeDb(db);

    const token = signSessionToken(user);
    res.cookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      maxAge: 1000 * 60 * 60 * 12,
    });

    res.json({
      token,
      user: {
        userId: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        employeeId: user.employeeId,
      },
    });
  });

  router.post('/auth/google-session', async (req, res) => {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!accessToken) {
      res.status(401).json({ error: 'Google OAuth access token is required.' });
      return;
    }

    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) {
        res.status(401).json({ error: 'Invalid or expired Google OAuth access token.' });
        return;
      }
      const googleProfile = (await infoRes.json()) as { email?: string; name?: string; email_verified?: boolean };
      if (!googleProfile.email) {
        res.status(400).json({ error: 'Google account email could not be verified.' });
        return;
      }

      const db = readDb();
      let user = db.users.find(
        (u) => u.email.toLowerCase() === googleProfile.email!.toLowerCase()
      );
      // If the Google account owner is signing in for the first time and matches primary owner setup
      if (!user) {
        // Check if user wants to link to owner or reject unknown accounts
        res.status(403).json({
          error: `Google account (${googleProfile.email}) is not registered as a Trendy Unisex Salon user. Please sign in with salon credentials first or ask the Owner to add ${googleProfile.email} in User Management.`,
        });
        return;
      }
      if (!user.active) {
        res.status(403).json({ error: 'This salon user account is deactivated.' });
        return;
      }

      user.lastLoginAt = new Date().toISOString();
      appendAuditLog(
        db,
        { userId: user.id, userName: user.name, userRole: user.role },
        'GOOGLE_LOGIN',
        'User',
        user.id,
        `Authenticated via Google Workspace (${googleProfile.email}).`
      );
      writeDb(db);

      const token = signSessionToken(user);
      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'none',
        secure: true,
        maxAge: 1000 * 60 * 60 * 12,
      });

      res.json({
        token,
        user: {
          userId: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          employeeId: user.employeeId,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Google session verification failed.' });
    }
  });

  router.post('/auth/logout', (req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME, { sameSite: 'none', secure: true });
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.sessionUser });
  });

  // ==================== DASHBOARD ====================
  router.get('/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    const today = todayIsoDate();
    const startDate = (req.query.startDate as string) || `${today.slice(0, 7)}-01`;
    const endDate = (req.query.endDate as string) || today;

    if (user.role === 'employee') {
      const empId = user.employeeId || '';
      const emp = db.employees.find((e) => e.id === empId);
      const summary = empId ? getEmployeeCommissionSummary(db, empId) : null;
      const todayLedger = db.commissionLedger.filter(
        (c) => c.employeeId === empId && c.date === today && c.paymentStatus !== 'Reversed'
      );
      const todayLunch = db.lunchDeductions
        .filter((l) => l.employeeId === empId && l.date === today)
        .reduce((s, l) => s + l.amount, 0);
      const upcomingAppointments = db.appointments
        .filter((a) => a.employeeId === empId && a.date >= today && a.status !== 'Cancelled')
        .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
        .slice(0, 10);

      res.json({
        roleScope: 'employee',
        today,
        employee: emp ? { ...emp, status: resolveEmployeeStatus(emp) } : undefined,
        todayStats: {
          grossEarnings: todayLedger.reduce((s, c) => s + c.grossEarnings, 0),
          lunchDeduction: todayLunch,
          netCommissionable: todayLedger.reduce((s, c) => s + c.netCommissionableEarnings, 0),
          commissionEarned: todayLedger.reduce((s, c) => s + c.employeeCommission, 0),
          servicesCount: todayLedger.length,
        },
        summary,
        upcomingAppointments,
        recentLedger: db.commissionLedger
          .filter((c) => c.employeeId === empId)
          .slice(-20)
          .reverse(),
      });
      return;
    }

    const activeTx = db.posTransactions.filter((t) => t.status !== 'Reversed' && t.status !== 'Refunded');
    const todayTx = activeTx.filter((t) => t.date === today);
    const periodTx = activeTx.filter((t) => t.date >= startDate && t.date <= endDate);

    const calcBreakdown = (txs: POSTransaction[]) => {
      let serviceRevenue = 0;
      let productRevenue = 0;
      for (const tx of txs) {
        for (const item of tx.items) {
          if (item.itemType === 'service') serviceRevenue += item.lineTotal;
          else productRevenue += item.lineTotal;
        }
      }
      return {
        totalSales: txs.reduce((s, t) => s + t.totalAmount, 0),
        totalCollected: txs.reduce((s, t) => s + t.amountPaid, 0),
        serviceRevenue,
        productRevenue,
        customerCount: new Set(txs.map((t) => t.customerId || t.customerName)).size,
      };
    };

    const todaySales = calcBreakdown(todayTx);
    const periodSales = calcBreakdown(periodTx);

    const todayLedger = db.commissionLedger.filter((c) => c.date === today && c.paymentStatus !== 'Reversed');
    const periodLedger = db.commissionLedger.filter(
      (c) => c.date >= startDate && c.date <= endDate && c.paymentStatus !== 'Reversed'
    );

    const todayLunchTotal = db.lunchDeductions
      .filter((l) => l.date === today)
      .reduce((s, l) => s + l.amount, 0);

    const todayExpensesTotal = db.expenses
      .filter((e) => e.date === today && e.status !== 'Rejected')
      .reduce((s, e) => s + e.amount, 0);
    const periodExpensesTotal = db.expenses
      .filter((e) => e.date >= startDate && e.date <= endDate && e.status !== 'Rejected')
      .reduce((s, e) => s + e.amount, 0);

    const todaySalonShare = todayLedger.reduce((s, c) => s + c.salonShare, 0);
    const periodSalonShare = periodLedger.reduce((s, c) => s + c.salonShare, 0);

    // Build 14-day daily sales trend
    const dailyTrend: Array<{ date: string; serviceSales: number; productSales: number; expenses: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const dayTxs = activeTx.filter((t) => t.date === iso);
      const dayBreakdown = calcBreakdown(dayTxs);
      const dayExp = db.expenses
        .filter((e) => e.date === iso && e.status !== 'Rejected')
        .reduce((s, e) => s + e.amount, 0);
      dailyTrend.push({
        date: iso,
        serviceSales: dayBreakdown.serviceRevenue,
        productSales: dayBreakdown.productRevenue,
        expenses: dayExp,
      });
    }

    // Payment method breakdown in period
    const paymentBreakdown: Record<string, number> = {};
    for (const tx of periodTx) {
      for (const p of tx.payments) {
        paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;
      }
    }

    // Service popularity in period
    const servicePopularityMap: Record<string, { count: number; revenue: number }> = {};
    for (const tx of periodTx) {
      for (const item of tx.items) {
        if (item.itemType === 'service') {
          if (!servicePopularityMap[item.name]) {
            servicePopularityMap[item.name] = { count: 0, revenue: 0 };
          }
          servicePopularityMap[item.name].count += item.quantity;
          servicePopularityMap[item.name].revenue += item.lineTotal;
        }
      }
    }

    // Expense breakdown in period
    const expenseByCategory: Record<string, number> = {};
    for (const e of db.expenses) {
      if (e.date >= startDate && e.date <= endDate && e.status !== 'Rejected') {
        expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount;
      }
    }

    // Employee performance
    const employeePerformance = db.employees.map((emp) => {
      const empPeriodLedger = periodLedger.filter((c) => c.employeeId === emp.id);
      const summary = getEmployeeCommissionSummary(db, emp.id);
      return {
        employeeId: emp.id,
        fullName: emp.fullName,
        roleTitle: emp.roleTitle,
        avatarUrl: emp.avatarUrl,
        active: emp.active,
        periodGross: empPeriodLedger.reduce((s, c) => s + c.grossEarnings, 0),
        periodCommission: empPeriodLedger.reduce((s, c) => s + c.employeeCommission, 0),
        periodServicesCount: empPeriodLedger.length,
        outstandingCommission: summary.outstandingBalance,
        totalCommissionPaid: summary.totalPaid,
      };
    });

    const outstandingCommissions = employeePerformance.reduce((s, e) => s + e.outstandingCommission, 0);
    const totalCommissionPaid = db.commissionPayments.reduce((s, p) => s + p.amount, 0);
    const outstandingCustomerBalances = activeTx.reduce((s, t) => s + t.balanceDue, 0);
    const giftCardLiability = db.giftCards
      .filter((g) => g.status === 'Active')
      .reduce((s, g) => s + g.balance, 0);

    const lowStockItems = db.stockItems.filter((s) => s.active && s.currentQuantity <= s.minStockLevel);
    const todayAttendance = db.attendance.filter((a) => a.date === today);
    const upcomingAppointments = db.appointments
      .filter((a) => a.date >= today && a.status !== 'Cancelled' && a.status !== 'Completed')
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
      .slice(0, 8);

    const totalCustomers = db.customers.length;
    const returningCustomers = db.customers.filter((c) => c.totalVisits >= 2).length;

    res.json({
      roleScope: user.role,
      today,
      period: { startDate, endDate },
      todayMetrics: {
        totalSales: todaySales.totalSales,
        serviceRevenue: todaySales.serviceRevenue,
        productRevenue: todaySales.productRevenue,
        customerCount: todaySales.customerCount,
        completedAppointments: db.appointments.filter((a) => a.date === today && a.status === 'Completed').length,
        walkIns: db.walkIns.filter((w) => w.arrivalTime.startsWith(today)).length,
        employeeEarnings: todayLedger.reduce((s, c) => s + c.grossEarnings, 0),
        lunchDeductions: todayLunchTotal,
        employeeCommissions: todayLedger.reduce((s, c) => s + c.employeeCommission, 0),
        salonShare: todaySalonShare,
        expenses: todayExpensesTotal,
        profitEstimate: todaySalonShare + todaySales.productRevenue - todayExpensesTotal,
      },
      financialOverview: {
        periodRevenue: periodSales.totalSales,
        periodServiceRevenue: periodSales.serviceRevenue,
        periodProductRevenue: periodSales.productRevenue,
        periodSalonShare,
        periodExpenses: periodExpensesTotal,
        periodNetProfitEstimate: periodSalonShare + periodSales.productRevenue - periodExpensesTotal,
        outstandingCommissions,
        totalCommissionPaid,
        outstandingCustomerBalances,
        giftCardLiability,
        paymentBreakdown,
      },
      operationalOverview: {
        upcomingAppointments,
        availableStylists: db.employees.filter((e) => e.active),
        todayAttendanceCount: todayAttendance.length,
        lowStockCount: lowStockItems.length,
        lowStockItems,
        totalCustomers,
        returningCustomers,
        retentionRate: totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 100) : 0,
        cancelledAppointments: db.appointments.filter(
          (a) => a.date >= startDate && a.date <= endDate && a.status === 'Cancelled'
        ).length,
        noShowAppointments: db.appointments.filter(
          (a) => a.date >= startDate && a.date <= endDate && a.status === 'No Show'
        ).length,
      },
      charts: {
        dailyTrend,
        employeePerformance,
        popularServices: Object.entries(servicePopularityMap)
          .sort((a, b) => b[1].revenue - a[1].revenue)
          .slice(0, 8)
          .map(([name, val]) => ({ name, ...val })),
        expenseBreakdown: Object.entries(expenseByCategory).map(([category, amount]) => ({
          category,
          amount,
        })),
      },
      hasTransactions: db.posTransactions.length > 0,
    });
  });

  // ==================== APPOINTMENTS & WALK-INS ====================
  router.get('/appointments', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    let list = [...db.appointments];
    if (user.role === 'employee') {
      list = list.filter((a) => a.employeeId === user.employeeId);
    }
    list.sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
    res.json({ appointments: list, walkIns: db.walkIns });
  });

  router.post(
    '/appointments',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const {
        customerId,
        newCustomer,
        employeeId,
        serviceIds,
        date,
        startTime,
        durationMinutes,
        instructions,
        notes,
        source,
      } = req.body as {
        customerId?: string;
        newCustomer?: { fullName: string; phone: string; email?: string; gender?: Customer['gender'] };
        employeeId: string;
        serviceIds: string[];
        date: string;
        startTime: string;
        durationMinutes?: number;
        instructions?: string;
        notes?: string;
        source?: 'Scheduled' | 'Online' | 'Walk-In';
      };

      if (!employeeId || !serviceIds?.length || !date || !startTime) {
        res.status(400).json({ error: 'Stylist, services, date, and start time are required.' });
        return;
      }

      const employee = db.employees.find((e) => e.id === employeeId && e.active);
      if (!employee) {
        res.status(404).json({ error: 'Selected stylist not found or inactive.' });
        return;
      }

      // Check schedule day-off conflict
      const dayOff = db.schedules.find(
        (s) => s.employeeId === employeeId && s.date === date && s.isDayOff
      );
      if (dayOff) {
        res.status(409).json({
          error: `${employee.fullName} is marked as Day Off on ${date}. Please choose another stylist or date.`,
        });
        return;
      }

      const selectedServices = db.services.filter((s) => serviceIds.includes(s.id));
      const calcDuration =
        durationMinutes && durationMinutes > 0
          ? durationMinutes
          : selectedServices.reduce((s, srv) => s + srv.durationMinutes, 0) || 60;

      // Double-booking prevention
      const newStart = timeToMinutes(startTime);
      const newEnd = newStart + calcDuration;
      const conflict = db.appointments.find((a) => {
        if (a.employeeId !== employeeId || a.date !== date) return false;
        if (['Cancelled', 'No Show', 'Completed'].includes(a.status)) return false;
        const existStart = timeToMinutes(a.startTime);
        const existEnd = existStart + a.durationMinutes;
        return newStart < existEnd && newEnd > existStart;
      });

      if (conflict) {
        res.status(409).json({
          error: `Double-booking prevented: ${employee.fullName} already has ${conflict.customerName} booked from ${conflict.startTime} (${conflict.durationMinutes} min) on ${date}.`,
        });
        return;
      }

      let customer = customerId ? db.customers.find((c) => c.id === customerId) : undefined;
      if (!customer && newCustomer?.fullName && newCustomer?.phone) {
        customer = {
          id: makeId('CUST'),
          fullName: newCustomer.fullName.trim(),
          phone: newCustomer.phone.trim(),
          email: newCustomer.email?.trim() || '',
          gender: newCustomer.gender || '',
          registrationDate: todayIsoDate(),
          loyaltyPoints: 0,
          loyaltyTier: 'Bronze',
          totalVisits: 0,
          totalSpent: 0,
        };
        db.customers.push(customer);
      }
      if (!customer) {
        res.status(400).json({ error: 'Please select an existing customer or enter new customer name and phone.' });
        return;
      }

      const now = new Date().toISOString();
      const appt: Appointment = {
        id: makeId('APT'),
        customerId: customer.id,
        customerName: customer.fullName,
        customerPhone: customer.phone,
        employeeId: employee.id,
        employeeName: employee.fullName,
        serviceIds: selectedServices.map((s) => s.id),
        serviceNames: selectedServices.map((s) => s.name),
        date,
        startTime,
        durationMinutes: calcDuration,
        status: 'Confirmed',
        source: source || 'Scheduled',
        instructions,
        notes,
        reminderSent: false,
        createdAt: now,
        updatedAt: now,
      };

      db.appointments.push(appt);
      db.notifications.unshift({
        id: makeId('NTF'),
        type: 'appointment',
        title: 'New Appointment Scheduled',
        message: `${customer.fullName} booked with ${employee.fullName} on ${date} at ${startTime}.`,
        severity: 'info',
        read: false,
        targetRoles: ['owner', 'manager', 'employee'],
        createdAt: now,
      });
      appendAuditLog(
        db,
        req.sessionUser!,
        'APPOINTMENT_CREATED',
        'Appointment',
        appt.id,
        `Booked ${customer.fullName} with ${employee.fullName} on ${date} ${startTime}.`
      );
      writeDb(db);
      res.status(201).json({ appointment: appt, customer });
    }
  );

  router.patch(
    '/appointments/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const appt = db.appointments.find((a) => a.id === req.params.id);
      if (!appt) {
        res.status(404).json({ error: 'Appointment not found.' });
        return;
      }

      const { status, employeeId, date, startTime, notes, sendReminder } = req.body as Partial<Appointment> & {
        sendReminder?: boolean;
      };

      if (sendReminder) {
        if (
          !db.settings.whatsappProviderConfigured &&
          !db.settings.smsProviderConfigured &&
          !db.settings.emailProviderConfigured
        ) {
          res.status(400).json({
            error:
              'No external SMS, WhatsApp, or Email provider is configured in System Settings. Configure a messaging provider before sending external customer reminders.',
          });
          return;
        }
        appt.reminderSent = true;
      }

      if (employeeId && employeeId !== appt.employeeId) {
        const emp = db.employees.find((e) => e.id === employeeId);
        if (!emp) {
          res.status(404).json({ error: 'Target stylist not found.' });
          return;
        }
        appt.employeeId = emp.id;
        appt.employeeName = emp.fullName;
      }

      const targetDate = date || appt.date;
      const targetTime = startTime || appt.startTime;

      if (date || startTime || employeeId) {
        const newStart = timeToMinutes(targetTime);
        const newEnd = newStart + appt.durationMinutes;
        const conflict = db.appointments.find((a) => {
          if (a.id === appt.id) return false;
          if (a.employeeId !== appt.employeeId || a.date !== targetDate) return false;
          if (['Cancelled', 'No Show', 'Completed'].includes(a.status)) return false;
          const existStart = timeToMinutes(a.startTime);
          const existEnd = existStart + a.durationMinutes;
          return newStart < existEnd && newEnd > existStart;
        });
        if (conflict) {
          res.status(409).json({
            error: `Reschedule conflict: ${appt.employeeName} already has ${conflict.customerName} at ${conflict.startTime} on ${targetDate}.`,
          });
          return;
        }
        appt.date = targetDate;
        appt.startTime = targetTime;
      }

      if (status) appt.status = status;
      if (typeof notes === 'string') appt.notes = notes;
      appt.updatedAt = new Date().toISOString();

      appendAuditLog(
        db,
        req.sessionUser!,
        'APPOINTMENT_UPDATED',
        'Appointment',
        appt.id,
        `Updated appointment ${appt.id} -> status: ${appt.status}, stylist: ${appt.employeeName}, ${appt.date} ${appt.startTime}.`
      );
      writeDb(db);
      res.json({ appointment: appt });
    }
  );

  router.post(
    '/walkins',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { customerId, newCustomer, requestedServiceIds, assignedEmployeeId, notes } = req.body as {
        customerId?: string;
        newCustomer?: { fullName: string; phone: string };
        requestedServiceIds: string[];
        assignedEmployeeId?: string;
        notes?: string;
      };

      let customer = customerId ? db.customers.find((c) => c.id === customerId) : undefined;
      if (!customer && newCustomer?.fullName && newCustomer?.phone) {
        customer = {
          id: makeId('CUST'),
          fullName: newCustomer.fullName.trim(),
          phone: newCustomer.phone.trim(),
          registrationDate: todayIsoDate(),
          loyaltyPoints: 0,
          loyaltyTier: 'Bronze',
          totalVisits: 0,
          totalSpent: 0,
        };
        db.customers.push(customer);
      }
      if (!customer) {
        res.status(400).json({ error: 'Customer is required for walk-in registration.' });
        return;
      }

      const srvs = db.services.filter((s) => (requestedServiceIds || []).includes(s.id));
      const emp = assignedEmployeeId ? db.employees.find((e) => e.id === assignedEmployeeId) : undefined;

      const walkIn = {
        id: makeId('WLK'),
        customerId: customer.id,
        customerName: customer.fullName,
        customerPhone: customer.phone,
        requestedServiceIds: srvs.map((s) => s.id),
        requestedServiceNames: srvs.map((s) => s.name),
        assignedEmployeeId: emp?.id,
        assignedEmployeeName: emp?.fullName,
        arrivalTime: new Date().toISOString(),
        status: emp ? ('Being Served' as const) : ('Waiting' as const),
        notes,
      };
      db.walkIns.unshift(walkIn);
      appendAuditLog(
        db,
        req.sessionUser!,
        'WALKIN_REGISTERED',
        'WalkIn',
        walkIn.id,
        `Walk-in customer ${customer.fullName} added (${walkIn.status}).`
      );
      writeDb(db);
      res.status(201).json({ walkIn, customer });
    }
  );

  router.patch(
    '/walkins/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const walkIn = db.walkIns.find((w) => w.id === req.params.id);
      if (!walkIn) {
        res.status(404).json({ error: 'Walk-in record not found.' });
        return;
      }
      const { status, assignedEmployeeId } = req.body as {
        status?: 'Waiting' | 'Being Served' | 'Completed' | 'Left';
        assignedEmployeeId?: string;
      };
      if (assignedEmployeeId) {
        const emp = db.employees.find((e) => e.id === assignedEmployeeId);
        if (emp) {
          walkIn.assignedEmployeeId = emp.id;
          walkIn.assignedEmployeeName = emp.fullName;
        }
      }
      if (status) walkIn.status = status;
      writeDb(db);
      res.json({ walkIn });
    }
  );

  // ==================== CUSTOMERS / CRM ====================
  router.get('/customers', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    if (req.sessionUser!.role === 'employee') {
      // Employees only see non-sensitive names/preferences for customers they serve
      res.json({
        customers: db.customers.map((c) => ({
          id: c.id,
          fullName: c.fullName,
          preferences: c.preferences,
          specialInstructions: c.specialInstructions,
          hairColorHistory: c.hairColorHistory,
        })),
      });
      return;
    }
    res.json({ customers: db.customers });
  });

  router.post(
    '/customers',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const body = req.body as Partial<Customer>;
      if (!body.fullName?.trim() || !body.phone?.trim()) {
        res.status(400).json({ error: 'Customer full name and phone number are required.' });
        return;
      }
      const customer: Customer = {
        id: makeId('CUST'),
        fullName: body.fullName.trim(),
        phone: body.phone.trim(),
        email: body.email?.trim() || '',
        gender: body.gender || '',
        registrationDate: todayIsoDate(),
        preferredStylistId: body.preferredStylistId,
        preferences: body.preferences,
        specialInstructions: body.specialInstructions,
        hairColorHistory: body.hairColorHistory,
        productPreferences: body.productPreferences,
        birthday: body.birthday,
        notes: body.notes,
        loyaltyPoints: 0,
        loyaltyTier: 'Bronze',
        totalVisits: 0,
        totalSpent: 0,
      };
      db.customers.unshift(customer);
      appendAuditLog(
        db,
        req.sessionUser!,
        'CUSTOMER_CREATED',
        'Customer',
        customer.id,
        `Registered customer ${customer.fullName} (${customer.phone}).`
      );
      writeDb(db);
      res.status(201).json({ customer });
    }
  );

  router.patch(
    '/customers/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const customer = db.customers.find((c) => c.id === req.params.id);
      if (!customer) {
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }
      Object.assign(customer, {
        fullName: req.body.fullName ?? customer.fullName,
        phone: req.body.phone ?? customer.phone,
        email: req.body.email ?? customer.email,
        gender: req.body.gender ?? customer.gender,
        preferredStylistId: req.body.preferredStylistId ?? customer.preferredStylistId,
        preferences: req.body.preferences ?? customer.preferences,
        specialInstructions: req.body.specialInstructions ?? customer.specialInstructions,
        hairColorHistory: req.body.hairColorHistory ?? customer.hairColorHistory,
        productPreferences: req.body.productPreferences ?? customer.productPreferences,
        birthday: req.body.birthday ?? customer.birthday,
        notes: req.body.notes ?? customer.notes,
      });
      writeDb(db);
      res.json({ customer });
    }
  );

  router.get(
    '/customers/:id/history',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req, res) => {
      const db = readDb();
      const customer = db.customers.find((c) => c.id === req.params.id);
      if (!customer) {
        res.status(404).json({ error: 'Customer not found.' });
        return;
      }
      const appointments = db.appointments.filter((a) => a.customerId === customer.id);
      const transactions = db.posTransactions.filter((t) => t.customerId === customer.id);
      const notes = db.customerNotes.filter((n) => n.customerId === customer.id);
      const feedback = db.customerFeedback.filter((f) => f.customerId === customer.id);
      res.json({ customer, appointments, transactions, notes, feedback });
    }
  );

  router.post(
    '/customers/:id/notes',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { note } = req.body as { note: string };
      if (!note?.trim()) {
        res.status(400).json({ error: 'Note text is required.' });
        return;
      }
      const entry = {
        id: makeId('NOTE'),
        customerId: req.params.id,
        authorId: req.sessionUser!.userId,
        authorName: req.sessionUser!.name,
        note: note.trim(),
        createdAt: new Date().toISOString(),
      };
      db.customerNotes.unshift(entry);
      writeDb(db);
      res.status(201).json({ note: entry });
    }
  );

  function sanitizeAvatarUrl(raw: unknown): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const val = String(raw).trim();
    if (!val) return '';
    if (val.length > 1_500_000) {
      throw new Error('Profile picture file is too large. Please upload a smaller image (under 1 MB).');
    }
    const isSafeDataImage = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(val);
    const isSafeUrl = /^https?:\/\/.+/i.test(val) || val.startsWith('/src/assets/');
    if (!isSafeDataImage && !isSafeUrl) {
      throw new Error('Invalid profile picture format. Please upload a PNG, JPG, or WebP image.');
    }
    return val;
  }

  function sanitizeNationalIdDocUrl(raw: unknown, label: string): string | undefined {
    if (raw === undefined || raw === null) return undefined;
    const val = String(raw).trim();
    if (!val) return '';
    if (val.length > 3_500_000) {
      throw new Error(`${label} file is too large. Please upload a smaller image or PDF (under 2.5 MB).`);
    }
    const isSafeDataDoc = /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/i.test(val);
    const isSafeUrl = /^https?:\/\/.+/i.test(val);
    if (!isSafeDataDoc && !isSafeUrl) {
      throw new Error(`Invalid ${label} format. Please upload a PNG, JPG, WebP image or PDF.`);
    }
    return val;
  }

  function fileExtensionFromMime(mimeType: string): string {
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType === 'text/csv') return 'csv';
    if (mimeType === 'text/plain') return 'txt';
    if (mimeType.includes('spreadsheetml') || mimeType === 'application/vnd.ms-excel') return 'xlsx';
    if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') return 'docx';
    return 'bin';
  }

  async function uploadEmployeeDataUrlToDrive(
    token: string,
    db: SalonDatabase,
    emp: Employee,
    kind: 'avatar' | 'id_front' | 'id_back',
    dataUrl: string,
    uploadedBy: string
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const { mimeType, buffer } = parseDataUrl(dataUrl);
    const category: DriveDocumentCategory = kind === 'avatar' ? 'Employee Photo' : 'National ID';
    const { rootFolderId, folderId, folderName } = await ensureCategoryDriveFolder(
      token,
      category,
      db.settings.googleDriveFolderId
    );
    db.settings.googleDriveFolderId = rootFolderId;

    const safeEmpName = emp.fullName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
    const ext = fileExtensionFromMime(mimeType);
    const suffix =
      kind === 'avatar' ? 'Profile_Photo' : kind === 'id_front' ? 'National_ID_Front' : 'National_ID_Back';
    const fileName = `${emp.id}_${safeEmpName}_${suffix}.${ext}`;

    const uploaded = await uploadBinaryToGoogleDrive(token, {
      fileName,
      mimeType,
      buffer,
      folderId,
      description: `${category} for ${emp.fullName} (${emp.id}) — Trendy Unisex Salon`,
    });

    const docRecord: DriveDocumentRecord = {
      id: makeId('DRV'),
      driveFileId: uploaded.id,
      name: uploaded.name,
      category,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      webViewLink: uploaded.webViewLink,
      folderName,
      relatedEmployeeId: emp.id,
      relatedEmployeeName: emp.fullName,
      notes: kind === 'avatar' ? 'Employee profile photo' : `National ID (${kind === 'id_front' ? 'Front' : 'Back'})`,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    };
    db.driveDocuments.unshift(docRecord);

    return { fileId: uploaded.id, webViewLink: uploaded.webViewLink };
  }

  const VALID_EMPLOYEE_STATUSES: EmployeeStatus[] = ['Active', 'On Leave', 'Inactive'];

  function resolveEmployeeStatus(emp: Pick<Employee, 'status' | 'active'>): EmployeeStatus {
    if (emp.status && VALID_EMPLOYEE_STATUSES.includes(emp.status)) {
      return emp.status;
    }
    return emp.active ? 'Active' : 'Inactive';
  }

  // ==================== EMPLOYEES, SCHEDULES & ATTENDANCE ====================
  router.get('/employees', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    if (user.role === 'employee') {
      const me = db.employees.filter((e) => e.id === user.employeeId);
      res.json({
        employees: me.map((e) => ({
          ...e,
          status: resolveEmployeeStatus(e),
          summary: getEmployeeCommissionSummary(db, e.id),
        })),
      });
      return;
    }
    const enriched = db.employees.map((e) => ({
      ...e,
      status: resolveEmployeeStatus(e),
      summary: getEmployeeCommissionSummary(db, e.id),
    }));
    res.json({ employees: enriched });
  });

  router.post(
    '/employees',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const body = req.body as Partial<Employee>;
      if (!body.fullName?.trim() || !body.phone?.trim()) {
        res.status(400).json({ error: 'Employee full name and primary contact phone are required.' });
        return;
      }

      let avatarUrl: string | undefined;
      let nationalIdDocumentUrl: string | undefined;
      let nationalIdBackUrl: string | undefined;
      try {
        avatarUrl = sanitizeAvatarUrl(body.avatarUrl);
        nationalIdDocumentUrl = sanitizeNationalIdDocUrl(body.nationalIdDocumentUrl, 'National ID Front');
        nationalIdBackUrl = sanitizeNationalIdDocUrl(body.nationalIdBackUrl, 'National ID Back');
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid file upload.' });
        return;
      }

      const normalizedNin = body.nationalId?.trim().toUpperCase() || '';
      if (
        normalizedNin &&
        db.employees.some((e) => (e.nationalId || '').trim().toUpperCase() === normalizedNin)
      ) {
        res.status(409).json({ error: `National ID ${normalizedNin} is already registered to another employee.` });
        return;
      }

      if (body.status !== undefined && !VALID_EMPLOYEE_STATUSES.includes(body.status)) {
        res.status(400).json({ error: 'Invalid employee status. Must be Active, On Leave, or Inactive.' });
        return;
      }

      const initialStatus: EmployeeStatus = body.status
        ? body.status
        : body.active === false
          ? 'Inactive'
          : 'Active';
      const nowIso = new Date().toISOString();

      const emp: Employee = {
        id: makeId('EMP'),
        fullName: body.fullName.trim(),
        roleTitle: body.roleTitle?.trim() || 'Salon Stylist',
        phone: body.phone.trim(),
        secondaryPhone: body.secondaryPhone?.trim() || '',
        email: body.email?.trim() || '',
        nationalId: normalizedNin,
        nationalIdDocumentUrl: nationalIdDocumentUrl || undefined,
        nationalIdBackUrl: nationalIdBackUrl || undefined,
        homeAddress: body.homeAddress?.trim() || '',
        emergencyContactName: body.emergencyContactName?.trim() || '',
        emergencyContactPhone: body.emergencyContactPhone?.trim() || '',
        specialties: Array.isArray(body.specialties) ? body.specialties : [],
        avatarUrl: avatarUrl || undefined,
        status: initialStatus,
        active: initialStatus === 'Active',
        hireDate: body.hireDate || todayIsoDate(),
        lastDocumentUpdatedAt: nowIso,
        lastDocumentUpdatedBy: req.sessionUser!.name,
        lunchEligible: body.lunchEligible ?? true,
        defaultShiftStart: body.defaultShiftStart || '08:00',
        defaultShiftEnd: body.defaultShiftEnd || '20:00',
        workingDays:
          Array.isArray(body.workingDays) && body.workingDays.length > 0
            ? body.workingDays
            : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      };

      let driveWarning: string | undefined;
      const googleToken = req.headers['x-google-token']?.toString();
      if (googleToken) {
        try {
          if (emp.avatarUrl?.startsWith('data:')) {
            const up = await uploadEmployeeDataUrlToDrive(
              googleToken,
              db,
              emp,
              'avatar',
              emp.avatarUrl,
              req.sessionUser!.name
            );
            emp.avatarDriveFileId = up.fileId;
            emp.avatarDriveLink = up.webViewLink;
          }
          if (emp.nationalIdDocumentUrl?.startsWith('data:')) {
            const up = await uploadEmployeeDataUrlToDrive(
              googleToken,
              db,
              emp,
              'id_front',
              emp.nationalIdDocumentUrl,
              req.sessionUser!.name
            );
            emp.nationalIdFrontDriveFileId = up.fileId;
            emp.nationalIdFrontDriveLink = up.webViewLink;
          }
          if (emp.nationalIdBackUrl?.startsWith('data:')) {
            const up = await uploadEmployeeDataUrlToDrive(
              googleToken,
              db,
              emp,
              'id_back',
              emp.nationalIdBackUrl,
              req.sessionUser!.name
            );
            emp.nationalIdBackDriveFileId = up.fileId;
            emp.nationalIdBackDriveLink = up.webViewLink;
          }
        } catch (err) {
          driveWarning =
            err instanceof Error
              ? `Employee saved locally, but Google Drive upload failed: ${err.message}`
              : 'Employee saved locally, but Google Drive upload failed.';
        }
      }

      db.employees.push(emp);
      appendAuditLog(
        db,
        req.sessionUser!,
        'EMPLOYEE_CREATED',
        'Employee',
        emp.id,
        `Added employee ${emp.fullName} (${emp.roleTitle})${emp.nationalId ? ` · NIN ${emp.nationalId}` : ''}.`
      );
      writeDb(db);
      res.status(201).json({ employee: emp, driveWarning });
    }
  );

  router.patch(
    '/employees/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const emp = db.employees.find((e) => e.id === req.params.id);
      if (!emp) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }

      const body = req.body as Partial<Employee>;
      if (body.fullName !== undefined && !String(body.fullName).trim()) {
        res.status(400).json({ error: 'Employee full name cannot be empty.' });
        return;
      }
      if (body.phone !== undefined && !String(body.phone).trim()) {
        res.status(400).json({ error: 'Employee primary contact phone cannot be empty.' });
        return;
      }

      const prevAvatar = emp.avatarUrl;
      const prevIdFront = emp.nationalIdDocumentUrl;
      const prevIdBack = emp.nationalIdBackUrl;

      let nextAvatar = emp.avatarUrl;
      let nextIdFront = emp.nationalIdDocumentUrl;
      let nextIdBack = emp.nationalIdBackUrl;
      try {
        if (body.avatarUrl !== undefined) {
          const sanitized = sanitizeAvatarUrl(body.avatarUrl);
          nextAvatar = sanitized ? sanitized : undefined;
        }
        if (body.nationalIdDocumentUrl !== undefined) {
          const sanitizedFront = sanitizeNationalIdDocUrl(body.nationalIdDocumentUrl, 'National ID Front');
          nextIdFront = sanitizedFront ? sanitizedFront : undefined;
        }
        if (body.nationalIdBackUrl !== undefined) {
          const sanitizedBack = sanitizeNationalIdDocUrl(body.nationalIdBackUrl, 'National ID Back');
          nextIdBack = sanitizedBack ? sanitizedBack : undefined;
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid file upload.' });
        return;
      }

      const nextNin =
        body.nationalId !== undefined ? body.nationalId.trim().toUpperCase() : emp.nationalId || '';
      if (
        nextNin &&
        db.employees.some(
          (other) => other.id !== emp.id && (other.nationalId || '').trim().toUpperCase() === nextNin
        )
      ) {
        res.status(409).json({ error: `National ID ${nextNin} is already registered to another employee.` });
        return;
      }

      if (body.status !== undefined && !VALID_EMPLOYEE_STATUSES.includes(body.status)) {
        res.status(400).json({ error: 'Invalid employee status. Must be Active, On Leave, or Inactive.' });
        return;
      }

      const currentStatus = resolveEmployeeStatus(emp);
      const nextStatus: EmployeeStatus =
        body.status !== undefined
          ? body.status
          : body.active !== undefined
            ? body.active
              ? 'Active'
              : 'Inactive'
            : currentStatus;

      if (
        req.sessionUser!.role === 'manager' &&
        currentStatus === 'Inactive' &&
        nextStatus !== 'Inactive'
      ) {
        res.status(403).json({
          error:
            'Only the Owner / Admin can re-enable a disabled employee account. Managers can only disable employee accounts.',
        });
        return;
      }

      const nextActive = nextStatus === 'Active';

      const nextFullName = body.fullName !== undefined ? body.fullName.trim() : emp.fullName;
      const nextRoleTitle = body.roleTitle !== undefined ? body.roleTitle.trim() : emp.roleTitle;
      const nextPhone = body.phone !== undefined ? body.phone.trim() : emp.phone;
      const nextSecondaryPhone =
        body.secondaryPhone !== undefined ? body.secondaryPhone.trim() : emp.secondaryPhone || '';
      const nextEmail = body.email !== undefined ? body.email.trim() : emp.email;
      const nextHomeAddress =
        body.homeAddress !== undefined ? body.homeAddress.trim() : emp.homeAddress || '';
      const nextEmergencyName =
        body.emergencyContactName !== undefined
          ? body.emergencyContactName.trim()
          : emp.emergencyContactName || '';
      const nextEmergencyPhone =
        body.emergencyContactPhone !== undefined
          ? body.emergencyContactPhone.trim()
          : emp.emergencyContactPhone || '';
      const nextHireDate = body.hireDate || emp.hireDate;
      const nextSpecialties = Array.isArray(body.specialties) ? body.specialties : emp.specialties;

      const recordsOrIdModified =
        nextFullName !== emp.fullName ||
        nextRoleTitle !== emp.roleTitle ||
        nextPhone !== emp.phone ||
        nextSecondaryPhone !== (emp.secondaryPhone || '') ||
        nextEmail !== emp.email ||
        nextNin !== (emp.nationalId || '') ||
        nextIdFront !== emp.nationalIdDocumentUrl ||
        nextIdBack !== emp.nationalIdBackUrl ||
        nextAvatar !== emp.avatarUrl ||
        nextHomeAddress !== (emp.homeAddress || '') ||
        nextEmergencyName !== (emp.emergencyContactName || '') ||
        nextEmergencyPhone !== (emp.emergencyContactPhone || '') ||
        nextHireDate !== emp.hireDate ||
        JSON.stringify(nextSpecialties) !== JSON.stringify(emp.specialties);

      Object.assign(emp, {
        fullName: nextFullName,
        roleTitle: nextRoleTitle,
        phone: nextPhone,
        secondaryPhone: nextSecondaryPhone,
        email: nextEmail,
        nationalId: nextNin,
        nationalIdDocumentUrl: nextIdFront,
        nationalIdBackUrl: nextIdBack,
        homeAddress: nextHomeAddress,
        emergencyContactName: nextEmergencyName,
        emergencyContactPhone: nextEmergencyPhone,
        avatarUrl: nextAvatar,
        specialties: nextSpecialties,
        status: nextStatus,
        active: nextActive,
        hireDate: nextHireDate,
        lastDocumentUpdatedAt: recordsOrIdModified
          ? new Date().toISOString()
          : emp.lastDocumentUpdatedAt,
        lastDocumentUpdatedBy: recordsOrIdModified
          ? req.sessionUser!.name
          : emp.lastDocumentUpdatedBy,
        lunchEligible: body.lunchEligible ?? emp.lunchEligible,
        defaultShiftStart: body.defaultShiftStart || emp.defaultShiftStart,
        defaultShiftEnd: body.defaultShiftEnd || emp.defaultShiftEnd,
        workingDays:
          Array.isArray(body.workingDays) && body.workingDays.length > 0
            ? body.workingDays
            : emp.workingDays,
      });

      if (!nextAvatar) {
        emp.avatarDriveFileId = undefined;
        emp.avatarDriveLink = undefined;
      }
      if (!nextIdFront) {
        emp.nationalIdFrontDriveFileId = undefined;
        emp.nationalIdFrontDriveLink = undefined;
      }
      if (!nextIdBack) {
        emp.nationalIdBackDriveFileId = undefined;
        emp.nationalIdBackDriveLink = undefined;
      }

      let driveWarning: string | undefined;
      const googleToken = req.headers['x-google-token']?.toString();
      if (googleToken) {
        try {
          if (nextAvatar?.startsWith('data:') && (nextAvatar !== prevAvatar || !emp.avatarDriveFileId)) {
            const up = await uploadEmployeeDataUrlToDrive(
              googleToken,
              db,
              emp,
              'avatar',
              nextAvatar,
              req.sessionUser!.name
            );
            emp.avatarDriveFileId = up.fileId;
            emp.avatarDriveLink = up.webViewLink;
          }
          if (
            nextIdFront?.startsWith('data:') &&
            (nextIdFront !== prevIdFront || !emp.nationalIdFrontDriveFileId)
          ) {
            const up = await uploadEmployeeDataUrlToDrive(
              googleToken,
              db,
              emp,
              'id_front',
              nextIdFront,
              req.sessionUser!.name
            );
            emp.nationalIdFrontDriveFileId = up.fileId;
            emp.nationalIdFrontDriveLink = up.webViewLink;
          }
          if (
            nextIdBack?.startsWith('data:') &&
            (nextIdBack !== prevIdBack || !emp.nationalIdBackDriveFileId)
          ) {
            const up = await uploadEmployeeDataUrlToDrive(
              googleToken,
              db,
              emp,
              'id_back',
              nextIdBack,
              req.sessionUser!.name
            );
            emp.nationalIdBackDriveFileId = up.fileId;
            emp.nationalIdBackDriveLink = up.webViewLink;
          }
        } catch (err) {
          driveWarning =
            err instanceof Error
              ? `Employee updated locally, but Google Drive upload failed: ${err.message}`
              : 'Employee updated locally, but Google Drive upload failed.';
        }
      }

      // Keep linked login user's display name aligned if fullName changed,
      // and disable linked login account when employee is set to Inactive
      db.users.forEach((u) => {
        if (u.employeeId === emp.id) {
          if (body.fullName !== undefined) {
            u.name = emp.fullName;
          }
          if (nextStatus === 'Inactive' && u.active) {
            u.active = false;
          }
        }
      });

      appendAuditLog(
        db,
        req.sessionUser!,
        'EMPLOYEE_UPDATED',
        'Employee',
        emp.id,
        `Updated profile/status for ${emp.fullName} (${resolveEmployeeStatus(emp)}).`
      );
      writeDb(db);
      res.json({ employee: { ...emp, status: resolveEmployeeStatus(emp) }, driveWarning });
    }
  );

  router.delete(
    '/employees/:id',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const empIndex = db.employees.findIndex((e) => e.id === req.params.id);
      if (empIndex === -1) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }
      const emp = db.employees[empIndex];
      const hasFinancialHistory =
        db.commissionLedger.some((l) => l.employeeId === emp.id) ||
        db.commissionPayments.some((p) => p.employeeId === emp.id) ||
        db.commissionAdjustments.some((a) => a.employeeId === emp.id) ||
        db.lunchDeductions.some((l) => l.employeeId === emp.id) ||
        db.posTransactions.some((t) => t.items.some((i) => i.employeeId === emp.id));

      if (hasFinancialHistory) {
        res.status(409).json({
          error:
            'Cannot permanently delete an employee with existing POS, commission, or payout records. Disable their account (set Inactive) to preserve audit integrity.',
        });
        return;
      }

      db.employees.splice(empIndex, 1);
      db.users = db.users.filter((u) => u.employeeId !== emp.id);
      db.schedules = db.schedules.filter((s) => s.employeeId !== emp.id);
      db.attendance = db.attendance.filter((a) => a.employeeId !== emp.id);
      db.leaves = db.leaves.filter((l) => l.employeeId !== emp.id);
      db.services.forEach((s) => {
        s.qualifiedEmployeeIds = s.qualifiedEmployeeIds.filter((id) => id !== emp.id);
      });

      appendAuditLog(
        db,
        req.sessionUser!,
        'EMPLOYEE_DELETED',
        'Employee',
        emp.id,
        `Permanently deleted employee record and linked account for ${emp.fullName}.`
      );
      writeDb(db);
      res.json({ ok: true, deletedEmployeeId: emp.id });
    }
  );

  router.get('/employees/:id/statement', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    const targetId = req.params.id;
    if (user.role === 'employee' && user.employeeId !== targetId) {
      res.status(403).json({ error: 'Employees may only view their own financial statement.' });
      return;
    }
    const emp = db.employees.find((e) => e.id === targetId);
    if (!emp) {
      res.status(404).json({ error: 'Employee not found.' });
      return;
    }
    res.json({
      employee: { ...emp, status: resolveEmployeeStatus(emp) },
      summary: getEmployeeCommissionSummary(db, targetId),
      ledger: db.commissionLedger.filter((c) => c.employeeId === targetId).reverse(),
      lunchDeductions: db.lunchDeductions.filter((l) => l.employeeId === targetId).reverse(),
      payments: db.commissionPayments.filter((p) => p.employeeId === targetId).reverse(),
      adjustments: db.commissionAdjustments.filter((a) => a.employeeId === targetId).reverse(),
    });
  });

  router.get('/schedules', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    const schedules =
      user.role === 'employee'
        ? db.schedules.filter((s) => s.employeeId === user.employeeId)
        : db.schedules;
    res.json({ schedules });
  });

  router.post(
    '/schedules',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { employeeId, date, shiftStart, shiftEnd, breakStart, breakEnd, isDayOff, notes } = req.body;
      if (!employeeId || !date) {
        res.status(400).json({ error: 'Employee and date are required.' });
        return;
      }
      const existing = db.schedules.find((s) => s.employeeId === employeeId && s.date === date);
      if (existing) {
        Object.assign(existing, { shiftStart, shiftEnd, breakStart, breakEnd, isDayOff: Boolean(isDayOff), notes });
        writeDb(db);
        res.json({ schedule: existing });
        return;
      }
      const schedule = {
        id: makeId('SCH'),
        employeeId,
        date,
        shiftStart: shiftStart || '08:00',
        shiftEnd: shiftEnd || '20:00',
        breakStart,
        breakEnd,
        isDayOff: Boolean(isDayOff),
        notes,
      };
      db.schedules.push(schedule);
      writeDb(db);
      res.status(201).json({ schedule });
    }
  );

  router.get('/attendance', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    const records =
      user.role === 'employee'
        ? db.attendance.filter((a) => a.employeeId === user.employeeId)
        : db.attendance;
    res.json({ attendance: [...records].reverse() });
  });

  router.post(
    '/attendance',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { employeeId, date, clockIn, clockOut, status, notes } = req.body as {
        employeeId: string;
        date: string;
        clockIn?: string;
        clockOut?: string;
        status: 'Present' | 'Late' | 'Absent' | 'Approved Leave';
        notes?: string;
      };
      if (!employeeId || !date) {
        res.status(400).json({ error: 'Employee and date are required.' });
        return;
      }

      let hoursWorked = 0;
      if (clockIn && clockOut) {
        const diff = timeToMinutes(clockOut) - timeToMinutes(clockIn);
        hoursWorked = Math.max(0, Number((diff / 60).toFixed(2)));
      }

      const existing = db.attendance.find((a) => a.employeeId === employeeId && a.date === date);
      if (existing) {
        Object.assign(existing, { clockIn, clockOut, hoursWorked, status, notes });
        writeDb(db);
        res.json({ record: existing });
        return;
      }

      const record = {
        id: makeId('ATT'),
        employeeId,
        date,
        clockIn,
        clockOut,
        hoursWorked,
        status: status || 'Present',
        notes,
      };
      db.attendance.push(record);
      writeDb(db);
      res.status(201).json({ record });
    }
  );

  // ==================== SERVICES & PRICING ====================
  router.get('/services', requireAuth, (_req, res) => {
    const db = readDb();
    res.json({
      categories: db.serviceCategories,
      services: db.services,
      pricingHistory: db.servicePricingHistory,
    });
  });

  router.post(
    '/services',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { name, categoryId, price, durationMinutes, commissionRateOverride, qualifiedEmployeeIds } = req.body;
      const cat = db.serviceCategories.find((c) => c.id === categoryId);
      if (!name?.trim() || !cat || Number(price) <= 0) {
        res.status(400).json({ error: 'Service name, valid category, and positive price are required.' });
        return;
      }
      const service = {
        id: makeId('SRV'),
        name: name.trim(),
        categoryId: cat.id,
        categoryName: cat.name,
        price: Number(price),
        durationMinutes: Number(durationMinutes) || 45,
        commissionRateOverride:
          typeof commissionRateOverride === 'number' ? commissionRateOverride : undefined,
        qualifiedEmployeeIds: qualifiedEmployeeIds || [],
        active: true,
      };
      db.services.push(service);
      appendAuditLog(
        db,
        req.sessionUser!,
        'SERVICE_CREATED',
        'ServiceItem',
        service.id,
        `Added service "${service.name}" at UGX ${service.price}.`
      );
      writeDb(db);
      res.status(201).json({ service });
    }
  );

  router.patch(
    '/services/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const srv = db.services.find((s) => s.id === req.params.id);
      if (!srv) {
        res.status(404).json({ error: 'Service not found.' });
        return;
      }
      if (typeof req.body.price === 'number' && req.body.price !== srv.price) {
        db.servicePricingHistory.unshift({
          id: makeId('SPH'),
          serviceId: srv.id,
          serviceName: srv.name,
          oldPrice: srv.price,
          newPrice: req.body.price,
          changedBy: req.sessionUser!.name,
          changedAt: new Date().toISOString(),
        });
        srv.price = req.body.price;
      }
      if (req.body.name) srv.name = req.body.name;
      if (typeof req.body.durationMinutes === 'number') srv.durationMinutes = req.body.durationMinutes;
      if (typeof req.body.active === 'boolean') srv.active = req.body.active;
      if (Array.isArray(req.body.qualifiedEmployeeIds)) srv.qualifiedEmployeeIds = req.body.qualifiedEmployeeIds;
      if (req.body.categoryId) {
        const cat = db.serviceCategories.find((c) => c.id === req.body.categoryId);
        if (cat) {
          srv.categoryId = cat.id;
          srv.categoryName = cat.name;
        }
      }
      appendAuditLog(
        db,
        req.sessionUser!,
        'SERVICE_UPDATED',
        'ServiceItem',
        srv.id,
        `Updated service "${srv.name}" (UGX ${srv.price}).`
      );
      writeDb(db);
      res.json({ service: srv });
    }
  );

  // ==================== POS & BILLING ====================
  router.get('/pos/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    if (user.role === 'employee') {
      res.json({
        transactions: db.posTransactions
          .filter((tx) => tx.items.some((i) => i.employeeId === user.employeeId))
          .slice(-50)
          .reverse(),
      });
      return;
    }
    res.json({
      transactions: [...db.posTransactions].reverse(),
      refunds: [...db.refunds].reverse(),
      tips: [...db.tips].reverse(),
    });
  });

  router.post(
    '/pos/transactions',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const {
        reference,
        date,
        customerId,
        customerName,
        appointmentId,
        walkInId,
        items,
        discountTotal,
        tipAmount,
        tipEmployeeId,
        payments,
        notes,
        overrideNegativeStock,
      } = req.body as {
        reference?: string;
        date?: string;
        customerId?: string;
        customerName?: string;
        appointmentId?: string;
        walkInId?: string;
        items: Array<{
          itemType: 'service' | 'product';
          refId: string;
          employeeId?: string;
          quantity: number;
          unitPrice?: number;
          discount?: number;
        }>;
        discountTotal?: number;
        tipAmount?: number;
        tipEmployeeId?: string;
        payments: Array<{
          method: PaymentMethod;
          amount: number;
          reference?: string;
          giftCardCode?: string;
        }>;
        notes?: string;
        overrideNegativeStock?: boolean;
      };

      if (!items || items.length === 0) {
        res.status(400).json({ error: 'At least one service or retail product is required.' });
        return;
      }

      const txDate = date || todayIsoDate();
      const txRef = reference?.trim() || `TUS-${txDate.replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Duplicate transaction protection
      if (db.posTransactions.some((t) => t.reference === txRef)) {
        res.status(409).json({ error: `Duplicate transaction reference detected: ${txRef}` });
        return;
      }

      const policy = getPolicyForDate(db.commissionPolicies, txDate);
      const resolvedItems: POSTransaction['items'] = [];
      let subtotal = 0;

      // Validate all items, employees, and inventory BEFORE mutating anything
      const stockDeductions: Array<{ item: StockItem; qty: number }> = [];

      for (const line of items) {
        const qty = Math.max(1, Number(line.quantity) || 1);
        const lineDiscount = Math.max(0, Number(line.discount) || 0);

        if (line.itemType === 'service') {
          const srv = db.services.find((s) => s.id === line.refId);
          if (!srv) {
            res.status(404).json({ error: `Service not found: ${line.refId}` });
            return;
          }
          if (!line.employeeId) {
            res.status(400).json({ error: `Please assign a stylist for service "${srv.name}".` });
            return;
          }
          const emp = db.employees.find((e) => e.id === line.employeeId);
          if (!emp) {
            res.status(404).json({ error: `Assigned employee not found: ${line.employeeId}` });
            return;
          }

          const unitPrice = typeof line.unitPrice === 'number' && line.unitPrice >= 0 ? line.unitPrice : srv.price;
          const lineTotal = Math.max(0, unitPrice * qty - lineDiscount);
          subtotal += lineTotal;
          const rate = resolveServiceCommissionRate(
            srv.categoryName,
            policy,
            srv.commissionRateOverride
          );

          resolvedItems.push({
            id: makeId('ITEM'),
            itemType: 'service',
            refId: srv.id,
            name: srv.name,
            categoryName: srv.categoryName,
            employeeId: emp.id,
            employeeName: emp.fullName,
            quantity: qty,
            unitPrice,
            discount: lineDiscount,
            lineTotal,
            commissionRateApplied: rate,
          });
        } else {
          const stock = db.stockItems.find((s) => s.id === line.refId);
          if (!stock) {
            res.status(404).json({ error: `Retail product not found: ${line.refId}` });
            return;
          }
          if (stock.currentQuantity < qty) {
            const canOverride =
              overrideNegativeStock &&
              db.settings.allowNegativeStockWithApproval &&
              ['owner', 'manager'].includes(req.sessionUser!.role);
            if (!canOverride) {
              res.status(400).json({
                error: `Insufficient stock for "${stock.name}". Available: ${stock.currentQuantity} ${stock.unit}, requested: ${qty}.`,
              });
              return;
            }
          }
          stockDeductions.push({ item: stock, qty });

          const unitPrice =
            typeof line.unitPrice === 'number' && line.unitPrice >= 0 ? line.unitPrice : stock.sellingPrice;
          const lineTotal = Math.max(0, unitPrice * qty - lineDiscount);
          subtotal += lineTotal;

          const emp = line.employeeId ? db.employees.find((e) => e.id === line.employeeId) : undefined;
          resolvedItems.push({
            id: makeId('ITEM'),
            itemType: 'product',
            refId: stock.id,
            name: stock.name,
            categoryName: stock.category,
            employeeId: emp?.id,
            employeeName: emp?.fullName,
            quantity: qty,
            unitPrice,
            discount: lineDiscount,
            lineTotal,
          });
        }
      }

      const globalDiscount = Math.max(0, Number(discountTotal) || 0);
      const taxableBase = Math.max(0, subtotal - globalDiscount);
      const taxAmount = db.settings.taxEnabled
        ? Math.round(taxableBase * (db.settings.taxRate / 100))
        : 0;
      const tip = Math.max(0, Number(tipAmount) || 0);
      const totalAmount = taxableBase + taxAmount + tip;

      // Validate gift card payments before mutating
      const validPayments = (payments || []).filter((p) => Number(p.amount) > 0);
      const giftCardValidations: Array<{ card: GiftCard; amount: number }> = [];
      for (const p of validPayments) {
        if (p.method === 'Gift Card') {
          const card = db.giftCards.find(
            (g) => g.code.toUpperCase() === (p.giftCardCode || '').trim().toUpperCase()
          );
          if (!card || card.status !== 'Active') {
            res.status(400).json({ error: `Gift card "${p.giftCardCode}" is invalid or inactive.` });
            return;
          }
          if (card.expirationDate && card.expirationDate < txDate) {
            res.status(400).json({ error: `Gift card "${card.code}" has expired.` });
            return;
          }
          if (card.balance < p.amount) {
            res.status(400).json({
              error: `Gift card "${card.code}" balance is UGX ${card.balance.toLocaleString()}, less than requested UGX ${p.amount.toLocaleString()}.`,
            });
            return;
          }
          giftCardValidations.push({ card, amount: Number(p.amount) });
        }
      }

      const amountPaid = validPayments.reduce((s, p) => s + Number(p.amount), 0);
      if (amountPaid > totalAmount) {
        res.status(400).json({
          error: `Total payments (UGX ${amountPaid.toLocaleString()}) exceed bill total (UGX ${totalAmount.toLocaleString()}).`,
        });
        return;
      }

      const balanceDue = Math.max(0, totalAmount - amountPaid);
      const txId = makeId('TX');
      const now = new Date().toISOString();

      const customer = customerId ? db.customers.find((c) => c.id === customerId) : undefined;
      const resolvedCustomerName = customer?.fullName || customerName?.trim() || 'Walk-in Guest';

      const txPayments: TransactionPayment[] = validPayments.map((p) => ({
        id: makeId('PAY'),
        transactionId: txId,
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference,
        giftCardCode: p.giftCardCode,
        paidAt: now,
        recordedBy: req.sessionUser!.name,
      }));

      const tx: POSTransaction = {
        id: txId,
        reference: txRef,
        date: txDate,
        createdAt: now,
        customerId: customer?.id,
        customerName: resolvedCustomerName,
        appointmentId,
        walkInId,
        cashierId: req.sessionUser!.userId,
        cashierName: req.sessionUser!.name,
        items: resolvedItems,
        subtotal,
        discountTotal: globalDiscount,
        taxAmount,
        tipAmount: tip,
        tipEmployeeId,
        totalAmount,
        amountPaid,
        balanceDue,
        payments: txPayments,
        status: balanceDue === 0 ? 'Completed' : 'Partial',
        isHistorical: false,
        notes,
      };

      // Commit all linked updates atomically
      db.posTransactions.push(tx);

      // 1. Gift card redemptions
      for (const { card, amount } of giftCardValidations) {
        card.balance -= amount;
        if (card.balance <= 0) {
          card.balance = 0;
          card.status = 'Redeemed';
        }
        db.giftCardTransactions.unshift({
          id: makeId('GCT'),
          giftCardId: card.id,
          code: card.code,
          type: 'Redemption',
          amount,
          balanceAfter: card.balance,
          posTransactionId: tx.id,
          createdAt: now,
          performedBy: req.sessionUser!.name,
        });
      }

      // 2. Inventory stock deductions + low stock alert
      for (const { item, qty } of stockDeductions) {
        item.currentQuantity -= qty;
        db.stockMovements.unshift({
          id: makeId('MOV'),
          stockItemId: item.id,
          stockItemName: item.name,
          date: txDate,
          type: 'Retail Sale',
          quantityDelta: -qty,
          quantityAfter: item.currentQuantity,
          referenceId: tx.reference,
          notes: `Sold via POS (${tx.reference})`,
          recordedBy: req.sessionUser!.name,
          createdAt: now,
        });
        if (item.currentQuantity <= item.minStockLevel) {
          db.notifications.unshift({
            id: makeId('NTF'),
            type: 'low_stock',
            title: 'Low Stock Alert',
            message: `${item.name} (${item.sku}) is at ${item.currentQuantity} ${item.unit} (min: ${item.minStockLevel}).`,
            severity: 'warning',
            read: false,
            targetRoles: ['owner', 'manager'],
            createdAt: now,
          });
        }
      }

      // 3. Tips ledger (never mixed into service commission!)
      if (tip > 0 && tipEmployeeId) {
        const tipEmp = db.employees.find((e) => e.id === tipEmployeeId);
        if (tipEmp) {
          db.tips.push({
            id: makeId('TIP'),
            transactionId: tx.id,
            date: txDate,
            employeeId: tipEmp.id,
            employeeName: tipEmp.fullName,
            amount: tip,
            distributionMode: policy.tipPolicy,
            createdAt: now,
          });
        }
      }

      // 4. Customer visit & loyalty update
      if (customer) {
        customer.totalVisits += 1;
        customer.totalSpent += amountPaid;
        customer.lastVisitDate = txDate;
        const pointsEarned = Math.floor(
          (amountPaid / 10000) * (db.settings.loyaltyPointsPer10k || 10)
        );
        customer.loyaltyPoints += pointsEarned;
        customer.loyaltyTier = getLoyaltyTier(customer.loyaltyPoints);
      }

      // 5. Appointment / Walk-in status update
      if (appointmentId) {
        const apt = db.appointments.find((a) => a.id === appointmentId);
        if (apt) {
          apt.status = 'Completed';
          apt.posTransactionId = tx.id;
          apt.updatedAt = now;
        }
      }
      if (walkInId) {
        const wlk = db.walkIns.find((w) => w.id === walkInId);
        if (wlk) {
          wlk.status = 'Completed';
          wlk.posTransactionId = tx.id;
        }
      }

      // 6. Commission & once-per-day lunch ledger recomputation for involved stylists
      const involvedEmployees = new Set(
        resolvedItems.map((i) => i.employeeId).filter((id): id is string => Boolean(id))
      );
      for (const empId of involvedEmployees) {
        recomputeEmployeeDailyCommission(db, empId, txDate);
      }

      appendAuditLog(
        db,
        req.sessionUser!,
        'POS_TRANSACTION_CREATED',
        'POSTransaction',
        tx.id,
        `Recorded ${tx.reference} for ${resolvedCustomerName}: Total UGX ${totalAmount.toLocaleString()}, Paid UGX ${amountPaid.toLocaleString()}, Status ${tx.status}.`
      );
      writeDb(db);
      res.status(201).json({ transaction: tx });
    }
  );

  router.post(
    '/pos/transactions/:id/payment',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const tx = db.posTransactions.find((t) => t.id === req.params.id);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found.' });
        return;
      }
      if (tx.status === 'Reversed' || tx.status === 'Refunded') {
        res.status(400).json({ error: 'Cannot pay on a reversed/refunded transaction.' });
        return;
      }
      const { method, amount, reference } = req.body as {
        method: PaymentMethod;
        amount: number;
        reference?: string;
      };
      const payAmt = Number(amount);
      if (!payAmt || payAmt <= 0 || payAmt > tx.balanceDue) {
        res.status(400).json({
          error: `Payment amount must be between UGX 1 and UGX ${tx.balanceDue.toLocaleString()}.`,
        });
        return;
      }

      const now = new Date().toISOString();
      tx.payments.push({
        id: makeId('PAY'),
        transactionId: tx.id,
        method,
        amount: payAmt,
        reference,
        paidAt: now,
        recordedBy: req.sessionUser!.name,
      });
      tx.amountPaid += payAmt;
      tx.balanceDue = Math.max(0, tx.totalAmount - tx.amountPaid);
      tx.status = tx.balanceDue === 0 ? 'Completed' : 'Partial';

      if (tx.customerId) {
        const cust = db.customers.find((c) => c.id === tx.customerId);
        if (cust) cust.totalSpent += payAmt;
      }

      appendAuditLog(
        db,
        req.sessionUser!,
        'POS_BALANCE_PAYMENT',
        'POSTransaction',
        tx.id,
        `Collected UGX ${payAmt.toLocaleString()} (${method}) on ${tx.reference}. Remaining due: UGX ${tx.balanceDue.toLocaleString()}.`
      );
      writeDb(db);
      res.json({ transaction: tx });
    }
  );

  router.post(
    '/pos/transactions/:id/reverse',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const tx = db.posTransactions.find((t) => t.id === req.params.id);
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found.' });
        return;
      }
      if (tx.isHistorical) {
        res.status(403).json({
          error: 'Historical imported transactions are locked and cannot be altered or reversed.',
        });
        return;
      }
      if (tx.status === 'Reversed' || tx.status === 'Refunded') {
        res.status(400).json({ error: 'Transaction is already reversed/refunded.' });
        return;
      }
      const { reason } = req.body as { reason: string };
      if (!reason?.trim()) {
        res.status(400).json({ error: 'Reversal reason is required for the audit trail.' });
        return;
      }

      const now = new Date().toISOString();
      tx.status = 'Reversed';

      db.refunds.unshift({
        id: makeId('REF'),
        transactionId: tx.id,
        transactionReference: tx.reference,
        amount: tx.amountPaid,
        reason: reason.trim(),
        processedById: req.sessionUser!.userId,
        processedByName: req.sessionUser!.name,
        createdAt: now,
      });

      // Restore retail inventory
      for (const item of tx.items) {
        if (item.itemType === 'product') {
          const stock = db.stockItems.find((s) => s.id === item.refId);
          if (stock) {
            stock.currentQuantity += item.quantity;
            db.stockMovements.unshift({
              id: makeId('MOV'),
              stockItemId: stock.id,
              stockItemName: stock.name,
              date: todayIsoDate(),
              type: 'Return',
              quantityDelta: item.quantity,
              quantityAfter: stock.currentQuantity,
              referenceId: tx.reference,
              notes: `Reversed transaction ${tx.reference}: ${reason.trim()}`,
              recordedBy: req.sessionUser!.name,
              createdAt: now,
            });
          }
        }
      }

      // Recompute employee commissions & lunch deductions for that date
      const emps = new Set(tx.items.map((i) => i.employeeId).filter((id): id is string => Boolean(id)));
      for (const empId of emps) {
        recomputeEmployeeDailyCommission(db, empId, tx.date);
      }

      appendAuditLog(
        db,
        req.sessionUser!,
        'POS_TRANSACTION_REVERSED',
        'POSTransaction',
        tx.id,
        `Reversed ${tx.reference} (UGX ${tx.totalAmount.toLocaleString()}). Reason: ${reason.trim()}`
      );
      writeDb(db);
      res.json({ transaction: tx });
    }
  );

  // ==================== COMMISSIONS, LUNCH & PAYMENTS ====================
  router.get('/commissions', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;

    if (user.role === 'employee') {
      const empId = user.employeeId || '';
      const emp = db.employees.find((e) => e.id === empId);
      res.json({
        policies: db.commissionPolicies,
        ledger: db.commissionLedger.filter((c) => c.employeeId === empId).reverse(),
        lunchDeductions: db.lunchDeductions.filter((l) => l.employeeId === empId).reverse(),
        payments: db.commissionPayments.filter((p) => p.employeeId === empId).reverse(),
        adjustments: db.commissionAdjustments.filter((a) => a.employeeId === empId).reverse(),
        summaries: emp
          ? [{ employeeId: emp.id, employeeName: emp.fullName, ...getEmployeeCommissionSummary(db, emp.id) }]
          : [],
      });
      return;
    }

    const summaries = db.employees.map((emp) => ({
      employeeId: emp.id,
      employeeName: emp.fullName,
      roleTitle: emp.roleTitle,
      ...getEmployeeCommissionSummary(db, emp.id),
    }));

    res.json({
      policies: db.commissionPolicies,
      ledger: [...db.commissionLedger].reverse(),
      lunchDeductions: [...db.lunchDeductions].reverse(),
      payments: [...db.commissionPayments].reverse(),
      adjustments: [...db.commissionAdjustments].reverse(),
      summaries,
    });
  });

  router.post(
    '/commission-policies',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const body = req.body as Partial<CommissionPolicy>;
      if (!body.effectiveDate) {
        res.status(400).json({ error: 'Effective date is required.' });
        return;
      }

      const policy: CommissionPolicy = {
        id: makeId('POL'),
        effectiveDate: body.effectiveDate,
        plaitingRate: Number(body.plaitingRate ?? 0.5),
        blowDryRate: Number(body.blowDryRate ?? 0.3),
        defaultOtherRate: Number(body.defaultOtherRate ?? 0.4),
        productCommissionEnabled: Boolean(body.productCommissionEnabled),
        productCommissionRate: Number(body.productCommissionRate ?? 0),
        lunchDeductionAmount: Number(body.lunchDeductionAmount ?? 2500),
        lunchAllocationMethod: body.lunchAllocationMethod || 'proportional',
        tipPolicy: body.tipPolicy || 'direct_to_employee',
        approvedBy: req.sessionUser!.name,
        createdAt: new Date().toISOString(),
        notes: body.notes,
      };
      db.commissionPolicies.push(policy);
      appendAuditLog(
        db,
        req.sessionUser!,
        'COMMISSION_POLICY_CREATED',
        'CommissionPolicy',
        policy.id,
        `New policy effective ${policy.effectiveDate}: Plaiting ${policy.plaitingRate * 100}%, BlowDry ${policy.blowDryRate * 100}%, Other ${policy.defaultOtherRate * 100}%, Lunch UGX ${policy.lunchDeductionAmount}, Allocation ${policy.lunchAllocationMethod}.`
      );
      writeDb(db);
      res.status(201).json({ policy });
    }
  );

  router.post(
    '/commission-payments',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { employeeId, amount, paymentDate, paymentMethod, notes } = req.body as {
        employeeId: string;
        amount: number;
        paymentDate?: string;
        paymentMethod: PaymentMethod;
        notes?: string;
      };
      const emp = db.employees.find((e) => e.id === employeeId);
      if (!emp) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }
      const payAmt = Number(amount);
      if (!payAmt || payAmt <= 0) {
        res.status(400).json({ error: 'Payment amount must be greater than zero.' });
        return;
      }

      const summary = getEmployeeCommissionSummary(db, employeeId);
      if (payAmt > summary.outstandingBalance) {
        res.status(400).json({
          error: `Payment (UGX ${payAmt.toLocaleString()}) exceeds ${emp.fullName}'s outstanding balance of UGX ${summary.outstandingBalance.toLocaleString()}.`,
        });
        return;
      }

      const payment = {
        id: makeId('CPAY'),
        reference: `CPAY-${Date.now().toString(36).toUpperCase()}`,
        employeeId: emp.id,
        employeeName: emp.fullName,
        amount: payAmt,
        paymentDate: paymentDate || todayIsoDate(),
        paymentMethod: paymentMethod || 'Cash',
        notes,
        paidById: req.sessionUser!.userId,
        paidByName: req.sessionUser!.name,
        createdAt: new Date().toISOString(),
      };
      db.commissionPayments.push(payment);

      // Update payment status flags cleanly on non-historical ledger rows using FIFO
      let remainingPaidBudget = getEmployeeCommissionSummary(db, employeeId).totalPaid;
      const empEntries = db.commissionLedger
        .filter((c) => c.employeeId === employeeId && !c.isHistorical && c.paymentStatus !== 'Reversed')
        .sort((a, b) => a.date.localeCompare(b.date));

      // Account for historical paid/unpaid first
      const historicalPaid = db.commissionLedger
        .filter((c) => c.employeeId === employeeId && c.isHistorical && c.paymentStatus === 'Paid')
        .reduce((s, c) => s + c.employeeCommission, 0);
      remainingPaidBudget = Math.max(0, remainingPaidBudget - historicalPaid);

      for (const entry of empEntries) {
        if (remainingPaidBudget >= entry.employeeCommission) {
          entry.paymentStatus = 'Paid';
          remainingPaidBudget -= entry.employeeCommission;
        } else if (remainingPaidBudget > 0) {
          entry.paymentStatus = 'Partially Paid';
          remainingPaidBudget = 0;
        } else {
          entry.paymentStatus = 'Unpaid';
        }
      }

      appendAuditLog(
        db,
        req.sessionUser!,
        'COMMISSION_PAYMENT_RECORDED',
        'CommissionPayment',
        payment.id,
        `Paid UGX ${payAmt.toLocaleString()} to ${emp.fullName} via ${payment.paymentMethod} (${payment.reference}).`
      );
      writeDb(db);
      res.status(201).json({ payment, newSummary: getEmployeeCommissionSummary(db, employeeId) });
    }
  );

  router.post(
    '/commission-adjustments',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { employeeId, date, amount, reason } = req.body as {
        employeeId: string;
        date?: string;
        amount: number;
        reason: string;
      };
      const emp = db.employees.find((e) => e.id === employeeId);
      if (!emp || !reason?.trim() || !amount) {
        res.status(400).json({ error: 'Employee, non-zero adjustment amount, and reason are required.' });
        return;
      }
      const adj: CommissionAdjustment = {
        id: makeId('CADJ'),
        employeeId: emp.id,
        employeeName: emp.fullName,
        date: date || todayIsoDate(),
        amount: Number(amount),
        reason: reason.trim(),
        approvedById: req.sessionUser!.userId,
        approvedByName: req.sessionUser!.name,
        createdAt: new Date().toISOString(),
      };
      db.commissionAdjustments.push(adj);
      appendAuditLog(
        db,
        req.sessionUser!,
        'COMMISSION_ADJUSTMENT',
        'CommissionAdjustment',
        adj.id,
        `Adjusted ${emp.fullName} commission by UGX ${adj.amount.toLocaleString()}: ${adj.reason}`
      );
      writeDb(db);
      res.status(201).json({ adjustment: adj });
    }
  );

  // ==================== EXPENSES ====================
  router.get(
    '/expenses',
    requireAuth,
    requireRole(['owner', 'manager']),
    (_req, res) => {
      const db = readDb();
      res.json({
        expenses: [...db.expenses].reverse(),
        categories: db.expenseCategories,
      });
    }
  );

  router.post(
    '/expenses',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { date, category, description, amount, paymentMethod, responsiblePerson, attachmentName } =
        req.body;
      if (!category || !description?.trim() || Number(amount) <= 0) {
        res.status(400).json({ error: 'Category, description, and positive amount are required.' });
        return;
      }
      const expense: ExpenseRecord = {
        id: makeId('EXP'),
        date: date || todayIsoDate(),
        category,
        description: description.trim(),
        amount: Number(amount),
        paymentMethod: paymentMethod || 'Cash',
        responsiblePerson: responsiblePerson || req.sessionUser!.name,
        status: req.sessionUser!.role === 'owner' ? 'Approved' : 'Pending',
        approvedBy: req.sessionUser!.role === 'owner' ? req.sessionUser!.name : undefined,
        attachmentName,
        isHistorical: false,
        createdBy: req.sessionUser!.name,
        createdAt: new Date().toISOString(),
      };
      db.expenses.push(expense);
      appendAuditLog(
        db,
        req.sessionUser!,
        'EXPENSE_RECORDED',
        'Expense',
        expense.id,
        `Recorded expense "${expense.description}" (${expense.category}) UGX ${expense.amount.toLocaleString()} [${expense.status}].`
      );
      writeDb(db);
      res.status(201).json({ expense });
    }
  );

  router.patch(
    '/expenses/:id',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const exp = db.expenses.find((e) => e.id === req.params.id);
      if (!exp) {
        res.status(404).json({ error: 'Expense record not found.' });
        return;
      }
      if (exp.isHistorical) {
        res.status(403).json({ error: 'Historical imported expenses cannot be modified.' });
        return;
      }
      if (req.body.status) {
        exp.status = req.body.status;
        exp.approvedBy = req.sessionUser!.name;
      }
      if (req.body.description) exp.description = req.body.description;
      if (typeof req.body.amount === 'number' && req.body.amount > 0) exp.amount = req.body.amount;

      appendAuditLog(
        db,
        req.sessionUser!,
        'EXPENSE_UPDATED',
        'Expense',
        exp.id,
        `Updated expense ${exp.id} status to ${exp.status}.`
      );
      writeDb(db);
      res.json({ expense: exp });
    }
  );

  // ==================== INVENTORY & STOCK MOVEMENTS ====================
  router.get('/inventory', requireAuth, (_req, res) => {
    const db = readDb();
    res.json({
      items: db.stockItems,
      movements: [...db.stockMovements].reverse(),
      suppliers: db.suppliers,
    });
  });

  router.post(
    '/inventory',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const b = req.body as Partial<StockItem>;
      if (!b.name?.trim() || !b.category?.trim()) {
        res.status(400).json({ error: 'Product name and category are required.' });
        return;
      }
      const openQty = Math.max(0, Number(b.openingQuantity) || 0);
      const item: StockItem = {
        id: makeId('STK'),
        sku: b.sku?.trim() || `TUS-${Date.now().toString(36).toUpperCase()}`,
        name: b.name.trim(),
        category: b.category.trim(),
        brand: b.brand?.trim() || 'Salon Stock',
        description: b.description,
        unit: b.unit || 'Unit',
        openingQuantity: openQty,
        currentQuantity: openQty,
        purchasePrice: Math.max(0, Number(b.purchasePrice) || 0),
        sellingPrice: Math.max(0, Number(b.sellingPrice) || 0),
        supplierId: b.supplierId,
        supplierName: db.suppliers.find((s) => s.id === b.supplierId)?.name || b.supplierName,
        minStockLevel: Math.max(0, Number(b.minStockLevel) || 3),
        expirationDate: b.expirationDate,
        isRetail: Boolean(b.isRetail),
        active: true,
      };
      db.stockItems.push(item);
      if (openQty > 0) {
        db.stockMovements.unshift({
          id: makeId('MOV'),
          stockItemId: item.id,
          stockItemName: item.name,
          date: todayIsoDate(),
          type: 'Opening Stock',
          quantityDelta: openQty,
          quantityAfter: openQty,
          unitCost: item.purchasePrice,
          notes: 'Initial stock registration',
          recordedBy: req.sessionUser!.name,
          createdAt: new Date().toISOString(),
        });
      }
      appendAuditLog(
        db,
        req.sessionUser!,
        'STOCK_ITEM_CREATED',
        'StockItem',
        item.id,
        `Added stock item ${item.name} (${openQty} ${item.unit}).`
      );
      writeDb(db);
      res.status(201).json({ item });
    }
  );

  router.post(
    '/stock-movements',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { stockItemId, type, quantity, unitCost, notes, referenceId } = req.body as {
        stockItemId: string;
        type: StockMovement['type'];
        quantity: number;
        unitCost?: number;
        notes?: string;
        referenceId?: string;
      };
      const item = db.stockItems.find((s) => s.id === stockItemId);
      if (!item) {
        res.status(404).json({ error: 'Stock item not found.' });
        return;
      }
      const qty = Number(quantity);
      if (!qty || qty === 0) {
        res.status(400).json({ error: 'Quantity must be non-zero.' });
        return;
      }

      const outboundTypes: StockMovement['type'][] = ['Retail Sale', 'Service Usage', 'Damaged', 'Expired'];
      const delta = outboundTypes.includes(type) ? -Math.abs(qty) : type === 'Adjustment' ? qty : Math.abs(qty);

      if (item.currentQuantity + delta < 0) {
        res.status(400).json({
          error: `Cannot reduce stock below 0. Available: ${item.currentQuantity} ${item.unit}.`,
        });
        return;
      }

      item.currentQuantity += delta;
      if (typeof unitCost === 'number' && unitCost >= 0 && type === 'Purchase') {
        item.purchasePrice = unitCost;
      }

      const movement: StockMovement = {
        id: makeId('MOV'),
        stockItemId: item.id,
        stockItemName: item.name,
        date: todayIsoDate(),
        type,
        quantityDelta: delta,
        quantityAfter: item.currentQuantity,
        unitCost,
        referenceId,
        notes,
        recordedBy: req.sessionUser!.name,
        createdAt: new Date().toISOString(),
      };
      db.stockMovements.unshift(movement);
      appendAuditLog(
        db,
        req.sessionUser!,
        'STOCK_MOVEMENT',
        'StockMovement',
        movement.id,
        `${type}: ${item.name} (${delta > 0 ? `+${delta}` : delta} ${item.unit}) -> Balance ${item.currentQuantity}.`
      );
      writeDb(db);
      res.status(201).json({ movement, item });
    }
  );

  router.post(
    '/suppliers',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { name, phone, email, address } = req.body;
      if (!name?.trim() || !phone?.trim()) {
        res.status(400).json({ error: 'Supplier name and phone are required.' });
        return;
      }
      const supplier = {
        id: makeId('SUP'),
        name: name.trim(),
        phone: phone.trim(),
        email,
        address,
      };
      db.suppliers.push(supplier);
      writeDb(db);
      res.status(201).json({ supplier });
    }
  );

  // ==================== GIFT CARDS ====================
  router.get('/gift-cards', requireAuth, (_req, res) => {
    const db = readDb();
    res.json({
      giftCards: [...db.giftCards].reverse(),
      transactions: [...db.giftCardTransactions].reverse(),
    });
  });

  router.get('/gift-cards/lookup/:code', requireAuth, (req, res) => {
    const db = readDb();
    const card = db.giftCards.find(
      (g) => g.code.toUpperCase() === req.params.code.trim().toUpperCase()
    );
    if (!card) {
      res.status(404).json({ error: 'Gift card code not found.' });
      return;
    }
    res.json({ giftCard: card });
  });

  router.post(
    '/gift-cards',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { customerId, initialValue, expirationDate, customCode } = req.body as {
        customerId?: string;
        initialValue: number;
        expirationDate?: string;
        customCode?: string;
      };
      const val = Number(initialValue);
      if (!val || val <= 0) {
        res.status(400).json({ error: 'Gift card value must be greater than zero.' });
        return;
      }
      const code =
        customCode?.trim().toUpperCase() ||
        `TUS-GC-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;

      if (db.giftCards.some((g) => g.code === code)) {
        res.status(409).json({ error: `Gift card code ${code} already exists.` });
        return;
      }

      const cust = customerId ? db.customers.find((c) => c.id === customerId) : undefined;
      const now = new Date().toISOString();
      const card: GiftCard = {
        id: makeId('GC'),
        code,
        customerId: cust?.id,
        customerName: cust?.fullName,
        initialValue: val,
        balance: val,
        issuedDate: todayIsoDate(),
        expirationDate,
        status: 'Active',
        issuedBy: req.sessionUser!.name,
      };
      db.giftCards.push(card);
      db.giftCardTransactions.unshift({
        id: makeId('GCT'),
        giftCardId: card.id,
        code: card.code,
        type: 'Purchase',
        amount: val,
        balanceAfter: val,
        createdAt: now,
        performedBy: req.sessionUser!.name,
      });
      appendAuditLog(
        db,
        req.sessionUser!,
        'GIFT_CARD_ISSUED',
        'GiftCard',
        card.id,
        `Issued Gift Card ${card.code} for UGX ${val.toLocaleString()}.`
      );
      writeDb(db);
      res.status(201).json({ giftCard: card });
    }
  );

  router.post(
    '/gift-cards/:id/cancel',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const card = db.giftCards.find((g) => g.id === req.params.id);
      if (!card) {
        res.status(404).json({ error: 'Gift card not found.' });
        return;
      }
      card.status = 'Cancelled';
      db.giftCardTransactions.unshift({
        id: makeId('GCT'),
        giftCardId: card.id,
        code: card.code,
        type: 'Cancellation',
        amount: card.balance,
        balanceAfter: 0,
        createdAt: new Date().toISOString(),
        performedBy: req.sessionUser!.name,
      });
      card.balance = 0;
      appendAuditLog(
        db,
        req.sessionUser!,
        'GIFT_CARD_CANCELLED',
        'GiftCard',
        card.id,
        `Cancelled Gift Card ${card.code}.`
      );
      writeDb(db);
      res.json({ giftCard: card });
    }
  );

  // ==================== REPORTS ====================
  router.get(
    '/reports',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const startDate = (req.query.startDate as string) || '2020-01-01';
      const endDate = (req.query.endDate as string) || todayIsoDate();
      const employeeFilter = req.query.employeeId as string | undefined;

      const txs = db.posTransactions.filter(
        (t) =>
          t.date >= startDate &&
          t.date <= endDate &&
          t.status !== 'Reversed' &&
          t.status !== 'Refunded' &&
          (!employeeFilter || t.items.some((i) => i.employeeId === employeeFilter))
      );

      let serviceRevenue = 0;
      let retailRevenue = 0;
      const byPaymentMethod: Record<string, number> = {};
      const byCashier: Record<string, { count: number; total: number }> = {};

      for (const tx of txs) {
        for (const item of tx.items) {
          if (item.itemType === 'service') serviceRevenue += item.lineTotal;
          else retailRevenue += item.lineTotal;
        }
        for (const p of tx.payments) {
          byPaymentMethod[p.method] = (byPaymentMethod[p.method] || 0) + p.amount;
        }
        if (!byCashier[tx.cashierName]) byCashier[tx.cashierName] = { count: 0, total: 0 };
        byCashier[tx.cashierName].count += 1;
        byCashier[tx.cashierName].total += tx.totalAmount;
      }

      const ledger = db.commissionLedger.filter(
        (c) =>
          c.date >= startDate &&
          c.date <= endDate &&
          c.paymentStatus !== 'Reversed' &&
          (!employeeFilter || c.employeeId === employeeFilter)
      );
      const lunches = db.lunchDeductions.filter(
        (l) =>
          l.date >= startDate &&
          l.date <= endDate &&
          (!employeeFilter || l.employeeId === employeeFilter)
      );
      const expenses = db.expenses.filter(
        (e) => e.date >= startDate && e.date <= endDate && e.status !== 'Rejected'
      );

      const totalBilledSales = txs.reduce((s, t) => s + t.totalAmount, 0);
      const totalCollectedPayments = txs.reduce((s, t) => s + t.amountPaid, 0);
      const totalEmployeeCommissions = ledger.reduce((s, c) => s + c.employeeCommission, 0);
      const totalLunchDeducted = lunches.reduce((s, l) => s + l.amount, 0);
      const totalSalonShare = ledger.reduce((s, c) => s + c.salonShare, 0);
      const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
      const retailCostOfGoods = txs.reduce((sum, tx) => {
        return (
          sum +
          tx.items
            .filter((i) => i.itemType === 'product')
            .reduce((s, i) => {
              const stk = db.stockItems.find((k) => k.id === i.refId);
              return s + (stk ? stk.purchasePrice * i.quantity : 0);
            }, 0)
        );
      }, 0);

      // Actual profit clearly distinguishes salon share vs expenses and retail COGS
      const netProfit = totalSalonShare + (retailRevenue - retailCostOfGoods) - totalExpenses;

      const appointmentsInPeriod = db.appointments.filter(
        (a) => a.date >= startDate && a.date <= endDate
      );

      const inventoryValuation = db.stockItems.reduce(
        (s, item) => s + item.currentQuantity * item.purchasePrice,
        0
      );

      res.json({
        period: { startDate, endDate },
        salesSummary: {
          transactionCount: txs.length,
          totalBilledSales,
          totalCollectedPayments,
          outstandingCustomerBalances: txs.reduce((s, t) => s + t.balanceDue, 0),
          serviceRevenue,
          retailRevenue,
          byPaymentMethod,
          byCashier,
        },
        financialPnL: {
          serviceRevenue,
          retailRevenue,
          totalRevenue: totalBilledSales,
          totalLunchDeducted,
          totalEmployeeCommissions,
          salonShareFromServices: totalSalonShare,
          retailCostOfGoods,
          totalExpenses,
          actualNetProfit: netProfit,
          giftCardLiability: db.giftCards
            .filter((g) => g.status === 'Active')
            .reduce((s, g) => s + g.balance, 0),
        },
        employeeReport: db.employees.map((emp) => ({
          employeeId: emp.id,
          fullName: emp.fullName,
          periodServices: ledger.filter((c) => c.employeeId === emp.id).length,
          periodGross: ledger
            .filter((c) => c.employeeId === emp.id)
            .reduce((s, c) => s + c.grossEarnings, 0),
          periodLunch: lunches
            .filter((l) => l.employeeId === emp.id)
            .reduce((s, l) => s + l.amount, 0),
          periodCommission: ledger
            .filter((c) => c.employeeId === emp.id)
            .reduce((s, c) => s + c.employeeCommission, 0),
          ...getEmployeeCommissionSummary(db, emp.id),
        })),
        appointmentReport: {
          total: appointmentsInPeriod.length,
          completed: appointmentsInPeriod.filter((a) => a.status === 'Completed').length,
          cancelled: appointmentsInPeriod.filter((a) => a.status === 'Cancelled').length,
          noShow: appointmentsInPeriod.filter((a) => a.status === 'No Show').length,
          walkIns: db.walkIns.filter(
            (w) => w.arrivalTime.slice(0, 10) >= startDate && w.arrivalTime.slice(0, 10) <= endDate
          ).length,
        },
        customerReport: {
          totalCustomers: db.customers.length,
          returningCustomers: db.customers.filter((c) => c.totalVisits >= 2).length,
          topCustomers: [...db.customers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10),
        },
        inventoryReport: {
          totalSkus: db.stockItems.length,
          inventoryCostValuation: inventoryValuation,
          lowStockItems: db.stockItems.filter((s) => s.currentQuantity <= s.minStockLevel),
          movementsCount: db.stockMovements.filter((m) => m.date >= startDate && m.date <= endDate).length,
        },
        transactions: txs,
        expenses,
        ledger,
      });
    }
  );

  // ==================== HISTORICAL EXCEL MIGRATION & SAMPLE TOOLS ====================
  router.post(
    '/migration/import',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { fileName, sheets, approvedByOwner } = req.body as {
        fileName: string;
        sheets: Record<string, Record<string, unknown>[]>;
        approvedByOwner: boolean;
      };

      if (!approvedByOwner) {
        res.status(400).json({ error: 'Explicit owner approval is required before executing data migration.' });
        return;
      }
      if (!fileName || !sheets || typeof sheets !== 'object') {
        res.status(400).json({ error: 'Workbook fileName and parsed sheet records are required.' });
        return;
      }

      // Preserve an automatic pre-migration backup snapshot
      const backupId = createBackupSnapshot(
        db,
        `Pre-Migration Backup before ${fileName}`,
        req.sessionUser!.name
      );

      let importedCount = 0;
      const importedSheetNames: string[] = [];

      for (const [sheetName, rows] of Object.entries(sheets)) {
        if (!Array.isArray(rows) || rows.length === 0) continue;
        importedSheetNames.push(sheetName);
        const lower = sheetName.toLowerCase();

        if (lower.includes('customer')) {
          for (const r of rows) {
            const name = String(r['Full Name'] || r['Customer'] || r['Name'] || '').trim();
            const phone = String(r['Phone'] || r['Phone Number'] || '').trim();
            if (!name) continue;
            if (!db.customers.some((c) => c.fullName.toLowerCase() === name.toLowerCase() && c.phone === phone)) {
              db.customers.push({
                id: makeId('CUST-HIST'),
                fullName: name,
                phone: phone || 'N/A',
                email: String(r['Email'] || ''),
                registrationDate: String(r['Date'] || todayIsoDate()).slice(0, 10),
                loyaltyPoints: Number(r['Points'] || 0),
                loyaltyTier: 'Bronze',
                totalVisits: Number(r['Visits'] || 1),
                totalSpent: Number(r['Total Spent'] || 0),
                notes: 'Imported from historical Excel workbook',
              });
              importedCount++;
            }
          }
        } else if (lower.includes('expense')) {
          for (const r of rows) {
            const amount = Number(r['Amount'] || r['Amount (UGX)'] || r['Total'] || 0);
            const desc = String(r['Description'] || r['Item'] || r['Expense'] || '').trim();
            if (amount <= 0 || !desc) continue;
            db.expenses.push({
              id: makeId('EXP-HIST'),
              date: String(r['Date'] || todayIsoDate()).slice(0, 10),
              category: String(r['Category'] || 'Other expenses'),
              description: desc,
              amount,
              paymentMethod: (String(r['Payment Method'] || 'Cash') as PaymentMethod),
              responsiblePerson: String(r['Responsible'] || r['Recorded By'] || 'Historical Import'),
              status: 'Approved',
              approvedBy: 'Historical Record',
              isHistorical: true,
              createdBy: req.sessionUser!.name,
              createdAt: new Date().toISOString(),
            });
            importedCount++;
          }
        } else if (lower.includes('commission')) {
          for (const r of rows) {
            const empName = String(r['Employee'] || r['Stylist'] || '').trim();
            const gross = Number(r['Gross'] || r['Gross Earnings'] || r['Amount'] || 0);
            const comm = Number(r['Commission'] || r['Employee Commission'] || 0);
            if (!empName || gross <= 0) continue;
            const emp = db.employees.find((e) => e.fullName.toLowerCase() === empName.toLowerCase());
            const lunch = Number(r['Lunch'] || r['Lunch Deduction'] || 0);
            const net = Number(r['Net'] || Math.max(0, gross - lunch));
            const salonShare = Number(r['Salon Share'] || Math.max(0, net - comm));
            db.commissionLedger.push({
              id: makeId('COM-HIST'),
              transactionId: makeId('TX-HIST'),
              transactionReference: String(r['Reference'] || `HIST-${importedCount + 1}`),
              date: String(r['Date'] || todayIsoDate()).slice(0, 10),
              employeeId: emp?.id || 'HISTORICAL',
              employeeName: empName,
              serviceName: String(r['Service'] || 'Historical Service'),
              serviceCategory: String(r['Category'] || 'Historical'),
              grossEarnings: gross,
              lunchAllocation: lunch,
              netCommissionableEarnings: net,
              commissionRate: Number(r['Rate'] || (net > 0 ? comm / net : 0)),
              employeeCommission: comm,
              salonShare,
              paymentStatus: (String(r['Status'] || 'Paid') as 'Paid' | 'Unpaid'),
              isHistorical: true,
              createdAt: new Date().toISOString(),
            });
            importedCount++;
          }
        } else if (lower.includes('stock') || lower.includes('inventory')) {
          for (const r of rows) {
            const name = String(r['Product Name'] || r['Item'] || r['Name'] || '').trim();
            if (!name) continue;
            const qty = Number(r['Quantity'] || r['Current Quantity'] || 0);
            db.stockItems.push({
              id: makeId('STK-HIST'),
              sku: String(r['SKU'] || r['Stock ID'] || makeId('SKU')),
              name,
              category: String(r['Category'] || 'Hair products'),
              brand: String(r['Brand'] || 'Salon Stock'),
              unit: String(r['Unit'] || 'Unit'),
              openingQuantity: qty,
              currentQuantity: qty,
              purchasePrice: Number(r['Purchase Price'] || r['Cost'] || 0),
              sellingPrice: Number(r['Selling Price'] || r['Price'] || 0),
              minStockLevel: Number(r['Min Stock'] || 3),
              isRetail: Boolean(Number(r['Selling Price'] || 0) > 0),
              active: true,
            });
            importedCount++;
          }
        } else if (lower.includes('sale') || lower.includes('transaction') || lower.includes('income')) {
          for (const r of rows) {
            const total = Number(r['Total'] || r['Amount'] || r['Sales'] || 0);
            if (total <= 0) continue;
            const txDate = String(r['Date'] || todayIsoDate()).slice(0, 10);
            const ref = String(r['Reference'] || `HIST-SALE-${Date.now()}-${importedCount}`);
            if (db.posTransactions.some((t) => t.reference === ref)) continue;
            const srvName = String(r['Service'] || r['Description'] || 'Historical Service');
            const empName = String(r['Employee'] || r['Stylist'] || '');
            const emp = db.employees.find((e) => e.fullName.toLowerCase() === empName.toLowerCase());
            db.posTransactions.push({
              id: makeId('TX-HIST'),
              reference: ref,
              date: txDate,
              createdAt: new Date().toISOString(),
              customerName: String(r['Customer'] || 'Historical Customer'),
              cashierId: req.sessionUser!.userId,
              cashierName: String(r['Cashier'] || 'Historical Import'),
              items: [
                {
                  id: makeId('ITEM'),
                  itemType: 'service',
                  refId: 'HIST',
                  name: srvName,
                  categoryName: String(r['Category'] || 'Hair Styling'),
                  employeeId: emp?.id,
                  employeeName: empName || undefined,
                  quantity: 1,
                  unitPrice: total,
                  discount: 0,
                  lineTotal: total,
                },
              ],
              subtotal: total,
              discountTotal: 0,
              taxAmount: 0,
              tipAmount: 0,
              totalAmount: total,
              amountPaid: total,
              balanceDue: 0,
              payments: [
                {
                  id: makeId('PAY-HIST'),
                  transactionId: ref,
                  method: (String(r['Payment Method'] || 'Cash') as PaymentMethod),
                  amount: total,
                  paidAt: new Date().toISOString(),
                  recordedBy: 'Historical Import',
                },
              ],
              status: 'Completed',
              isHistorical: true,
              notes: `Imported intact from ${fileName} (${sheetName})`,
            });
            importedCount++;
          }
        }
      }

      db.migrationLogs.unshift({
        id: makeId('MIG'),
        fileName,
        migratedAt: new Date().toISOString(),
        migratedBy: req.sessionUser!.name,
        backupId,
        sheetsImported: importedSheetNames,
        recordsImported: importedCount,
        notes: 'Historical records preserved with isHistorical=true; new commission & lunch policy untouched for past dates.',
      });

      appendAuditLog(
        db,
        req.sessionUser!,
        'HISTORICAL_DATA_MIGRATED',
        'DataMigrationLog',
        backupId,
        `Imported ${importedCount} historical records from ${fileName} (${importedSheetNames.join(', ')}). Pre-migration backup: ${backupId}.`
      );
      writeDb(db);
      res.json({ ok: true, backupId, importedCount, sheetsImported: importedSheetNames });
    }
  );

  // Explicit testing/evaluation sample day loader (never auto-loaded in production)
  router.post(
    '/system/load-sample-day',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      if (db.posTransactions.length > 0) {
        res.status(400).json({ error: 'Database already contains transactions. Clear or continue with existing records.' });
        return;
      }

      const today = todayIsoDate();
      const now = new Date().toISOString();

      // Add 3 evaluation customers
      const cust1: Customer = {
        id: 'CUST-DEMO-01',
        fullName: 'Amina Namuli',
        phone: '+256 774 221 908',
        email: 'amina.n@example.ug',
        gender: 'Female',
        registrationDate: today,
        preferredStylistId: 'EMP-001',
        preferences: 'Medium knotless braids, warm water wash',
        loyaltyPoints: 100,
        loyaltyTier: 'Silver',
        totalVisits: 2,
        totalSpent: 100000,
        lastVisitDate: today,
      };
      const cust2: Customer = {
        id: 'CUST-DEMO-02',
        fullName: 'Ronald Ochieng',
        phone: '+256 703 551 402',
        gender: 'Male',
        registrationDate: today,
        preferredStylistId: 'EMP-002',
        preferences: 'Low skin fade with razor line-up',
        loyaltyPoints: 40,
        loyaltyTier: 'Bronze',
        totalVisits: 1,
        totalSpent: 40000,
        lastVisitDate: today,
      };
      db.customers.push(cust1, cust2);

      // Transaction 1: Confirmed UGX 100,000 example (e.g. 2x Gel Manicure & Pedicure @ 50,000 = 100,000 -> 40% category)
      // Wait: let's demonstrate BOTH Plaiting 50% and 40% standard rule cleanly!
      // Let's give Kevin (EMP-002) UGX 100,000 in 40% services so his daily summary matches Section 3.2 EXACTLY:
      // Gross = 100,000, Lunch = 2,500, Net = 97,500, Commission 40% = 39,000, Salon Share = 58,500!
      const tx1: POSTransaction = {
        id: 'TX-DEMO-01',
        reference: `TUS-${today.replace(/-/g, '')}-1001`,
        date: today,
        createdAt: now,
        customerId: cust2.id,
        customerName: cust2.fullName,
        cashierId: req.sessionUser!.userId,
        cashierName: req.sessionUser!.name,
        items: [
          {
            id: 'ITEM-DEMO-1',
            itemType: 'service',
            refId: 'SRV-012',
            name: 'Dreadlocks Retwist & Style',
            categoryName: 'Dreadlocks',
            employeeId: 'EMP-002',
            employeeName: 'Kevin Mugisha',
            quantity: 2,
            unitPrice: 40000,
            discount: 0,
            lineTotal: 80000,
            commissionRateApplied: 0.4,
          },
          {
            id: 'ITEM-DEMO-2',
            itemType: 'service',
            refId: 'SRV-006',
            name: 'Beard Sculpt & Hot Towel Shave',
            categoryName: 'Beard Trimming',
            employeeId: 'EMP-002',
            employeeName: 'Kevin Mugisha',
            quantity: 2,
            unitPrice: 10000,
            discount: 0,
            lineTotal: 20000,
            commissionRateApplied: 0.4,
          },
        ],
        subtotal: 100000,
        discountTotal: 0,
        taxAmount: 0,
        tipAmount: 0,
        totalAmount: 100000,
        amountPaid: 100000,
        balanceDue: 0,
        payments: [
          {
            id: 'PAY-DEMO-1',
            transactionId: 'TX-DEMO-01',
            method: 'Mobile Money',
            amount: 60000,
            reference: 'MTN-882104',
            paidAt: now,
            recordedBy: req.sessionUser!.name,
          },
          {
            id: 'PAY-DEMO-2',
            transactionId: 'TX-DEMO-01',
            method: 'Cash',
            amount: 40000,
            paidAt: now,
            recordedBy: req.sessionUser!.name,
          },
        ],
        status: 'Completed',
        isHistorical: false,
      };

      // Transaction 2: Mixed commission rates on same day for Beatrice (Plaiting 50% + Blow Dry 30%)
      const tx2: POSTransaction = {
        id: 'TX-DEMO-02',
        reference: `TUS-${today.replace(/-/g, '')}-1002`,
        date: today,
        createdAt: now,
        customerId: cust1.id,
        customerName: cust1.fullName,
        cashierId: req.sessionUser!.userId,
        cashierName: req.sessionUser!.name,
        items: [
          {
            id: 'ITEM-DEMO-3',
            itemType: 'service',
            refId: 'SRV-001',
            name: 'Knotless Plaiting (Medium)',
            categoryName: 'Hair Plaiting',
            employeeId: 'EMP-001',
            employeeName: 'Beatrice Okello',
            quantity: 1,
            unitPrice: 65000,
            discount: 0,
            lineTotal: 65000,
            commissionRateApplied: 0.5,
          },
          {
            id: 'ITEM-DEMO-4',
            itemType: 'service',
            refId: 'SRV-003',
            name: 'Wash & Blow Dry',
            categoryName: 'Blow Dry',
            employeeId: 'EMP-001',
            employeeName: 'Beatrice Okello',
            quantity: 1,
            unitPrice: 25000,
            discount: 0,
            lineTotal: 25000,
            commissionRateApplied: 0.3,
          },
          {
            id: 'ITEM-DEMO-5',
            itemType: 'product',
            refId: 'STK-001',
            name: 'XPression Ultra Braid Pack',
            categoryName: 'Hair products',
            quantity: 2,
            unitPrice: 15000,
            discount: 0,
            lineTotal: 30000,
          },
        ],
        subtotal: 120000,
        discountTotal: 0,
        taxAmount: 0,
        tipAmount: 5000,
        tipEmployeeId: 'EMP-001',
        totalAmount: 125000,
        amountPaid: 125000,
        balanceDue: 0,
        payments: [
          {
            id: 'PAY-DEMO-3',
            transactionId: 'TX-DEMO-02',
            method: 'Cash',
            amount: 125000,
            paidAt: now,
            recordedBy: req.sessionUser!.name,
          },
        ],
        status: 'Completed',
        isHistorical: false,
      };

      db.posTransactions.push(tx1, tx2);
      db.tips.push({
        id: 'TIP-DEMO-01',
        transactionId: tx2.id,
        date: today,
        employeeId: 'EMP-001',
        employeeName: 'Beatrice Okello',
        amount: 5000,
        distributionMode: 'direct_to_employee',
        createdAt: now,
      });

      const xpr = db.stockItems.find((s) => s.id === 'STK-001');
      if (xpr) {
        xpr.currentQuantity -= 2;
        db.stockMovements.unshift({
          id: 'MOV-DEMO-01',
          stockItemId: xpr.id,
          stockItemName: xpr.name,
          date: today,
          type: 'Retail Sale',
          quantityDelta: -2,
          quantityAfter: xpr.currentQuantity,
          referenceId: tx2.reference,
          recordedBy: req.sessionUser!.name,
          createdAt: now,
        });
      }

      recomputeEmployeeDailyCommission(db, 'EMP-002', today);
      recomputeEmployeeDailyCommission(db, 'EMP-001', today);

      db.expenses.push({
        id: 'EXP-DEMO-01',
        date: today,
        category: 'Electricity',
        description: 'UMEME Yaka prepaid electricity units',
        amount: 35000,
        paymentMethod: 'Mobile Money',
        responsiblePerson: req.sessionUser!.name,
        status: 'Approved',
        approvedBy: req.sessionUser!.name,
        createdBy: req.sessionUser!.name,
        createdAt: now,
      });

      db.appointments.push({
        id: 'APT-DEMO-01',
        customerId: cust1.id,
        customerName: cust1.fullName,
        customerPhone: cust1.phone,
        employeeId: 'EMP-003',
        employeeName: 'Fadhila Nantongo',
        serviceIds: ['SRV-008'],
        serviceNames: ['Lace Frontal Wig Installation'],
        date: today,
        startTime: '14:30',
        durationMinutes: 90,
        status: 'Confirmed',
        source: 'Scheduled',
        createdAt: now,
        updatedAt: now,
      });

      appendAuditLog(
        db,
        req.sessionUser!,
        'SAMPLE_DAY_LOADED',
        'SalonDatabase',
        'DEMO',
        'Loaded evaluation sample transactions (including UGX 100,000 confirmed commission test & mixed-rate plaiting/blow-dry test).'
      );
      writeDb(db);
      res.json({ ok: true });
    }
  );

  router.post(
    '/system/reset-clean',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const current = readDb();
      createBackupSnapshot(current, 'Backup Before Production Clean Reset', req.sessionUser!.name);
      const fresh: SalonDatabase = createInitialDatabase();
      // Keep user accounts & settings
      fresh.users = current.users;
      fresh.settings = current.settings;
      fresh.backups = current.backups;
      appendAuditLog(
        fresh,
        req.sessionUser!,
        'DATABASE_RESET_CLEAN',
        'SalonDatabase',
        'RESET',
        'Reset transactional records to clean production state (users & settings preserved).'
      );
      writeDb(fresh);
      res.json({ ok: true });
    }
  );

  // ==================== GOOGLE WORKSPACE (SHEETS & DRIVE) ====================
  router.post(
    '/workspace/sheets/create',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      if (!token) {
        res.status(401).json({ error: 'Please click "Connect Google Workspace" first to authorize Google Sheets.' });
        return;
      }
      try {
        const db = readDb();
        const result = await createSalonGoogleSpreadsheet(token, db);
        db.settings.googleSpreadsheetId = result.spreadsheetId;
        db.settings.googleSpreadsheetUrl = result.spreadsheetUrl;
        db.settings.lastSheetsSyncAt = new Date().toISOString();
        appendAuditLog(
          db,
          req.sessionUser!,
          'GOOGLE_SHEET_CREATED',
          'Settings',
          result.spreadsheetId,
          `Created & populated Google Sheet database (${result.sheetCount} tabs).`
        );
        writeDb(db);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Google Sheets creation failed.' });
      }
    }
  );

  router.post(
    '/workspace/sheets/sync',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      const db = readDb();
      const spreadsheetId = (req.body.spreadsheetId as string) || db.settings.googleSpreadsheetId;
      if (!token) {
        res.status(401).json({ error: 'Google Workspace token missing. Sign in with Google first.' });
        return;
      }
      if (!spreadsheetId) {
        res.status(400).json({ error: 'No Google Spreadsheet ID linked yet. Create or link a Spreadsheet first.' });
        return;
      }
      try {
        const result = await syncDatabaseToGoogleSheet(token, spreadsheetId, db);
        db.settings.googleSpreadsheetId = spreadsheetId;
        db.settings.lastSheetsSyncAt = new Date().toISOString();
        appendAuditLog(
          db,
          req.sessionUser!,
          'GOOGLE_SHEETS_SYNCED',
          'Settings',
          spreadsheetId,
          `Synced ${result.updatedCells} cells across ${result.sheetTabs.length} tabs.`
        );
        writeDb(db);
        res.json({ ...result, lastSheetsSyncAt: db.settings.lastSheetsSyncAt });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Google Sheets sync failed.' });
      }
    }
  );

  router.get('/workspace/sheets/read', requireAuth, async (req: AuthenticatedRequest, res) => {
    const token = req.headers['x-google-token']?.toString();
    const db = readDb();
    const spreadsheetId = (req.query.spreadsheetId as string) || db.settings.googleSpreadsheetId;
    const tab = req.query.tab as string | undefined;
    if (!token || !spreadsheetId) {
      res.status(400).json({ error: 'Google token and linked Spreadsheet ID are required.' });
      return;
    }
    try {
      const data = await readGoogleSheetTab(token, spreadsheetId, tab);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read Google Sheet.' });
    }
  });

  router.post(
    '/workspace/drive/backup',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      if (!token) {
        res.status(401).json({ error: 'Google Workspace token missing. Sign in with Google first.' });
        return;
      }
      try {
        const db = readDb();
        const label = (req.body.label as string) || 'Manual Cloud Backup';
        const file = await backupDatabaseToGoogleDrive(token, db, label);
        db.settings.googleDriveFolderId = file.rootFolderId;
        const backupId = createBackupSnapshot(db, `${label} (Drive: ${file.name})`, req.sessionUser!.name);
        const bkp = db.backups.find((b) => b.id === backupId);
        if (bkp) bkp.driveFileId = file.id;
        db.driveDocuments.unshift({
          id: makeId('DRV'),
          driveFileId: file.id,
          name: file.name,
          category: 'Backup',
          mimeType: 'application/json',
          webViewLink: file.webViewLink,
          folderName: 'Backups & Exports',
          notes: label,
          uploadedBy: req.sessionUser!.name,
          uploadedAt: new Date().toISOString(),
        });
        appendAuditLog(
          db,
          req.sessionUser!,
          'GOOGLE_DRIVE_BACKUP',
          'SystemBackup',
          backupId,
          `Uploaded backup ${file.name} to Google Drive.`
        );
        writeDb(db);
        res.json({ file, backupId, driveFolderId: file.rootFolderId });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Google Drive backup failed.' });
      }
    }
  );

  router.get('/workspace/drive/files', requireAuth, async (req, res) => {
    const token = req.headers['x-google-token']?.toString();
    if (!token) {
      res.status(401).json({ error: 'Google Workspace token missing.' });
      return;
    }
    try {
      const list = await listAppDriveFiles(token);
      res.json(list);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list Drive files.' });
    }
  });

  const ALLOWED_DRIVE_UPLOAD_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]);

  const VALID_DRIVE_CATEGORIES: DriveDocumentCategory[] = [
    'Employee Photo',
    'National ID',
    'Trading Licence',
    'Expense Receipt',
    'Staff Contract',
    'Salon Media',
    'Supplier Invoice',
    'Backup',
    'Other',
  ];

  router.get('/workspace/drive/documents', requireAuth, async (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    let documents = [...db.driveDocuments];
    if (user.role === 'employee') {
      documents = documents.filter(
        (d) =>
          d.relatedEmployeeId === user.employeeId &&
          (d.category === 'Employee Photo' || d.category === 'National ID' || d.category === 'Staff Contract')
      );
    }

    let driveFiles: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      size?: string;
      webViewLink?: string;
    }> = [];
    const token = req.headers['x-google-token']?.toString();
    if (token && ['owner', 'manager'].includes(user.role)) {
      try {
        const listed = await listAppDriveFiles(token);
        driveFiles = listed.files;
      } catch {
        // Return stored vault catalog even if Drive listing fails temporarily
      }
    }

    res.json({
      documents,
      googleDriveFolderId: db.settings.googleDriveFolderId || '',
      driveFiles,
    });
  });

  router.post(
    '/workspace/drive/upload',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      if (!token) {
        res.status(401).json({
          error: 'Google Workspace is not connected. Please click "Connect Google Workspace" first.',
        });
        return;
      }

      const { fileName, dataUrl, category, relatedEmployeeId, notes } = req.body as {
        fileName?: string;
        dataUrl?: string;
        category?: DriveDocumentCategory;
        relatedEmployeeId?: string;
        notes?: string;
      };

      const safeCategory: DriveDocumentCategory =
        category && VALID_DRIVE_CATEGORIES.includes(category) ? category : 'Other';

      if (
        ['National ID', 'Staff Contract', 'Trading Licence', 'Backup'].includes(safeCategory) &&
        !['owner', 'manager'].includes(req.sessionUser!.role)
      ) {
        res.status(403).json({
          error:
            'Only Owners and Managers can upload confidential HR National IDs, Contracts, Trading Licences, or Backups.',
        });
        return;
      }

      if (!fileName?.trim() || !dataUrl?.trim()) {
        res.status(400).json({ error: 'File name and file content (dataUrl) are required.' });
        return;
      }

      let parsed: { mimeType: string; buffer: Buffer };
      try {
        parsed = parseDataUrl(dataUrl);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid file payload.' });
        return;
      }

      if (!ALLOWED_DRIVE_UPLOAD_MIMES.has(parsed.mimeType)) {
        res.status(400).json({
          error: `Unsupported file type "${parsed.mimeType}". Allowed: PNG, JPG, WebP, PDF, Word, Excel, CSV, TXT.`,
        });
        return;
      }

      if (parsed.buffer.length > 5 * 1024 * 1024) {
        res.status(400).json({ error: 'File exceeds the 5 MB upload limit.' });
        return;
      }

      try {
        const db = readDb();
        const { rootFolderId, folderId, folderName } = await ensureCategoryDriveFolder(
          token,
          safeCategory,
          db.settings.googleDriveFolderId
        );
        db.settings.googleDriveFolderId = rootFolderId;

        const cleanName = fileName.trim().replace(/[\\/]/g, '_');
        const uploaded = await uploadBinaryToGoogleDrive(token, {
          fileName: cleanName,
          mimeType: parsed.mimeType,
          buffer: parsed.buffer,
          folderId,
          description: `${safeCategory}${notes ? ` — ${notes.trim()}` : ''} (Trendy Unisex Salon)`,
        });

        const relatedEmp = relatedEmployeeId
          ? db.employees.find((e) => e.id === relatedEmployeeId)
          : undefined;

        const record: DriveDocumentRecord = {
          id: makeId('DRV'),
          driveFileId: uploaded.id,
          name: uploaded.name,
          category: safeCategory,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          webViewLink: uploaded.webViewLink,
          folderName,
          relatedEmployeeId: relatedEmp?.id,
          relatedEmployeeName: relatedEmp?.fullName,
          notes: notes?.trim() || undefined,
          uploadedBy: req.sessionUser!.name,
          uploadedAt: new Date().toISOString(),
        };

        db.driveDocuments.unshift(record);
        if (relatedEmp && ['National ID', 'Employee Photo', 'Staff Contract'].includes(safeCategory)) {
          relatedEmp.lastDocumentUpdatedAt = new Date().toISOString();
          relatedEmp.lastDocumentUpdatedBy = req.sessionUser!.name;
        }
        appendAuditLog(
          db,
          req.sessionUser!,
          'DRIVE_DOCUMENT_UPLOADED',
          'DriveDocument',
          record.id,
          `Uploaded ${record.name} (${record.category}) to Google Drive folder "${folderName}".`
        );
        writeDb(db);
        res.status(201).json({ document: record, driveFolderId: rootFolderId });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Google Drive upload failed.',
        });
      }
    }
  );

  router.post(
    '/workspace/drive/sync-employee-media',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      if (!token) {
        res.status(401).json({
          error: 'Google Workspace is not connected. Please click "Connect Google Workspace" first.',
        });
        return;
      }

      const db = readDb();
      let syncedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      for (const emp of db.employees) {
        if (emp.avatarUrl?.startsWith('data:') && !emp.avatarDriveFileId) {
          try {
            const up = await uploadEmployeeDataUrlToDrive(
              token,
              db,
              emp,
              'avatar',
              emp.avatarUrl,
              req.sessionUser!.name
            );
            emp.avatarDriveFileId = up.fileId;
            emp.avatarDriveLink = up.webViewLink;
            syncedCount++;
          } catch (err) {
            errors.push(`${emp.fullName} Photo: ${err instanceof Error ? err.message : 'Failed'}`);
          }
        } else if (emp.avatarDriveFileId) {
          skippedCount++;
        }

        if (emp.nationalIdDocumentUrl?.startsWith('data:') && !emp.nationalIdFrontDriveFileId) {
          try {
            const up = await uploadEmployeeDataUrlToDrive(
              token,
              db,
              emp,
              'id_front',
              emp.nationalIdDocumentUrl,
              req.sessionUser!.name
            );
            emp.nationalIdFrontDriveFileId = up.fileId;
            emp.nationalIdFrontDriveLink = up.webViewLink;
            syncedCount++;
          } catch (err) {
            errors.push(`${emp.fullName} ID Front: ${err instanceof Error ? err.message : 'Failed'}`);
          }
        } else if (emp.nationalIdFrontDriveFileId) {
          skippedCount++;
        }

        if (emp.nationalIdBackUrl?.startsWith('data:') && !emp.nationalIdBackDriveFileId) {
          try {
            const up = await uploadEmployeeDataUrlToDrive(
              token,
              db,
              emp,
              'id_back',
              emp.nationalIdBackUrl,
              req.sessionUser!.name
            );
            emp.nationalIdBackDriveFileId = up.fileId;
            emp.nationalIdBackDriveLink = up.webViewLink;
            syncedCount++;
          } catch (err) {
            errors.push(`${emp.fullName} ID Back: ${err instanceof Error ? err.message : 'Failed'}`);
          }
        } else if (emp.nationalIdBackDriveFileId) {
          skippedCount++;
        }
      }

      if (syncedCount > 0) {
        appendAuditLog(
          db,
          req.sessionUser!,
          'DRIVE_STAFF_MEDIA_SYNCED',
          'DriveDocument',
          db.settings.googleDriveFolderId || 'DRIVE',
          `Synced ${syncedCount} staff profile photo(s) / National ID document(s) to Google Drive.`
        );
        writeDb(db);
      }

      res.json({
        syncedCount,
        skippedCount,
        errors,
        driveFolderId: db.settings.googleDriveFolderId || '',
      });
    }
  );

  async function uploadSalonAssetToDrive(
    token: string,
    db: SalonDatabase,
    kind: 'logo' | 'trading_licence',
    dataUrl: string,
    uploadedBy: string
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const { mimeType, buffer } = parseDataUrl(dataUrl);
    const category: DriveDocumentCategory = kind === 'logo' ? 'Salon Media' : 'Trading Licence';
    const { rootFolderId, folderId, folderName } = await ensureCategoryDriveFolder(
      token,
      category,
      db.settings.googleDriveFolderId
    );
    db.settings.googleDriveFolderId = rootFolderId;

    const ext = fileExtensionFromMime(mimeType);
    const fileName =
      kind === 'logo'
        ? `Trendy_Unisex_Salon_Logo.${ext}`
        : `Trendy_Unisex_Salon_Trading_Licence${db.settings.tradingLicenceNumber ? `_${db.settings.tradingLicenceNumber.replace(/[^a-zA-Z0-9_-]+/g, '_')}` : ''}.${ext}`;

    const uploaded = await uploadBinaryToGoogleDrive(token, {
      fileName,
      mimeType,
      buffer,
      folderId,
      description:
        kind === 'logo'
          ? 'Official Trendy Unisex Salon Logo'
          : `Official Salon Trading Licence${db.settings.tradingLicenceNumber ? ` (${db.settings.tradingLicenceNumber})` : ''}`,
    });

    db.driveDocuments.unshift({
      id: makeId('DRV'),
      driveFileId: uploaded.id,
      name: uploaded.name,
      category,
      mimeType: uploaded.mimeType,
      sizeBytes: uploaded.sizeBytes,
      webViewLink: uploaded.webViewLink,
      folderName,
      notes:
        kind === 'logo'
          ? 'Official Salon Logo'
          : `Trading Licence${db.settings.tradingLicenceNumber ? ` #${db.settings.tradingLicenceNumber}` : ''}${db.settings.tradingLicenceExpiry ? ` (Expires ${db.settings.tradingLicenceExpiry})` : ''}`,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
    });

    return { fileId: uploaded.id, webViewLink: uploaded.webViewLink };
  }

  router.post(
    '/workspace/drive/sync-branding',
    requireAuth,
    requireRole(['owner']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      if (!token) {
        res.status(401).json({
          error: 'Google Workspace is not connected. Please click "Connect Google Workspace" first.',
        });
        return;
      }

      const db = readDb();
      let syncedCount = 0;
      const errors: string[] = [];

      if (db.settings.salonLogoUrl?.startsWith('data:') && !db.settings.salonLogoDriveFileId) {
        try {
          const up = await uploadSalonAssetToDrive(
            token,
            db,
            'logo',
            db.settings.salonLogoUrl,
            req.sessionUser!.name
          );
          db.settings.salonLogoDriveFileId = up.fileId;
          db.settings.salonLogoDriveLink = up.webViewLink;
          syncedCount++;
        } catch (err) {
          errors.push(`Salon Logo: ${err instanceof Error ? err.message : 'Failed'}`);
        }
      }

      if (db.settings.tradingLicenceUrl?.startsWith('data:') && !db.settings.tradingLicenceDriveFileId) {
        try {
          const up = await uploadSalonAssetToDrive(
            token,
            db,
            'trading_licence',
            db.settings.tradingLicenceUrl,
            req.sessionUser!.name
          );
          db.settings.tradingLicenceDriveFileId = up.fileId;
          db.settings.tradingLicenceDriveLink = up.webViewLink;
          syncedCount++;
        } catch (err) {
          errors.push(`Trading Licence: ${err instanceof Error ? err.message : 'Failed'}`);
        }
      }

      if (syncedCount > 0) {
        appendAuditLog(
          db,
          req.sessionUser!,
          'DRIVE_BRANDING_SYNCED',
          'Settings',
          db.settings.googleDriveFolderId || 'DRIVE',
          `Synced ${syncedCount} salon branding/licensing document(s) to Google Drive.`
        );
        writeDb(db);
      }

      res.json({
        syncedCount,
        errors,
        settings: db.settings,
      });
    }
  );

  router.get('/workspace/drive/media/:fileId', requireAuth, async (req: AuthenticatedRequest, res) => {
    const fileId = req.params.fileId;
    const db = readDb();
    const user = req.sessionUser!;

    const docRecord = db.driveDocuments.find((d) => d.driveFileId === fileId);
    const idOwnerEmp = db.employees.find(
      (e) => e.nationalIdFrontDriveFileId === fileId || e.nationalIdBackDriveFileId === fileId
    );

    const isSensitiveHr =
      Boolean(idOwnerEmp) ||
      docRecord?.category === 'National ID' ||
      docRecord?.category === 'Staff Contract' ||
      docRecord?.category === 'Backup';

    if (isSensitiveHr) {
      const targetEmpId = idOwnerEmp?.id || docRecord?.relatedEmployeeId;
      const isSelf = user.role === 'employee' && Boolean(targetEmpId) && user.employeeId === targetEmpId;
      if (!['owner', 'manager'].includes(user.role) && !isSelf) {
        res.status(403).json({ error: 'Access to confidential HR documents is restricted.' });
        return;
      }
    }

    const token = req.headers['x-google-token']?.toString();
    if (!token) {
      res.status(401).json({
        error: 'Google Workspace token missing. Connect Google Workspace to preview Drive-hosted files.',
      });
      return;
    }

    try {
      const media = await fetchGoogleDriveFileMedia(token, fileId);
      const safeName = media.name.replace(/["\r\n]/g, '_');
      res.setHeader('Content-Type', media.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
      res.send(media.buffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unable to stream Drive media.' });
    }
  });

  router.delete(
    '/workspace/drive/files/:fileId',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = req.headers['x-google-token']?.toString();
      if (!token) {
        res.status(401).json({
          error: 'Google Workspace token missing. Connect Google Workspace to delete files from Drive.',
        });
        return;
      }

      const fileId = req.params.fileId;
      try {
        await deleteGoogleDriveFile(token, fileId);
        const db = readDb();
        const removed = db.driveDocuments.filter((d) => d.driveFileId === fileId);
        db.driveDocuments = db.driveDocuments.filter((d) => d.driveFileId !== fileId);

        db.employees.forEach((emp) => {
          let empDriveTouched = false;
          if (emp.avatarDriveFileId === fileId) {
            emp.avatarDriveFileId = undefined;
            emp.avatarDriveLink = undefined;
            empDriveTouched = true;
          }
          if (emp.nationalIdFrontDriveFileId === fileId) {
            emp.nationalIdFrontDriveFileId = undefined;
            emp.nationalIdFrontDriveLink = undefined;
            empDriveTouched = true;
          }
          if (emp.nationalIdBackDriveFileId === fileId) {
            emp.nationalIdBackDriveFileId = undefined;
            emp.nationalIdBackDriveLink = undefined;
            empDriveTouched = true;
          }
          if (empDriveTouched) {
            emp.lastDocumentUpdatedAt = new Date().toISOString();
            emp.lastDocumentUpdatedBy = req.sessionUser!.name;
          }
        });

        db.backups.forEach((b) => {
          if (b.driveFileId === fileId) {
            b.driveFileId = undefined;
          }
        });

        if (db.settings.salonLogoDriveFileId === fileId) {
          db.settings.salonLogoDriveFileId = undefined;
          db.settings.salonLogoDriveLink = undefined;
        }
        if (db.settings.tradingLicenceDriveFileId === fileId) {
          db.settings.tradingLicenceDriveFileId = undefined;
          db.settings.tradingLicenceDriveLink = undefined;
        }

        appendAuditLog(
          db,
          req.sessionUser!,
          'DRIVE_DOCUMENT_DELETED',
          'DriveDocument',
          fileId,
          `Deleted file ${removed[0]?.name || fileId} from Google Drive.`
        );
        writeDb(db);
        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to delete Google Drive file.',
        });
      }
    }
  );

  router.get('/workspace/apps-script', requireAuth, (_req, res) => {
    const db = readDb();
    res.json({
      spreadsheetId: db.settings.googleSpreadsheetId || '',
      code: generateAppsScriptCode(db.settings.googleSpreadsheetId),
    });
  });

  // ==================== AI BUSINESS ASSISTANT ====================
  router.post('/ai/ask', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { question } = req.body as { question?: string };
    if (!question?.trim()) {
      res.status(400).json({ error: 'Please enter a question for the AI Business Assistant.' });
      return;
    }
    try {
      const db = readDb();
      const result = await askSalonAiAssistant(db, req.sessionUser!, question.trim());
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Gemini AI request failed.',
      });
    }
  });

  // ==================== NOTIFICATIONS, USERS, SETTINGS, AUDIT & BACKUPS ====================
  router.get('/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const role = req.sessionUser!.role;
    res.json({
      notifications: db.notifications.filter((n) => n.targetRoles.includes(role)),
    });
  });

  router.post('/notifications/:id/read', requireAuth, (req, res) => {
    const db = readDb();
    const n = db.notifications.find((item) => item.id === req.params.id);
    if (n) {
      n.read = true;
      writeDb(db);
    }
    res.json({ ok: true });
  });

  router.get('/users', requireAuth, requireRole(['owner', 'manager']), (_req, res) => {
    const db = readDb();
    res.json({
      users: db.users.map(({ passwordHash: _ph, ...safe }) => safe),
    });
  });

  router.post('/users', requireAuth, requireRole(['owner']), (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const { name, email, role, employeeId, password } = req.body as {
      name: string;
      email: string;
      role: UserRole;
      employeeId?: string;
      password: string;
    };
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ error: 'Name, email, and password (min 6 chars) are required.' });
      return;
    }
    if (db.users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      res.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }
    const validRoles: UserRole[] = ['owner', 'manager', 'employee'];
    const targetRole: UserRole = role || 'employee';
    if (!validRoles.includes(targetRole)) {
      res.status(400).json({ error: 'Invalid user role. Allowed roles: owner, manager, employee.' });
      return;
    }
    const newUser = {
      id: makeId('USR'),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: targetRole,
      employeeId,
      passwordHash: hashPassword(password),
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.users.push(newUser);
    appendAuditLog(
      db,
      req.sessionUser!,
      'USER_CREATED',
      'User',
      newUser.id,
      `Created user ${newUser.email} with role ${newUser.role}.`
    );
    writeDb(db);
    const { passwordHash: _ph, ...safe } = newUser;
    res.status(201).json({ user: safe });
  });

  router.patch(
    '/users/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const target = db.users.find((u) => u.id === req.params.id);
      if (!target) {
        res.status(404).json({ error: 'User not found.' });
        return;
      }

      const actor = req.sessionUser!;
      const body = req.body as {
        active?: boolean;
        role?: UserRole;
        name?: string;
        password?: string;
      };

      if (actor.role === 'manager') {
        if (target.role !== 'employee') {
          res.status(403).json({
            error:
              'Managers can only disable employee accounts. Other user accounts require Owner / Admin permissions.',
          });
          return;
        }
        if (
          body.active !== false ||
          body.role !== undefined ||
          body.name !== undefined ||
          body.password !== undefined
        ) {
          res.status(403).json({
            error:
              'Managers can only disable employee accounts. Re-enabling or editing account details requires Owner / Admin permissions.',
          });
          return;
        }
        target.active = false;
        appendAuditLog(
          db,
          actor,
          'USER_DISABLED_BY_MANAGER',
          'User',
          target.id,
          `Manager disabled employee account ${target.email}.`
        );
        writeDb(db);
        const { passwordHash: _ph, ...safe } = target;
        res.json({ user: safe });
        return;
      }

      // Owner / Admin path
      if (target.id === actor.userId && body.active === false) {
        res.status(400).json({ error: 'You cannot disable your own active Owner / Admin account.' });
        return;
      }
      const otherActiveOwners = db.users.filter(
        (u) => u.id !== target.id && u.role === 'owner' && u.active
      );
      if (
        target.role === 'owner' &&
        (body.active === false || (body.role && body.role !== 'owner')) &&
        otherActiveOwners.length === 0
      ) {
        res.status(400).json({ error: 'Cannot disable or demote the last active Owner / Admin account.' });
        return;
      }

      if (body.role !== undefined && !['owner', 'manager', 'employee'].includes(body.role)) {
        res.status(400).json({ error: 'Invalid user role. Allowed roles: owner, manager, employee.' });
        return;
      }

      if (typeof body.active === 'boolean') target.active = body.active;
      if (body.role) target.role = body.role;
      if (body.name) target.name = body.name;
      if (body.password && String(body.password).length >= 6) {
        target.passwordHash = hashPassword(String(body.password));
      }
      appendAuditLog(
        db,
        actor,
        'USER_UPDATED',
        'User',
        target.id,
        `Updated user ${target.email} (active=${target.active}, role=${target.role}).`
      );
      writeDb(db);
      const { passwordHash: _ph, ...safe } = target;
      res.json({ user: safe });
    }
  );

  router.delete(
    '/users/:id',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const idx = db.users.findIndex((u) => u.id === req.params.id);
      if (idx === -1) {
        res.status(404).json({ error: 'User account not found.' });
        return;
      }
      const target = db.users[idx];
      if (target.id === req.sessionUser!.userId) {
        res.status(400).json({ error: 'You cannot delete your own active Owner / Admin account.' });
        return;
      }
      const otherActiveOwners = db.users.filter(
        (u) => u.id !== target.id && u.role === 'owner' && u.active
      );
      if (target.role === 'owner' && target.active && otherActiveOwners.length === 0) {
        res.status(400).json({ error: 'Cannot delete the last active Owner / Admin account.' });
        return;
      }

      db.users.splice(idx, 1);
      appendAuditLog(
        db,
        req.sessionUser!,
        'USER_DELETED',
        'User',
        target.id,
        `Permanently deleted user account ${target.email} (${target.role}).`
      );
      writeDb(db);
      res.json({ ok: true, deletedUserId: target.id });
    }
  );

  router.get('/branding', (_req, res) => {
    const db = readDb();
    res.json({
      businessName: db.settings.businessName,
      tagline: db.settings.tagline,
      location: db.settings.location,
      salonLogoUrl: db.settings.salonLogoUrl || '',
    });
  });

  router.get('/settings', requireAuth, (_req, res) => {
    const db = readDb();
    res.json({ settings: db.settings });
  });

  router.patch(
    '/settings',
    requireAuth,
    requireRole(['owner']),
    async (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const body = req.body as Partial<typeof db.settings>;

      const prevLogo = db.settings.salonLogoUrl;
      const prevLicence = db.settings.tradingLicenceUrl;

      let nextLogo = db.settings.salonLogoUrl;
      let nextLicence = db.settings.tradingLicenceUrl;
      try {
        if (body.salonLogoUrl !== undefined) {
          const sanitized = sanitizeAvatarUrl(body.salonLogoUrl);
          nextLogo = sanitized ? sanitized : undefined;
        }
        if (body.tradingLicenceUrl !== undefined) {
          const sanitizedDoc = sanitizeNationalIdDocUrl(body.tradingLicenceUrl, 'Trading Licence');
          nextLicence = sanitizedDoc ? sanitizedDoc : undefined;
        }
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid file upload.' });
        return;
      }

      Object.assign(db.settings, body, {
        salonLogoUrl: nextLogo,
        tradingLicenceUrl: nextLicence,
        tradingLicenceNumber:
          body.tradingLicenceNumber !== undefined
            ? String(body.tradingLicenceNumber).trim()
            : db.settings.tradingLicenceNumber,
        tradingLicenceExpiry:
          body.tradingLicenceExpiry !== undefined
            ? String(body.tradingLicenceExpiry).trim()
            : db.settings.tradingLicenceExpiry,
      });

      if (!nextLogo) {
        db.settings.salonLogoDriveFileId = undefined;
        db.settings.salonLogoDriveLink = undefined;
      }
      if (!nextLicence) {
        db.settings.tradingLicenceDriveFileId = undefined;
        db.settings.tradingLicenceDriveLink = undefined;
      }

      let driveWarning: string | undefined;
      const googleToken = req.headers['x-google-token']?.toString();
      if (googleToken) {
        const warnings: string[] = [];
        if (nextLogo?.startsWith('data:') && (nextLogo !== prevLogo || !db.settings.salonLogoDriveFileId)) {
          try {
            const up = await uploadSalonAssetToDrive(
              googleToken,
              db,
              'logo',
              nextLogo,
              req.sessionUser!.name
            );
            db.settings.salonLogoDriveFileId = up.fileId;
            db.settings.salonLogoDriveLink = up.webViewLink;
          } catch (err) {
            warnings.push(`Logo Drive upload: ${err instanceof Error ? err.message : 'Failed'}`);
          }
        }
        if (
          nextLicence?.startsWith('data:') &&
          (nextLicence !== prevLicence || !db.settings.tradingLicenceDriveFileId)
        ) {
          try {
            const up = await uploadSalonAssetToDrive(
              googleToken,
              db,
              'trading_licence',
              nextLicence,
              req.sessionUser!.name
            );
            db.settings.tradingLicenceDriveFileId = up.fileId;
            db.settings.tradingLicenceDriveLink = up.webViewLink;
          } catch (err) {
            warnings.push(`Trading Licence Drive upload: ${err instanceof Error ? err.message : 'Failed'}`);
          }
        }
        if (warnings.length > 0) {
          driveWarning = `Settings saved locally, but Google Drive upload failed: ${warnings.join(' | ')}`;
        }
      }

      appendAuditLog(
        db,
        req.sessionUser!,
        'SETTINGS_UPDATED',
        'Settings',
        'SALON_SETTINGS',
        'Updated Trendy Unisex Salon configuration, branding, and licensing settings.'
      );
      writeDb(db);
      res.json({ settings: db.settings, driveWarning });
    }
  );

  router.get('/audit-logs', requireAuth, requireRole(['owner', 'manager']), (_req, res) => {
    const db = readDb();
    res.json({ logs: db.auditLogs, migrations: db.migrationLogs });
  });

  router.get('/backups', requireAuth, requireRole(['owner']), (_req, res) => {
    const db = readDb();
    res.json({ backups: db.backups });
  });

  router.post('/backups', requireAuth, requireRole(['owner']), (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const label = (req.body.label as string) || 'Manual Local Backup';
    const backupId = createBackupSnapshot(db, label, req.sessionUser!.name);
    appendAuditLog(db, req.sessionUser!, 'BACKUP_CREATED', 'SystemBackup', backupId, `Created backup: ${label}`);
    writeDb(db);
    res.status(201).json({ backupId, backups: db.backups });
  });

  router.post('/backups/:id/restore', requireAuth, requireRole(['owner']), (req: AuthenticatedRequest, res) => {
    const snapshot = getBackupSnapshot(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: 'Backup snapshot file not found.' });
      return;
    }
    const current = readDb();
    createBackupSnapshot(current, `Pre-Restore Auto Backup`, req.sessionUser!.name);
    snapshot.backups = current.backups;
    appendAuditLog(
      snapshot,
      req.sessionUser!,
      'BACKUP_RESTORED',
      'SystemBackup',
      req.params.id,
      `Restored system state from backup ${req.params.id}.`
    );
    writeDb(snapshot);
    res.json({ ok: true });
  });

  return router;
}
