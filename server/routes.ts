import crypto from 'node:crypto';
import express from 'express';
import {
  appendAuditLog,
  createBackupSnapshot,
  createInitialDatabase,
  getBackupSnapshot,
  IS_SERVERLESS,
  markDbCleanFromCloudSync,
  readDb,
  recordSessionEvent,
  todayIsoDate,
  writeDb,
} from './db.ts';
import {
  extractSessionToken,
  getClientContext,
  hashPassword,
  requireAuth,
  requireRole,
  SESSION_COOKIE_NAME,
  signSessionToken,
  verifyPassword,
  verifySessionToken,
  type AuthenticatedRequest,
} from './auth.ts';
import { validatePasswordPolicy } from './passwordPolicy.ts';
import {
  getEmployeeCommissionSummary,
  getPolicyForDate,
  recomputeEmployeeDailyCommission,
  resolveServiceCommissionRate,
} from './commissionEngine.ts';
import { askSalonAiAssistant } from './aiService.ts';
import {
  backupDatabaseToGoogleDrive,
  backupDatabaseViaAppsScript,
  createNewSheetViaAppsScript,
  createSalonGoogleSpreadsheet,
  deleteDriveFileViaAppsScript,
  deleteGoogleDriveFile,
  ensureCategoryDriveFolder,
  fetchDriveMediaViaAppsScript,
  fetchGoogleDriveFileMedia,
  getAppsScriptBridgeUrl,
  getServerGoogleAccessToken,
  getServerGoogleCredentialsStatus,
  listAppDriveFiles,
  listDriveFilesViaAppsScript,
  parseDataUrl,
  readDatabaseFromGoogleSheet,
  readDatabaseViaAppsScript,
  readGoogleSheetTab,
  readGoogleSheetTabViaAppsScript,
  readWorkbookFromGoogleSheet,
  readWorkbookViaAppsScript,
  syncDatabaseToGoogleSheet,
  syncDatabaseViaAppsScript,
  testAppsScriptBridge,
  uploadBinaryToGoogleDrive,
  uploadBinaryViaAppsScript,
} from './workspaceService.ts';
import { detectSheetEntity, importTabularSheetsIntoDb } from './migrationEngine.ts';
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

function resolveEmployeeForUser(
  db: SalonDatabase,
  user: { userId?: string; id?: string; employeeId?: string; email?: string; name?: string }
): Employee | undefined {
  const uid = user.userId || user.id;
  const dbUserRecord = uid ? db.users.find((u) => u.id === uid) : undefined;
  const candidateId = dbUserRecord ? dbUserRecord.employeeId : user.employeeId;
  if (candidateId) {
    const byId = db.employees.find((e) => e.id === candidateId);
    if (byId) return byId;
  }
  const email = (user.email || '').trim().toLowerCase();
  if (email) {
    const byEmail = db.employees.find((e) => (e.email || '').trim().toLowerCase() === email);
    if (byEmail) return byEmail;
  }
  const name = (user.name || '').trim().toLowerCase();
  if (name) {
    const byName = db.employees.find((e) => e.fullName.trim().toLowerCase() === name);
    if (byName) return byName;
  }
  return undefined;
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
    const normalizedEmail = email.trim().toLowerCase();
    const user = db.users.find((u) => u.email.toLowerCase() === normalizedEmail);
    const { ipAddress, userAgent } = getClientContext(req);
    const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
    const recentFailures = (db.sessionHistory || []).filter(
      (s) =>
        (s.status === 'failed_login' || s.status === 'suspicious') &&
        new Date(s.loginAt).getTime() >= fifteenMinAgo &&
        (s.email.toLowerCase() === normalizedEmail ||
          (ipAddress !== 'unknown' && s.ipAddress === ipAddress))
    ).length;

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      const now = new Date().toISOString();
      const isDisabledAttempt = Boolean(user && !user.active);
      const isBruteSuspect = recentFailures >= 2 || isDisabledAttempt || (!user && recentFailures >= 1);
      const reason = isDisabledAttempt
        ? 'Sign-in attempted on disabled staff account'
        : !user
          ? recentFailures >= 1
            ? `Repeated unknown email login attempt (${recentFailures + 1} in 15m)`
            : 'Unknown email sign-in attempt'
          : recentFailures >= 2
            ? `Multiple failed password attempts (${recentFailures + 1} in 15m)`
            : 'Incorrect password entered';

      recordSessionEvent(db, {
        userId: user?.id,
        userName: user?.name,
        email: normalizedEmail,
        role: user?.role,
        authMethod: 'credentials',
        status: isBruteSuspect ? 'suspicious' : 'failed_login',
        loginAt: now,
        ipAddress,
        userAgent,
        reason,
        suspicious: isBruteSuspect,
        suspiciousSeverity: isDisabledAttempt || recentFailures >= 3 ? 'high' : isBruteSuspect ? 'medium' : 'low',
      });

      if (isBruteSuspect) {
        appendAuditLog(
          db,
          {
            userId: user?.id || 'UNKNOWN',
            userName: user?.name || normalizedEmail,
            userRole: user?.role || 'employee',
          },
          'SECURITY_SUSPICIOUS_LOGIN',
          'Security',
          user?.id || normalizedEmail,
          `${reason} from ${ipAddress}.`
        );
      }
      writeDb(db);
      res.status(401).json({ error: 'Invalid email or password, or account is deactivated.' });
      return;
    }

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    user.lastLoginAt = now;
    if (user.role === 'employee' && !user.employeeId) {
      const matchedEmp = resolveEmployeeForUser(db, user);
      if (matchedEmp) user.employeeId = matchedEmp.id;
    }
    const hadPriorFailures = recentFailures >= 2;

    recordSessionEvent(db, {
      sessionId,
      userId: user.id,
      userName: user.name,
      email: user.email,
      role: user.role,
      authMethod: 'credentials',
      status: 'active',
      loginAt: now,
      ipAddress,
      userAgent,
      reason: hadPriorFailures
        ? `Signed in after ${recentFailures} recent failed attempt(s)`
        : 'Successful credential sign-in',
      suspicious: hadPriorFailures,
      suspiciousSeverity: hadPriorFailures ? 'medium' : undefined,
    });

    appendAuditLog(
      db,
      { userId: user.id, userName: user.name, userRole: user.role },
      'USER_LOGIN',
      'User',
      user.id,
      `Signed in via salon credentials (${user.role}) from ${ipAddress}.`
    );
    writeDb(db);

    const token = signSessionToken(user, sessionId);
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
    const { ipAddress, userAgent } = getClientContext(req);
    if (!accessToken) {
      res.status(401).json({ error: 'Google OAuth access token is required.' });
      return;
    }

    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!infoRes.ok) {
        const db = readDb();
        recordSessionEvent(db, {
          email: 'google-oauth-unknown',
          authMethod: 'google_workspace',
          status: 'suspicious',
          loginAt: new Date().toISOString(),
          ipAddress,
          userAgent,
          reason: 'Rejected invalid or expired Google OAuth access token.',
          suspicious: true,
          suspiciousSeverity: 'medium',
        });
        writeDb(db);
        res.status(401).json({ error: 'Invalid or expired Google OAuth access token.' });
        return;
      }
      const googleProfile = (await infoRes.json()) as { email?: string; name?: string; email_verified?: boolean };
      if (!googleProfile.email) {
        res.status(400).json({ error: 'Google account email could not be verified.' });
        return;
      }

      const db = readDb();
      const user = db.users.find(
        (u) => u.email.toLowerCase() === googleProfile.email!.toLowerCase()
      );
      if (!user) {
        recordSessionEvent(db, {
          userName: googleProfile.name,
          email: googleProfile.email.toLowerCase(),
          authMethod: 'google_workspace',
          status: 'suspicious',
          loginAt: new Date().toISOString(),
          ipAddress,
          userAgent,
          reason: 'Unregistered Google account attempted workspace sign-in.',
          suspicious: true,
          suspiciousSeverity: 'high',
        });
        appendAuditLog(
          db,
          { userId: 'UNKNOWN', userName: googleProfile.email, userRole: 'employee' },
          'SECURITY_UNREGISTERED_GOOGLE',
          'Security',
          googleProfile.email,
          `Blocked unregistered Google account (${googleProfile.email}) from ${ipAddress}.`
        );
        writeDb(db);
        res.status(403).json({
          error: `Google account (${googleProfile.email}) is not registered as a Trendy Unisex Salon user. Please sign in with salon credentials first or ask the Owner to add ${googleProfile.email} in User Management.`,
        });
        return;
      }
      if (!user.active) {
        recordSessionEvent(db, {
          userId: user.id,
          userName: user.name,
          email: user.email,
          role: user.role,
          authMethod: 'google_workspace',
          status: 'suspicious',
          loginAt: new Date().toISOString(),
          ipAddress,
          userAgent,
          reason: 'Deactivated staff account attempted Google Workspace sign-in.',
          suspicious: true,
          suspiciousSeverity: 'high',
        });
        writeDb(db);
        res.status(403).json({ error: 'This salon user account is deactivated.' });
        return;
      }

      const now = new Date().toISOString();
      const sessionId = crypto.randomUUID();
      user.lastLoginAt = now;
      if (user.role === 'employee' && !user.employeeId) {
        const matchedEmp = resolveEmployeeForUser(db, user);
        if (matchedEmp) user.employeeId = matchedEmp.id;
      }
      recordSessionEvent(db, {
        sessionId,
        userId: user.id,
        userName: user.name,
        email: user.email,
        role: user.role,
        authMethod: 'google_workspace',
        status: 'active',
        loginAt: now,
        ipAddress,
        userAgent,
        reason: 'Successful Google Workspace sign-in',
        suspicious: false,
      });
      appendAuditLog(
        db,
        { userId: user.id, userName: user.name, userRole: user.role },
        'GOOGLE_LOGIN',
        'User',
        user.id,
        `Authenticated via Google Workspace (${googleProfile.email}) from ${ipAddress}.`
      );
      writeDb(db);

      const token = signSessionToken(user, sessionId);
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
    const { token } = extractSessionToken(req);
    if (token) {
      const payload = verifySessionToken(token);
      if (payload) {
        const db = readDb();
        const now = new Date().toISOString();
        const sess =
          (payload.sessionId &&
            db.sessionHistory.find(
              (s) => s.sessionId === payload.sessionId && s.status === 'active'
            )) ||
          db.sessionHistory.find(
            (s) => s.userId === payload.userId && s.status === 'active'
          );

        if (sess) {
          sess.status = 'signed_out';
          sess.logoutAt = now;
        } else {
          const { ipAddress, userAgent } = getClientContext(req);
          recordSessionEvent(db, {
            sessionId: payload.sessionId,
            userId: payload.userId,
            userName: payload.name,
            email: payload.email,
            role: payload.role,
            authMethod: 'token',
            status: 'signed_out',
            loginAt: now,
            logoutAt: now,
            ipAddress,
            userAgent,
            reason: 'Signed out',
            suspicious: false,
          });
        }

        appendAuditLog(
          db,
          { userId: payload.userId, userName: payload.name, userRole: payload.role },
          'USER_LOGOUT',
          'User',
          payload.userId,
          `Signed out of Trendy Unisex Salon session.`
        );
        writeDb(db);
      }
    }
    res.clearCookie(SESSION_COOKIE_NAME, { sameSite: 'none', secure: true });
    res.json({ ok: true });
  });

  router.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const sessionUser = req.sessionUser!;
    const dbUser = db.users.find((u) => u.id === sessionUser.userId);
    const resolvedEmp =
      sessionUser.role === 'employee'
        ? resolveEmployeeForUser(db, sessionUser)
        : dbUser?.employeeId
          ? db.employees.find((e) => e.id === dbUser.employeeId)
          : undefined;
    res.json({
      user: {
        ...sessionUser,
        name:
          sessionUser.role === 'employee'
            ? resolvedEmp?.fullName || dbUser?.name || sessionUser.name
            : dbUser?.name || sessionUser.name,
        employeeId: resolvedEmp?.id || dbUser?.employeeId,
      },
    });
  });

  router.post('/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current password and new password are required.' });
      return;
    }
    const policy = validatePasswordPolicy(newPassword);
    if (!policy.isValid) {
      res.status(400).json({ error: policy.errorMessage || 'New password does not meet security requirements.' });
      return;
    }
    if (currentPassword === newPassword) {
      res.status(400).json({ error: 'New password must be different from your current password.' });
      return;
    }

    const db = readDb();
    const actor = req.sessionUser!;
    const dbUser = db.users.find((u) => u.id === actor.userId);
    if (!dbUser || !dbUser.active) {
      res.status(404).json({ error: 'User account not found or inactive.' });
      return;
    }
    if (!verifyPassword(currentPassword, dbUser.passwordHash)) {
      appendAuditLog(
        db,
        actor,
        'USER_PASSWORD_CHANGE_FAILED',
        'User',
        dbUser.id,
        `Incorrect current password entered while attempting to change password.`
      );
      writeDb(db);
      res.status(401).json({ error: 'Current password is incorrect.' });
      return;
    }

    dbUser.passwordHash = hashPassword(newPassword);
    appendAuditLog(
      db,
      actor,
      'USER_PASSWORD_CHANGED',
      'User',
      dbUser.id,
      `User ${dbUser.email} changed their account password.`
    );
    writeDb(db);
    res.json({ ok: true, message: 'Password updated successfully.' });
  });

  // ==================== DASHBOARD ====================
  router.get('/dashboard', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    const today = todayIsoDate();
    const startDate = (req.query.startDate as string) || `${today.slice(0, 7)}-01`;
    const endDate = (req.query.endDate as string) || today;

    if (user.role === 'employee') {
      const emp = resolveEmployeeForUser(db, user);
      const empId = emp?.id || user.employeeId || '';
      const summary = empId
        ? getEmployeeCommissionSummary(db, empId)
        : {
            grossEarnings: 0,
            totalLunchDeducted: 0,
            totalCommissionEarned: 0,
            totalPaid: 0,
            outstandingBalance: 0,
            directTips: 0,
          };
      const todayLedger = empId
        ? db.commissionLedger.filter(
            (c) => c.employeeId === empId && c.date === today && c.paymentStatus !== 'Reversed'
          )
        : [];
      const todayLunch = empId
        ? db.lunchDeductions
            .filter((l) => l.employeeId === empId && l.date === today)
            .reduce((s, l) => s + l.amount, 0)
        : 0;
      const upcomingAppointments = empId
        ? db.appointments
            .filter((a) => a.employeeId === empId && a.date >= today && a.status !== 'Cancelled')
            .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
            .slice(0, 10)
        : [];

      res.json({
        roleScope: 'employee',
        today,
        employeeProfileLinked: Boolean(emp),
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
        recentLedger: empId
          ? db.commissionLedger
              .filter((c) => c.employeeId === empId)
              .slice(-20)
              .reverse()
          : [],
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

    // Build current-week (Monday -> Sunday) daily revenue trend from local DB state
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const todayAnchor = new Date(`${today}T00:00:00Z`);
    const offsetFromMonday = (todayAnchor.getUTCDay() + 6) % 7;
    const weekStart = new Date(todayAnchor);
    weekStart.setUTCDate(todayAnchor.getUTCDate() - offsetFromMonday);

    const weeklyRevenueTrend: Array<{
      date: string;
      dayLabel: string;
      serviceRevenue: number;
      productRevenue: number;
      totalRevenue: number;
      expenses: number;
      isToday: boolean;
    }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(weekStart.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const dayTxs = activeTx.filter((t) => t.date === iso);
      const dayBreakdown = calcBreakdown(dayTxs);
      const dayExp = db.expenses
        .filter((e) => e.date === iso && e.status !== 'Rejected')
        .reduce((s, e) => s + e.amount, 0);
      weeklyRevenueTrend.push({
        date: iso,
        dayLabel: DAY_NAMES[d.getUTCDay()],
        serviceRevenue: dayBreakdown.serviceRevenue,
        productRevenue: dayBreakdown.productRevenue,
        totalRevenue: dayBreakdown.totalSales,
        expenses: dayExp,
        isToday: iso === today,
      });
    }

    // Build 14-day daily sales trend
    const dailyTrend: Array<{ date: string; serviceSales: number; productSales: number; expenses: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(todayAnchor);
      d.setUTCDate(todayAnchor.getUTCDate() - i);
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
    const recentTransactions = [...db.posTransactions]
      .filter((t) => t.status === 'Completed')
      .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))
      .slice(0, 5);

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
        weeklyRevenueTrend,
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
      recentTransactions,
      hasTransactions: db.posTransactions.length > 0,
    });
  });

  // ==================== APPOINTMENTS & WALK-INS ====================
  router.get('/appointments', requireAuth, (req: AuthenticatedRequest, res) => {
    const db = readDb();
    const user = req.sessionUser!;
    let list = [...db.appointments];
    if (user.role === 'employee') {
      const empId = resolveEmployeeForUser(db, user)?.id || user.employeeId || '';
      list = empId ? list.filter((a) => a.employeeId === empId) : [];
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
    const isSafeDataImage = /^data:image\/(png|jpeg|jpg|webp)(?:;[a-z0-9=._-]+)*;base64,[A-Za-z0-9+/=\s]+$/i.test(val);
    const isSafeUrl =
      /^https?:\/\/.+/i.test(val) || val.startsWith('/src/assets/') || val.startsWith('/assets/');
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
    const isSafeDataDoc = /^data:(image\/(png|jpeg|jpg|webp)|application\/pdf)(?:;[a-z0-9=._-]+)*;base64,[A-Za-z0-9+/=\s]+$/i.test(val);
    const isSafeUrl =
      /^https?:\/\/.+/i.test(val) || val.startsWith('/src/assets/') || val.startsWith('/assets/');
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
    token: string | undefined,
    db: SalonDatabase,
    emp: Employee,
    kind: 'avatar' | 'id_front' | 'id_back',
    dataUrl: string,
    uploadedBy: string
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const { mimeType, buffer } = parseDataUrl(dataUrl);
    const category: DriveDocumentCategory = kind === 'avatar' ? 'Employee Photo' : 'National ID';
    const safeEmpName = emp.fullName.trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
    const ext = fileExtensionFromMime(mimeType);
    const suffix =
      kind === 'avatar' ? 'Profile_Photo' : kind === 'id_front' ? 'National_ID_Front' : 'National_ID_Back';
    const fileName = `${emp.id}_${safeEmpName}_${suffix}.${ext}`;
    const description = `${category} for ${emp.fullName} (${emp.id}) — Trendy Unisex Salon`;

    let uploaded: { id: string; name: string; mimeType: string; sizeBytes: number; webViewLink?: string };
    let folderName: string;

    const bridgeUrl = getAppsScriptBridgeUrl(db.settings.googleAppsScriptUrl);
    if (!token && bridgeUrl) {
      const up = await uploadBinaryViaAppsScript(bridgeUrl, {
        fileName,
        mimeType,
        buffer,
        category,
        description,
      });
      db.settings.googleDriveFolderId = up.rootFolderId;
      folderName = up.folderName;
      uploaded = up.file;
    } else if (token) {
      const folderRes = await ensureCategoryDriveFolder(
        token,
        category,
        db.settings.googleDriveFolderId
      );
      db.settings.googleDriveFolderId = folderRes.rootFolderId;
      folderName = folderRes.folderName;
      uploaded = await uploadBinaryToGoogleDrive(token, {
        fileName,
        mimeType,
        buffer,
        folderId: folderRes.folderId,
        description,
      });
    } else {
      throw new Error('No Google Workspace token or Apps Script bridge URL configured.');
    }

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
      const emp = resolveEmployeeForUser(db, user);
      const me = emp ? [emp] : [];
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

  // Self-service employee profile creation when an employee login is not yet linked
  router.post(
    '/employees/me',
    requireAuth,
    requireRole(['employee']),
    async (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const user = req.sessionUser!;
      const existing = resolveEmployeeForUser(db, user);
      if (existing) {
        res.status(409).json({
          error: 'Your employee profile already exists. Please use Edit My Profile to update your details.',
        });
        return;
      }

      const body = req.body as Partial<Employee>;
      const fullName = (body.fullName || user.name || '').trim();
      const phone = (body.phone || '').trim();
      if (!fullName || !phone) {
        res.status(400).json({ error: 'Full name and primary contact phone are required.' });
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

      const nowIso = new Date().toISOString();
      const emp: Employee = {
        id: makeId('EMP'),
        fullName,
        roleTitle: body.roleTitle?.trim() || 'Salon Stylist',
        phone,
        secondaryPhone: body.secondaryPhone?.trim() || '',
        email: (body.email || user.email || '').trim(),
        nationalId: normalizedNin,
        nationalIdDocumentUrl: nationalIdDocumentUrl || undefined,
        nationalIdBackUrl: nationalIdBackUrl || undefined,
        homeAddress: body.homeAddress?.trim() || '',
        emergencyContactName: body.emergencyContactName?.trim() || '',
        emergencyContactPhone: body.emergencyContactPhone?.trim() || '',
        specialties: Array.isArray(body.specialties) ? body.specialties : [],
        avatarUrl: avatarUrl || undefined,
        status: 'Active',
        active: true,
        hireDate: todayIsoDate(),
        lastDocumentUpdatedAt: nowIso,
        lastDocumentUpdatedBy: user.name,
        lunchEligible: true,
        defaultShiftStart: '08:00',
        defaultShiftEnd: '20:00',
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      };

      let driveWarning: string | undefined;
      const googleToken = req.headers['x-google-token']?.toString();
      if (googleToken) {
        try {
          if (emp.avatarUrl?.startsWith('data:')) {
            const up = await uploadEmployeeDataUrlToDrive(googleToken, db, emp, 'avatar', emp.avatarUrl, user.name);
            emp.avatarDriveFileId = up.fileId;
            emp.avatarDriveLink = up.webViewLink;
          }
          if (emp.nationalIdDocumentUrl?.startsWith('data:')) {
            const up = await uploadEmployeeDataUrlToDrive(googleToken, db, emp, 'id_front', emp.nationalIdDocumentUrl, user.name);
            emp.nationalIdFrontDriveFileId = up.fileId;
            emp.nationalIdFrontDriveLink = up.webViewLink;
          }
          if (emp.nationalIdBackUrl?.startsWith('data:')) {
            const up = await uploadEmployeeDataUrlToDrive(googleToken, db, emp, 'id_back', emp.nationalIdBackUrl, user.name);
            emp.nationalIdBackDriveFileId = up.fileId;
            emp.nationalIdBackDriveLink = up.webViewLink;
          }
        } catch (err) {
          driveWarning =
            err instanceof Error
              ? `Profile saved locally, but Google Drive upload failed: ${err.message}`
              : 'Profile saved locally, but Google Drive upload failed.';
        }
      }

      db.employees.push(emp);
      const dbUser = db.users.find((u) => u.id === user.userId);
      if (dbUser) {
        dbUser.employeeId = emp.id;
        dbUser.name = emp.fullName;
      }

      appendAuditLog(
        db,
        user,
        'EMPLOYEE_SELF_PROFILE_CREATED',
        'Employee',
        emp.id,
        `Employee ${emp.fullName} completed their self-service staff profile.`
      );
      writeDb(db);
      res.status(201).json({ employee: { ...emp, status: resolveEmployeeStatus(emp) }, driveWarning });
    }
  );

  router.patch(
    '/employees/:id',
    requireAuth,
    requireRole(['owner', 'manager', 'employee']),
    async (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const actor = req.sessionUser!;
      const emp = db.employees.find((e) => e.id === req.params.id);
      if (!emp) {
        res.status(404).json({ error: 'Employee not found.' });
        return;
      }

      const isSelfEmployee = actor.role === 'employee';
      if (isSelfEmployee) {
        const ownEmp = resolveEmployeeForUser(db, actor);
        if (!ownEmp || ownEmp.id !== emp.id) {
          res.status(403).json({ error: 'Employees can only fill or update their own profile.' });
          return;
        }
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
      const nextStatus: EmployeeStatus = isSelfEmployee
        ? currentStatus
        : body.status !== undefined
          ? body.status
          : body.active !== undefined
            ? body.active
              ? 'Active'
              : 'Inactive'
            : currentStatus;

      if (
        !isSelfEmployee &&
        actor.role === 'manager' &&
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
      const nextRoleTitle =
        !isSelfEmployee && body.roleTitle !== undefined ? body.roleTitle.trim() : emp.roleTitle;
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
      const nextHireDate = !isSelfEmployee ? body.hireDate || emp.hireDate : emp.hireDate;
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
          ? actor.name
          : emp.lastDocumentUpdatedBy,
        lunchEligible: !isSelfEmployee ? body.lunchEligible ?? emp.lunchEligible : emp.lunchEligible,
        defaultShiftStart: !isSelfEmployee ? body.defaultShiftStart || emp.defaultShiftStart : emp.defaultShiftStart,
        defaultShiftEnd: !isSelfEmployee ? body.defaultShiftEnd || emp.defaultShiftEnd : emp.defaultShiftEnd,
        workingDays:
          !isSelfEmployee && Array.isArray(body.workingDays) && body.workingDays.length > 0
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
              actor.name
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
              actor.name
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
              actor.name
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
        if (u.employeeId === emp.id || (isSelfEmployee && u.id === actor.userId)) {
          if (isSelfEmployee && !u.employeeId) {
            u.employeeId = emp.id;
          }
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
        actor,
        isSelfEmployee ? 'EMPLOYEE_SELF_PROFILE_UPDATED' : 'EMPLOYEE_UPDATED',
        'Employee',
        emp.id,
        isSelfEmployee
          ? `Employee ${emp.fullName} updated their personal profile.`
          : `Updated profile/status for ${emp.fullName} (${resolveEmployeeStatus(emp)}).`
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
    const empId = user.role === 'employee' ? resolveEmployeeForUser(db, user)?.id || user.employeeId || '' : '';
    const schedules =
      user.role === 'employee'
        ? empId
          ? db.schedules.filter((s) => s.employeeId === empId)
          : []
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
    const empId = user.role === 'employee' ? resolveEmployeeForUser(db, user)?.id || user.employeeId || '' : '';
    const records =
      user.role === 'employee'
        ? empId
          ? db.attendance.filter((a) => a.employeeId === empId)
          : []
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
      const empId = resolveEmployeeForUser(db, user)?.id || '';
      res.json({
        transactions: empId
          ? db.posTransactions
              .filter((tx) => tx.items.some((i) => i.employeeId === empId))
              .slice(-50)
              .reverse()
          : [],
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
          if (!stock || stock.active === false) {
            res.status(404).json({ error: `Retail product not found: ${line.refId}` });
            return;
          }
          if (stock.inventoryGroup === 'salon_owned' || !stock.isRetail) {
            res.status(400).json({
              error: `"${stock.name}" is marked as Owned by Salon (internal use) and cannot be sold in POS.`,
            });
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
        if (item.minStockLevel > 0 && item.currentQuantity < item.minStockLevel * 0.1) {
          db.notifications.unshift({
            id: makeId('NTF'),
            type: 'low_stock',
            title: 'Stock Low (<10% Reorder Level)',
            message: `CRITICAL: ${item.name} (${item.sku}) dropped to ${item.currentQuantity} ${item.unit}, below 10% of reorder level (${item.minStockLevel} ${item.unit}). Create a restock report.`,
            severity: 'alert',
            read: false,
            targetRoles: ['owner', 'manager'],
            createdAt: now,
          });
        } else if (item.currentQuantity <= item.minStockLevel) {
          db.notifications.unshift({
            id: makeId('NTF'),
            type: 'low_stock',
            title: 'Low Stock Alert',
            message: `${item.name} (${item.sku}) is at ${item.currentQuantity} ${item.unit} (reorder level: ${item.minStockLevel}).`,
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
      const emp = resolveEmployeeForUser(db, user);
      const empId = emp?.id || user.employeeId || '';
      res.json({
        policies: db.commissionPolicies,
        ledger: empId ? db.commissionLedger.filter((c) => c.employeeId === empId).reverse() : [],
        lunchDeductions: empId ? db.lunchDeductions.filter((l) => l.employeeId === empId).reverse() : [],
        payments: empId ? db.commissionPayments.filter((p) => p.employeeId === empId).reverse() : [],
        adjustments: empId ? db.commissionAdjustments.filter((a) => a.employeeId === empId).reverse() : [],
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
      const inventoryGroup: 'salon_owned' | 'for_sale' =
        b.inventoryGroup === 'salon_owned' || b.inventoryGroup === 'for_sale'
          ? b.inventoryGroup
          : b.isRetail
          ? 'for_sale'
          : 'salon_owned';
      const isRetail = inventoryGroup === 'for_sale';
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
        sellingPrice: isRetail ? Math.max(0, Number(b.sellingPrice) || 0) : 0,
        supplierId: b.supplierId,
        supplierName: db.suppliers.find((s) => s.id === b.supplierId)?.name || b.supplierName,
        minStockLevel:
          b.minStockLevel !== undefined ? Math.max(0, Number(b.minStockLevel) || 0) : 3,
        expirationDate: b.expirationDate,
        isRetail,
        inventoryGroup,
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
          notes: `Initial stock registration (${inventoryGroup === 'for_sale' ? 'Items for Sale' : 'Owned by Salon'})`,
          recordedBy: req.sessionUser!.name,
          createdAt: new Date().toISOString(),
        });
      }
      if (item.minStockLevel > 0 && item.currentQuantity < item.minStockLevel * 0.1) {
        db.notifications.unshift({
          id: makeId('NTF'),
          type: 'low_stock',
          title: 'Stock Low (<10% Reorder Level)',
          message: `CRITICAL: ${item.name} (${item.sku}) was registered at ${item.currentQuantity} ${item.unit}, below 10% of reorder level (${item.minStockLevel} ${item.unit}). Create a restock report.`,
          severity: 'alert',
          read: false,
          targetRoles: ['owner', 'manager'],
          createdAt: new Date().toISOString(),
        });
      }
      appendAuditLog(
        db,
        req.sessionUser!,
        'STOCK_ITEM_CREATED',
        'StockItem',
        item.id,
        `Added stock item ${item.name} (${openQty} ${item.unit}) under ${inventoryGroup === 'for_sale' ? 'Items for Sale' : 'Owned by Salon'}.`
      );
      writeDb(db);
      res.status(201).json({ item });
    }
  );

  router.patch(
    '/inventory/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const item = db.stockItems.find((s) => s.id === req.params.id);
      if (!item) {
        res.status(404).json({ error: 'Stock item not found.' });
        return;
      }
      const b = req.body as Partial<StockItem>;
      if (b.name !== undefined) {
        if (!b.name.trim()) {
          res.status(400).json({ error: 'Product name cannot be empty.' });
          return;
        }
        item.name = b.name.trim();
      }
      if (b.category !== undefined) {
        if (!b.category.trim()) {
          res.status(400).json({ error: 'Category cannot be empty.' });
          return;
        }
        item.category = b.category.trim();
      }
      if (b.brand !== undefined) item.brand = b.brand.trim() || 'Salon Stock';
      if (b.unit !== undefined) item.unit = b.unit.trim() || 'Unit';
      if (b.purchasePrice !== undefined) item.purchasePrice = Math.max(0, Number(b.purchasePrice) || 0);
      if (b.minStockLevel !== undefined) item.minStockLevel = Math.max(0, Number(b.minStockLevel) || 0);
      if (b.inventoryGroup === 'salon_owned' || b.inventoryGroup === 'for_sale') {
        item.inventoryGroup = b.inventoryGroup;
        item.isRetail = b.inventoryGroup === 'for_sale';
      } else if (b.isRetail !== undefined) {
        item.isRetail = Boolean(b.isRetail);
        item.inventoryGroup = item.isRetail ? 'for_sale' : 'salon_owned';
      }
      if (b.sellingPrice !== undefined) {
        item.sellingPrice = item.isRetail ? Math.max(0, Number(b.sellingPrice) || 0) : 0;
      } else if (!item.isRetail) {
        item.sellingPrice = 0;
      }
      appendAuditLog(
        db,
        req.sessionUser!,
        'STOCK_ITEM_UPDATED',
        'StockItem',
        item.id,
        `Updated stock item ${item.name} (${item.isRetail ? 'Items for Sale' : 'Owned by Salon'}).`
      );
      writeDb(db);
      res.json({ item });
    }
  );

  router.delete(
    '/inventory/:id',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const index = db.stockItems.findIndex((s) => s.id === req.params.id);
      if (index === -1) {
        res.status(404).json({ error: 'Stock item not found.' });
        return;
      }
      const [removed] = db.stockItems.splice(index, 1);
      appendAuditLog(
        db,
        req.sessionUser!,
        'STOCK_ITEM_DELETED',
        'StockItem',
        removed.id,
        `Deleted stock item ${removed.name} (${removed.sku}, remaining qty: ${removed.currentQuantity} ${removed.unit}).`
      );
      writeDb(db);
      res.json({ deleted: true, id: removed.id, item: removed });
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
      if (delta < 0) {
        if (item.minStockLevel > 0 && item.currentQuantity < item.minStockLevel * 0.1) {
          db.notifications.unshift({
            id: makeId('NTF'),
            type: 'low_stock',
            title: 'Stock Low (<10% Reorder Level)',
            message: `CRITICAL: ${item.name} (${item.sku}) dropped to ${item.currentQuantity} ${item.unit}, below 10% of reorder level (${item.minStockLevel} ${item.unit}). Create a restock report.`,
            severity: 'alert',
            read: false,
            targetRoles: ['owner', 'manager'],
            createdAt: movement.createdAt,
          });
        } else if (item.currentQuantity <= item.minStockLevel) {
          db.notifications.unshift({
            id: makeId('NTF'),
            type: 'low_stock',
            title: 'Low Stock Alert',
            message: `${item.name} (${item.sku}) is at ${item.currentQuantity} ${item.unit} (reorder level: ${item.minStockLevel}).`,
            severity: 'warning',
            read: false,
            targetRoles: ['owner', 'manager'],
            createdAt: movement.createdAt,
          });
        }
      }
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
    '/inventory/restock-report',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const { scope } = (req.body || {}) as { scope?: 'critical' | 'all_low' };
      const activeItems = db.stockItems.filter((s) => s.active !== false);

      const flagged = activeItems
        .filter((item) => {
          const isCritical = item.minStockLevel > 0 && item.currentQuantity < item.minStockLevel * 0.1;
          if (scope === 'critical') return isCritical;
          return isCritical || item.currentQuantity <= item.minStockLevel;
        })
        .map((item) => {
          const isCriticalStockLow =
            item.minStockLevel > 0 && item.currentQuantity < item.minStockLevel * 0.1;
          const reorderPercent =
            item.minStockLevel > 0
              ? Math.round((item.currentQuantity / item.minStockLevel) * 100)
              : 100;
          const targetQuantity = Math.max(
            item.openingQuantity || 0,
            item.minStockLevel * 2,
            item.minStockLevel + 5
          );
          const suggestedOrderQty = Math.max(1, targetQuantity - item.currentQuantity);
          const estimatedCost = suggestedOrderQty * item.purchasePrice;
          const supplier = db.suppliers.find((s) => s.id === item.supplierId);
          return {
            stockItemId: item.id,
            sku: item.sku,
            name: item.name,
            category: item.category,
            brand: item.brand,
            unit: item.unit,
            currentQuantity: item.currentQuantity,
            reorderLevel: item.minStockLevel,
            reorderPercent,
            priority: isCriticalStockLow ? ('Stock Low (<10%)' as const) : ('Below Reorder' as const),
            suggestedOrderQty,
            unitPurchasePrice: item.purchasePrice,
            estimatedCost,
            supplierName: supplier?.name || item.supplierName || 'General Supplier',
            supplierPhone: supplier?.phone || '—',
          };
        })
        .sort((a, b) => a.reorderPercent - b.reorderPercent);

      if (flagged.length === 0) {
        res.status(400).json({ error: 'No inventory items currently fall below restock thresholds.' });
        return;
      }

      const criticalCount = flagged.filter((i) => i.priority === 'Stock Low (<10%)').length;
      const totalEstimatedCost = flagged.reduce((sum, i) => sum + i.estimatedCost, 0);
      const report = {
        id: makeId('RST'),
        generatedAt: new Date().toISOString(),
        generatedBy: req.sessionUser!.name,
        scope: scope || 'all_low',
        criticalCount,
        totalItems: flagged.length,
        totalEstimatedCost,
        items: flagged,
      };

      appendAuditLog(
        db,
        req.sessionUser!,
        'RESTOCK_REPORT_CREATED',
        'Inventory',
        report.id,
        `Generated restock report ${report.id} covering ${flagged.length} item(s) (${criticalCount} Stock Low <10% of reorder level), est. cost UGX ${totalEstimatedCost.toLocaleString('en-US')}.`
      );
      writeDb(db);
      res.status(201).json({ report });
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

      // Past 6 months revenue vs operational expenses ending at endDate's month
      const anchorYm = /^\d{4}-\d{2}/.test(endDate)
        ? endDate.slice(0, 7)
        : todayIsoDate().slice(0, 7);
      const [anchorYear, anchorMonth] = anchorYm.split('-').map(Number);
      const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthlyTrend: Array<{
        month: string;
        label: string;
        revenue: number;
        expenses: number;
        serviceRevenue: number;
        retailRevenue: number;
      }> = [];

      for (let offset = 5; offset >= 0; offset -= 1) {
        const dt = new Date(Date.UTC(anchorYear, anchorMonth - 1 - offset, 1));
        const y = dt.getUTCFullYear();
        const m = dt.getUTCMonth() + 1;
        const monthKey = `${y}-${String(m).padStart(2, '0')}`;
        const label = `${MONTH_NAMES[m - 1]} ${y}`;

        const monthTxs = db.posTransactions.filter(
          (t) =>
            t.date.slice(0, 7) === monthKey &&
            t.status !== 'Reversed' &&
            t.status !== 'Refunded' &&
            (!employeeFilter || t.items.some((i) => i.employeeId === employeeFilter))
        );

        let mServiceRev = 0;
        let mRetailRev = 0;
        for (const tx of monthTxs) {
          for (const item of tx.items) {
            if (employeeFilter && item.employeeId !== employeeFilter) continue;
            if (item.itemType === 'service') mServiceRev += item.lineTotal;
            else mRetailRev += item.lineTotal;
          }
        }
        const mRevenue = employeeFilter
          ? mServiceRev + mRetailRev
          : monthTxs.reduce((s, t) => s + t.totalAmount, 0);

        const mExpenses = db.expenses
          .filter((e) => e.date.slice(0, 7) === monthKey && e.status !== 'Rejected')
          .reduce((s, e) => s + e.amount, 0);

        monthlyTrend.push({
          month: monthKey,
          label,
          revenue: mRevenue,
          expenses: mExpenses,
          serviceRevenue: mServiceRev,
          retailRevenue: mRetailRev,
        });
      }

      res.json({
        period: { startDate, endDate },
        monthlyTrend,
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

      const result = importTabularSheetsIntoDb(db, sheets, {
        fileName,
        actorName: req.sessionUser!.name,
        actorUserId: req.sessionUser!.userId,
        actorRole: req.sessionUser!.role,
        sourceKind: 'excel',
        createBackupFn: createBackupSnapshot,
      });

      writeDb(db);
      res.json({
        ok: true,
        backupId: result.backupId,
        importedCount: result.importedCount,
        skippedDuplicates: result.skippedDuplicates,
        sheetsImported: result.sheetsImported,
        tabSummaries: result.tabSummaries,
      });
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
  async function resolveGoogleToken(req: express.Request): Promise<string | undefined> {
    const headerToken = req.headers['x-google-token']?.toString()?.trim();
    if (headerToken) return headerToken;
    const serverToken = await getServerGoogleAccessToken();
    return serverToken || undefined;
  }

  function resolveBridge(db: SalonDatabase): string | undefined {
    return getAppsScriptBridgeUrl(db.settings.googleAppsScriptUrl);
  }

  router.get(
    '/workspace/status',
    requireAuth,
    requireRole(['owner', 'manager']),
    (_req, res) => {
      const db = readDb();
      const resolvedBridge = resolveBridge(db) || '';
      const resolvedSheetId =
        db.settings.googleSpreadsheetId || process.env.GOOGLE_SPREADSHEET_ID?.trim() || '';
      const resolvedDriveId =
        db.settings.googleDriveFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || '';
      const serverCreds = getServerGoogleCredentialsStatus(db.settings.googleAppsScriptUrl);
      res.json({
        platform: process.env.VERCEL ? 'vercel' : IS_SERVERLESS ? 'serverless' : 'node',
        serverCredentialsConfigured: serverCreds.configured,
        serverCredentialMode: serverCreds.mode,
        appsScriptConfigured: Boolean(resolvedBridge),
        appsScriptUrl: resolvedBridge,
        envSpreadsheetConfigured: Boolean(process.env.GOOGLE_SPREADSHEET_ID?.trim()),
        envDriveFolderConfigured: Boolean(process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()),
        linkedSpreadsheetId: resolvedSheetId,
        linkedSpreadsheetUrl:
          db.settings.googleSpreadsheetUrl ||
          (resolvedSheetId ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit` : ''),
        linkedDriveFolderId: resolvedDriveId,
        lastSheetsSyncAt: db.settings.lastSheetsSyncAt || '',
      });
    }
  );

  function extractGoogleSheetId(raw: string): string {
    const trimmed = raw.trim();
    const match = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(trimmed);
    return match ? match[1] : trimmed;
  }

  function extractGoogleDriveFolderId(raw: string): string {
    const trimmed = raw.trim();
    const match = /\/folders\/([a-zA-Z0-9_-]+)/.exec(trimmed);
    return match ? match[1] : trimmed;
  }

  router.post(
    '/workspace/sheets/link',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const { spreadsheetId, driveFolderId, googleAppsScriptUrl } = req.body as {
        spreadsheetId?: string;
        driveFolderId?: string;
        googleAppsScriptUrl?: string;
      };
      const db = readDb();
      if (spreadsheetId !== undefined) {
        const cleanId = extractGoogleSheetId(spreadsheetId);
        db.settings.googleSpreadsheetId = cleanId || undefined;
        db.settings.googleSpreadsheetUrl = cleanId
          ? `https://docs.google.com/spreadsheets/d/${cleanId}/edit`
          : undefined;
      }
      if (driveFolderId !== undefined) {
        const cleanFolder = extractGoogleDriveFolderId(driveFolderId);
        db.settings.googleDriveFolderId = cleanFolder || undefined;
      }
      if (googleAppsScriptUrl !== undefined) {
        const cleanScriptUrl = googleAppsScriptUrl.trim();
        db.settings.googleAppsScriptUrl = cleanScriptUrl || undefined;
      }

      let testInfo: { spreadsheetId: string; spreadsheetUrl: string; rootFolderId: string } | undefined;
      const bridgeUrl = resolveBridge(db);
      if (googleAppsScriptUrl && bridgeUrl) {
        try {
          testInfo = await testAppsScriptBridge(bridgeUrl, db.settings.googleSpreadsheetId);
          if (
            db.settings.googleSpreadsheetId &&
            testInfo.spreadsheetId &&
            testInfo.spreadsheetId !== db.settings.googleSpreadsheetId
          ) {
            res.status(400).json({
              error: `That Apps Script URL is bound to another Google Sheet (${testInfo.spreadsheetId}) instead of your linked sheet (${db.settings.googleSpreadsheetId}). Open sheet ${db.settings.googleSpreadsheetId} → Extensions → Apps Script, paste the updated Code.gs below, deploy as Web app (Who has access: Anyone), and paste the new /exec URL.`,
            });
            return;
          }
          if (!db.settings.googleSpreadsheetId && testInfo.spreadsheetId) {
            db.settings.googleSpreadsheetId = testInfo.spreadsheetId;
          }
          if (!db.settings.googleSpreadsheetUrl && testInfo.spreadsheetUrl) {
            db.settings.googleSpreadsheetUrl = testInfo.spreadsheetUrl;
          }
          if (testInfo.rootFolderId && !db.settings.googleDriveFolderId) {
            db.settings.googleDriveFolderId = testInfo.rootFolderId;
          }
        } catch (err) {
          res.status(400).json({
            error:
              err instanceof Error
                ? `Apps Script URL check failed: ${err.message}`
                : 'Apps Script Web App check failed.',
          });
          return;
        }
      }

      appendAuditLog(
        db,
        req.sessionUser!,
        'GOOGLE_WORKSPACE_LINKED',
        'Settings',
        db.settings.googleSpreadsheetId || db.settings.googleDriveFolderId || 'WORKSPACE',
        `Updated Google Workspace links (Sheet: ${db.settings.googleSpreadsheetId || 'none'}, Drive: ${db.settings.googleDriveFolderId || 'none'}, Apps Script: ${db.settings.googleAppsScriptUrl ? 'configured' : 'none'}).`
      );
      writeDb(db);
      res.json({
        spreadsheetId: db.settings.googleSpreadsheetId || '',
        spreadsheetUrl: db.settings.googleSpreadsheetUrl || '',
        driveFolderId: db.settings.googleDriveFolderId || '',
        googleAppsScriptUrl: db.settings.googleAppsScriptUrl || '',
        verified: Boolean(testInfo),
      });
    }
  );

  router.post(
    '/workspace/apps-script/test',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const candidateUrl = (req.body.url as string | undefined)?.trim() || resolveBridge(db);
      if (!candidateUrl) {
        res.status(400).json({ error: 'Provide your deployed Apps Script Web App URL first.' });
        return;
      }
      try {
        const info = await testAppsScriptBridge(candidateUrl, db.settings.googleSpreadsheetId);
        if (
          db.settings.googleSpreadsheetId &&
          info.spreadsheetId &&
          info.spreadsheetId !== db.settings.googleSpreadsheetId
        ) {
          res.status(400).json({
            error: `That Apps Script URL is still bound to sheet ${info.spreadsheetId} instead of your linked sheet (${db.settings.googleSpreadsheetId}). Open sheet ${db.settings.googleSpreadsheetId} → Extensions → Apps Script, paste Code.gs below, deploy a new Web app (Who has access: Anyone), and paste the new /exec URL here.`,
          });
          return;
        }
        db.settings.googleAppsScriptUrl = candidateUrl;
        if (!db.settings.googleSpreadsheetId && info.spreadsheetId) {
          db.settings.googleSpreadsheetId = info.spreadsheetId;
        }
        if (!db.settings.googleSpreadsheetUrl && info.spreadsheetUrl) {
          db.settings.googleSpreadsheetUrl = info.spreadsheetUrl;
        }
        if (info.rootFolderId && !db.settings.googleDriveFolderId) {
          db.settings.googleDriveFolderId = info.rootFolderId;
        }
        writeDb(db);
        res.json({ ...info, ok: true, googleAppsScriptUrl: candidateUrl });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Apps Script connection failed.',
        });
      }
    }
  );

  router.post(
    '/workspace/sheets/unlink',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      db.settings.googleSpreadsheetId = undefined;
      db.settings.googleSpreadsheetUrl = undefined;
      db.settings.lastSheetsSyncAt = undefined;
      if (req.body?.clearAppsScript) {
        db.settings.googleAppsScriptUrl = undefined;
      }
      appendAuditLog(
        db,
        req.sessionUser!,
        'GOOGLE_SHEET_UNLINKED',
        'Settings',
        'UNLINK',
        'Unlinked previous Google Spreadsheet so the salon can connect a fresh sheet.'
      );
      writeDb(db);
      res.json({ ok: true });
    }
  );

  router.post(
    '/workspace/sheets/create',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = await resolveGoogleToken(req);
      let db = readDb();
      const bridgeUrl = resolveBridge(db);
      const useAppsScript = Boolean(bridgeUrl && !req.headers['x-google-token']);

      if (!token && !useAppsScript) {
        res.status(401).json({
          error: 'Connect Google Workspace or link an Apps Script Web App URL first.',
        });
        return;
      }

      try {
        if (req.body?.resetClean) {
          createBackupSnapshot(db, 'Backup Before Starting Fresh Google Sheet', req.sessionUser!.name);
          const fresh = createInitialDatabase();
          fresh.users = db.users;
          fresh.settings = { ...db.settings };
          fresh.backups = db.backups;
          db = fresh;
        }

        const result =
          useAppsScript && bridgeUrl
            ? await createNewSheetViaAppsScript(bridgeUrl, db, req.body?.title)
            : await createSalonGoogleSpreadsheet(token!, db);

        db.settings.googleSpreadsheetId = result.spreadsheetId;
        db.settings.googleSpreadsheetUrl = result.spreadsheetUrl;
        db.settings.lastSheetsSyncAt = new Date().toISOString();
        if (
          'rootFolderId' in result &&
          typeof result.rootFolderId === 'string' &&
          result.rootFolderId &&
          !db.settings.googleDriveFolderId
        ) {
          db.settings.googleDriveFolderId = result.rootFolderId;
        }
        appendAuditLog(
          db,
          req.sessionUser!,
          'GOOGLE_SHEET_CREATED',
          'Settings',
          result.spreadsheetId,
          `Created & populated new Google Sheet database (${result.sheetCount} tabs).`
        );
        writeDb(db);
        markDbCleanFromCloudSync();
        res.json(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google Sheets creation failed.';
        if (msg.includes('Unknown action: createNewSheet')) {
          res.status(400).json({
            error:
              'Your currently deployed Code.gs is an older version bound to the old sheet. To start with a brand-new sheet: open sheets.new, paste the updated Code.gs below into Extensions → Apps Script, click Deploy → New deployment → Web app ("Who has access: Anyone"), and paste the new /exec URL here.',
          });
          return;
        }
        res.status(500).json({ error: msg });
      }
    }
  );

  router.post(
    '/workspace/sheets/sync',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      const spreadsheetId = (req.body.spreadsheetId as string) || db.settings.googleSpreadsheetId;

      if (bridgeUrl && !req.headers['x-google-token']) {
        try {
          const syncTargetDb = spreadsheetId && spreadsheetId !== db.settings.googleSpreadsheetId
            ? { ...db, settings: { ...db.settings, googleSpreadsheetId: spreadsheetId } }
            : db;
          const result = await syncDatabaseViaAppsScript(bridgeUrl, syncTargetDb);
          if (
            spreadsheetId &&
            result.spreadsheetId &&
            result.spreadsheetId !== spreadsheetId
          ) {
            res.status(400).json({
              error: `Your deployed Apps Script URL wrote to ${result.spreadsheetId} instead of your linked sheet (${spreadsheetId}). Open sheet ${spreadsheetId} → Extensions → Apps Script, deploy the updated Code.gs, and link that /exec URL.`,
            });
            return;
          }
          if (!db.settings.googleSpreadsheetId && result.spreadsheetId) {
            db.settings.googleSpreadsheetId = result.spreadsheetId;
          }
          if (!db.settings.googleSpreadsheetUrl && result.spreadsheetUrl) {
            db.settings.googleSpreadsheetUrl = result.spreadsheetUrl;
          }
          db.settings.lastSheetsSyncAt = new Date().toISOString();
          appendAuditLog(
            db,
            req.sessionUser!,
            'GOOGLE_SHEETS_SYNCED',
            'Settings',
            db.settings.googleSpreadsheetId || 'APPS_SCRIPT',
            `Synced ${result.updatedCells} cells across ${result.sheetTabs.length} tabs via Apps Script bridge.`
          );
          writeDb(db);
          markDbCleanFromCloudSync();
          res.json({ ...result, lastSheetsSyncAt: db.settings.lastSheetsSyncAt });
          return;
        } catch (err) {
          res.status(500).json({ error: err instanceof Error ? err.message : 'Apps Script sync failed.' });
          return;
        }
      }

      if (!token) {
        res.status(401).json({
          error: 'Connect Google Workspace or save an Apps Script Web App URL in Settings first.',
        });
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
        markDbCleanFromCloudSync();
        res.json({ ...result, lastSheetsSyncAt: db.settings.lastSheetsSyncAt });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Google Sheets sync failed.' });
      }
    }
  );

  router.post(
    '/workspace/sheets/restore',
    requireAuth,
    requireRole(['owner']),
    async (req: AuthenticatedRequest, res) => {
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      const spreadsheetId = (req.body.spreadsheetId as string)?.trim() || db.settings.googleSpreadsheetId;

      if (bridgeUrl && !req.headers['x-google-token']) {
        try {
          const remote = await readDatabaseViaAppsScript(bridgeUrl, spreadsheetId);
          if (
            spreadsheetId &&
            remote.spreadsheetId &&
            remote.spreadsheetId !== spreadsheetId
          ) {
            res.status(400).json({
              error: `Apps Script URL points to ${remote.spreadsheetId} instead of your linked sheet (${spreadsheetId}).`,
            });
            return;
          }
          if (!remote.db) {
            res.status(404).json({
              error: 'No _SystemState database snapshot was found in the Google Sheet yet. Sync to Google Sheets first.',
            });
            return;
          }
          createBackupSnapshot(db, 'Pre-Sheets-Restore Snapshot', req.sessionUser!.name);
          remote.db.settings.googleAppsScriptUrl = bridgeUrl;
          if (!remote.db.settings.googleSpreadsheetId && (spreadsheetId || remote.spreadsheetId)) {
            remote.db.settings.googleSpreadsheetId = spreadsheetId || remote.spreadsheetId;
          }
          if (remote.spreadsheetUrl) remote.db.settings.googleSpreadsheetUrl = remote.spreadsheetUrl;
          remote.db.settings.lastSheetsSyncAt = new Date().toISOString();
          appendAuditLog(
            remote.db,
            req.sessionUser!,
            'GOOGLE_SHEETS_RESTORED',
            'SalonDatabase',
            remote.spreadsheetId || 'APPS_SCRIPT',
            'Restored full salon database from Google Sheets via Apps Script bridge.'
          );
          writeDb(remote.db);
          markDbCleanFromCloudSync();
          res.json({
            ok: true,
            spreadsheetId: remote.db.settings.googleSpreadsheetId || '',
            restoredAt: remote.db.settings.lastSheetsSyncAt,
          });
          return;
        } catch (err) {
          res.status(500).json({ error: err instanceof Error ? err.message : 'Apps Script restore failed.' });
          return;
        }
      }

      if (!token) {
        res.status(401).json({
          error: 'Connect Google Workspace or configure your Apps Script Web App URL first.',
        });
        return;
      }
      if (!spreadsheetId) {
        res.status(400).json({ error: 'No Google Spreadsheet ID linked to restore from.' });
        return;
      }
      try {
        const restored = await readDatabaseFromGoogleSheet(token, spreadsheetId);
        if (!restored) {
          res.status(404).json({
            error: 'No _SystemState database snapshot was found in that Google Sheet. Sync to Google Sheets at least once first.',
          });
          return;
        }
        createBackupSnapshot(db, 'Pre-Sheets-Restore Snapshot', req.sessionUser!.name);
        restored.settings.googleSpreadsheetId = spreadsheetId;
        restored.settings.lastSheetsSyncAt = new Date().toISOString();
        appendAuditLog(
          restored,
          req.sessionUser!,
          'GOOGLE_SHEETS_RESTORED',
          'SalonDatabase',
          spreadsheetId,
          `Restored full salon database from Google Sheets (${spreadsheetId}).`
        );
        writeDb(restored);
        markDbCleanFromCloudSync();
        res.json({ ok: true, spreadsheetId, restoredAt: restored.settings.lastSheetsSyncAt });
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to restore from Google Sheets.' });
      }
    }
  );

  router.get('/workspace/sheets/read', requireAuth, async (req: AuthenticatedRequest, res) => {
    const token = await resolveGoogleToken(req);
    const db = readDb();
    const bridgeUrl = resolveBridge(db);
    const spreadsheetId = (req.query.spreadsheetId as string) || db.settings.googleSpreadsheetId;
    const tab = req.query.tab as string | undefined;

    if (bridgeUrl && !req.headers['x-google-token']) {
      try {
        const data = await readGoogleSheetTabViaAppsScript(bridgeUrl, tab, spreadsheetId);
        res.json(data);
        return;
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read Sheet via Apps Script.' });
        return;
      }
    }

    if (!token || !spreadsheetId) {
      res.status(400).json({ error: 'Google connection (or Apps Script URL) and Spreadsheet ID are required.' });
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
    '/workspace/sheets/inspect-workbook',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      const spreadsheetId = (req.body.spreadsheetId as string)?.trim() || db.settings.googleSpreadsheetId;

      if (!token && !(bridgeUrl && !req.headers['x-google-token'])) {
        res.status(401).json({
          error: 'Connect Google Workspace or link an Apps Script Web App URL first.',
        });
        return;
      }

      try {
        const wb =
          bridgeUrl && !req.headers['x-google-token']
            ? await readWorkbookViaAppsScript(bridgeUrl, spreadsheetId)
            : await readWorkbookFromGoogleSheet(token!, spreadsheetId!);

        if (wb.spreadsheetId && !db.settings.googleSpreadsheetId) {
          db.settings.googleSpreadsheetId = wb.spreadsheetId;
          if (wb.spreadsheetUrl) db.settings.googleSpreadsheetUrl = wb.spreadsheetUrl;
          writeDb(db);
        }

        const tabs = wb.tabSummaries
          .filter((t) => t.name !== '_SystemState')
          .map((t) => {
            const rows = wb.sheets[t.name] || [];
            const detectedType = detectSheetEntity(t.name, rows);
            return {
              name: t.name,
              rowCount: t.rowCount,
              headers: t.headers,
              detectedType,
            };
          });

        res.json({
          ok: true,
          spreadsheetId: wb.spreadsheetId || spreadsheetId || '',
          spreadsheetUrl: wb.spreadsheetUrl || db.settings.googleSpreadsheetUrl || '',
          hasSystemState: wb.hasSystemState,
          tabs,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to scan Google Sheet tabs.',
        });
      }
    }
  );

  router.post(
    '/workspace/sheets/import-legacy',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      const spreadsheetId = (req.body.spreadsheetId as string)?.trim() || db.settings.googleSpreadsheetId;
      const targetTabs = Array.isArray(req.body.tabs) ? (req.body.tabs as string[]) : undefined;

      if (!token && !(bridgeUrl && !req.headers['x-google-token'])) {
        res.status(401).json({
          error: 'Connect Google Workspace or link an Apps Script Web App URL first.',
        });
        return;
      }

      try {
        const wb =
          bridgeUrl && !req.headers['x-google-token']
            ? await readWorkbookViaAppsScript(bridgeUrl, spreadsheetId)
            : await readWorkbookFromGoogleSheet(token!, spreadsheetId!);

        if (!db.settings.googleSpreadsheetId && wb.spreadsheetId) db.settings.googleSpreadsheetId = wb.spreadsheetId;
        if (!db.settings.googleSpreadsheetUrl && wb.spreadsheetUrl) db.settings.googleSpreadsheetUrl = wb.spreadsheetUrl;

        const result = importTabularSheetsIntoDb(db, wb.sheets, {
          fileName: `Google Sheet (${wb.spreadsheetId || spreadsheetId || 'Linked'})`,
          actorName: req.sessionUser!.name,
          actorUserId: req.sessionUser!.userId,
          actorRole: req.sessionUser!.role,
          sourceKind: 'google_sheet',
          createBackupFn: createBackupSnapshot,
          targetTabs,
        });

        writeDb(db);
        res.json({
          ok: true,
          backupId: result.backupId,
          importedCount: result.importedCount,
          skippedDuplicates: result.skippedDuplicates,
          sheetsImported: result.sheetsImported,
          tabSummaries: result.tabSummaries,
        });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Failed to import records from old Google Sheet.',
        });
      }
    }
  );

  router.post(
    '/workspace/drive/backup',
    requireAuth,
    requireRole(['owner', 'manager']),
    async (req: AuthenticatedRequest, res) => {
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      if (!token && !bridgeUrl) {
        res.status(401).json({
          error: 'Connect Google Workspace or configure an Apps Script Web App URL first.',
        });
        return;
      }
      try {
        const label = (req.body.label as string) || 'Manual Cloud Backup';
        const file =
          bridgeUrl && !req.headers['x-google-token']
            ? await backupDatabaseViaAppsScript(bridgeUrl, db, label)
            : await backupDatabaseToGoogleDrive(token!, db, label);
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
    const token = await resolveGoogleToken(req);
    const db = readDb();
    const bridgeUrl = resolveBridge(db);
    if (!token && !bridgeUrl) {
      res.status(401).json({ error: 'Google Workspace token or Apps Script URL missing.' });
      return;
    }
    try {
      const list =
        bridgeUrl && !req.headers['x-google-token']
          ? await listDriveFilesViaAppsScript(bridgeUrl)
          : await listAppDriveFiles(token!);
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
      const empId = resolveEmployeeForUser(db, user)?.id || user.employeeId || '';
      documents = empId
        ? documents.filter(
            (d) =>
              d.relatedEmployeeId === empId &&
              (d.category === 'Employee Photo' || d.category === 'National ID' || d.category === 'Staff Contract')
          )
        : [];
    }

    let driveFiles: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      size?: string;
      webViewLink?: string;
    }> = [];
    const token = await resolveGoogleToken(req);
    const bridgeUrl = resolveBridge(db);
    if (['owner', 'manager'].includes(user.role)) {
      try {
        if (bridgeUrl && !req.headers['x-google-token']) {
          const listed = await listDriveFilesViaAppsScript(bridgeUrl);
          driveFiles = listed.files;
        } else if (token) {
          const listed = await listAppDriveFiles(token);
          driveFiles = listed.files;
        }
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
      const token = await resolveGoogleToken(req);
      const preDb = readDb();
      const bridgeUrl = resolveBridge(preDb);
      const useAppsScript = Boolean(bridgeUrl && !req.headers['x-google-token']);
      if (!token && !useAppsScript) {
        res.status(401).json({
          error: 'Connect Google Workspace or configure your Apps Script Web App URL first.',
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
        const cleanName = fileName.trim().replace(/[\\/]/g, '_');
        const desc = `${safeCategory}${notes ? ` — ${notes.trim()}` : ''} (Trendy Unisex Salon)`;
        let rootFolderId: string;
        let folderName: string;
        let uploaded: { id: string; name: string; mimeType: string; sizeBytes: number; webViewLink?: string };

        if (useAppsScript && bridgeUrl) {
          const up = await uploadBinaryViaAppsScript(bridgeUrl, {
            fileName: cleanName,
            mimeType: parsed.mimeType,
            buffer: parsed.buffer,
            category: safeCategory,
            description: desc,
          });
          rootFolderId = up.rootFolderId;
          folderName = up.folderName;
          uploaded = up.file;
        } else {
          const folderRes = await ensureCategoryDriveFolder(
            token!,
            safeCategory,
            db.settings.googleDriveFolderId
          );
          rootFolderId = folderRes.rootFolderId;
          folderName = folderRes.folderName;
          uploaded = await uploadBinaryToGoogleDrive(token!, {
            fileName: cleanName,
            mimeType: parsed.mimeType,
            buffer: parsed.buffer,
            folderId: folderRes.folderId,
            description: desc,
          });
        }
        db.settings.googleDriveFolderId = rootFolderId;

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
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      if (!token && !bridgeUrl) {
        res.status(401).json({
          error: 'Connect Google Workspace or configure an Apps Script Web App URL first.',
        });
        return;
      }

      const effectiveToken = bridgeUrl && !req.headers['x-google-token'] ? undefined : token;
      let syncedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];

      for (const emp of db.employees) {
        if (emp.avatarUrl?.startsWith('data:') && !emp.avatarDriveFileId) {
          try {
            const up = await uploadEmployeeDataUrlToDrive(
              effectiveToken,
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
              effectiveToken,
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
              effectiveToken,
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
    token: string | undefined,
    db: SalonDatabase,
    kind: 'logo' | 'trading_licence',
    dataUrl: string,
    uploadedBy: string
  ): Promise<{ fileId: string; webViewLink?: string }> {
    const { mimeType, buffer } = parseDataUrl(dataUrl);
    const category: DriveDocumentCategory = kind === 'logo' ? 'Salon Media' : 'Trading Licence';
    const ext = fileExtensionFromMime(mimeType);
    const fileName =
      kind === 'logo'
        ? `Trendy_Unisex_Salon_Logo.${ext}`
        : `Trendy_Unisex_Salon_Trading_Licence${db.settings.tradingLicenceNumber ? `_${db.settings.tradingLicenceNumber.replace(/[^a-zA-Z0-9_-]+/g, '_')}` : ''}.${ext}`;
    const description =
      kind === 'logo'
        ? 'Official Trendy Unisex Salon Logo'
        : `Official Salon Trading Licence${db.settings.tradingLicenceNumber ? ` (${db.settings.tradingLicenceNumber})` : ''}`;

    const bridgeUrl = resolveBridge(db);
    let folderName: string;
    let uploaded: { id: string; name: string; mimeType: string; sizeBytes: number; webViewLink?: string };

    if (!token && bridgeUrl) {
      const up = await uploadBinaryViaAppsScript(bridgeUrl, {
        fileName,
        mimeType,
        buffer,
        category,
        description,
      });
      db.settings.googleDriveFolderId = up.rootFolderId;
      folderName = up.folderName;
      uploaded = up.file;
    } else if (token) {
      const folderRes = await ensureCategoryDriveFolder(
        token,
        category,
        db.settings.googleDriveFolderId
      );
      db.settings.googleDriveFolderId = folderRes.rootFolderId;
      folderName = folderRes.folderName;
      uploaded = await uploadBinaryToGoogleDrive(token, {
        fileName,
        mimeType,
        buffer,
        folderId: folderRes.folderId,
        description,
      });
    } else {
      throw new Error('No Google Workspace token or Apps Script bridge URL configured.');
    }

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
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      if (!token && !bridgeUrl) {
        res.status(401).json({
          error: 'Connect Google Workspace or configure an Apps Script Web App URL first.',
        });
        return;
      }

      const effectiveToken = bridgeUrl && !req.headers['x-google-token'] ? undefined : token;
      let syncedCount = 0;
      const errors: string[] = [];

      if (db.settings.salonLogoUrl?.startsWith('data:') && !db.settings.salonLogoDriveFileId) {
        try {
          const up = await uploadSalonAssetToDrive(
            effectiveToken,
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
            effectiveToken,
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

    const token = await resolveGoogleToken(req);
    const bridgeUrl = resolveBridge(db);
    const useAppsScript = Boolean(bridgeUrl && !req.headers['x-google-token']);
    if (!token && !useAppsScript) {
      res.status(401).json({
        error: 'Google Workspace connection or Apps Script Web App URL required to preview Drive files.',
      });
      return;
    }

    try {
      const media =
        useAppsScript && bridgeUrl
          ? await fetchDriveMediaViaAppsScript(bridgeUrl, fileId)
          : await fetchGoogleDriveFileMedia(token!, fileId);
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
      const token = await resolveGoogleToken(req);
      const db = readDb();
      const bridgeUrl = resolveBridge(db);
      const useAppsScript = Boolean(bridgeUrl && !req.headers['x-google-token']);
      if (!token && !useAppsScript) {
        res.status(401).json({
          error: 'Google Workspace connection or Apps Script Web App URL required to delete files from Drive.',
        });
        return;
      }

      const fileId = req.params.fileId;
      try {
        if (useAppsScript && bridgeUrl) {
          await deleteDriveFileViaAppsScript(bridgeUrl, fileId);
        } else {
          await deleteGoogleDriveFile(token!, fileId);
        }
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
      driveFolderId: db.settings.googleDriveFolderId || '',
      code: generateAppsScriptCode(db.settings.googleSpreadsheetId, db.settings.googleDriveFolderId),
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
    if (!name?.trim() || !email?.trim() || !password) {
      res.status(400).json({ error: 'Name, email, and password are required.' });
      return;
    }
    const pwPolicy = validatePasswordPolicy(password);
    if (!pwPolicy.isValid) {
      res.status(400).json({ error: pwPolicy.errorMessage || 'Password does not meet security requirements.' });
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
    const requestedEmpId = typeof employeeId === 'string' ? employeeId.trim() : '';
    let resolvedEmpId: string | undefined;
    if (requestedEmpId) {
      const targetEmp = db.employees.find((e) => e.id === requestedEmpId);
      if (!targetEmp) {
        res.status(404).json({ error: 'Selected employee profile was not found.' });
        return;
      }
      const alreadyLinked = db.users.find((u) => u.employeeId === targetEmp.id);
      if (alreadyLinked) {
        res.status(409).json({
          error: `Employee profile "${targetEmp.fullName}" is already linked to ${alreadyLinked.email}.`,
        });
        return;
      }
      resolvedEmpId = targetEmp.id;
    } else if (targetRole === 'employee') {
      const autoMatched = resolveEmployeeForUser(db, { email, name });
      if (autoMatched && !db.users.some((u) => u.employeeId === autoMatched.id)) {
        resolvedEmpId = autoMatched.id;
      }
    }
    const newUser = {
      id: makeId('USR'),
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: targetRole,
      employeeId: resolvedEmpId,
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
      `Created user ${newUser.email} with role ${newUser.role}${resolvedEmpId ? ` (linked to ${resolvedEmpId})` : ''}.`
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
        employeeId?: string | null;
      };

      if (actor.role === 'manager') {
        if (target.role === 'owner') {
          res.status(403).json({
            error: 'Managers cannot modify Owner / Admin user accounts.',
          });
          return;
        }
        if (
          body.role !== undefined ||
          body.name !== undefined ||
          body.password !== undefined ||
          body.active === true
        ) {
          res.status(403).json({
            error:
              'Managers can only link employee profiles to created non-owner users or disable active employee accounts. Editing roles, names, passwords, or re-enabling accounts requires Owner / Admin permissions.',
          });
          return;
        }
        if (body.active === false && target.role !== 'employee') {
          res.status(403).json({
            error:
              'Managers can only disable employee accounts. Other user accounts require Owner / Admin permissions.',
          });
          return;
        }
        if (body.active === undefined && body.employeeId === undefined) {
          res.status(400).json({ error: 'No valid update fields were provided.' });
          return;
        }
      }

      let nextEmployeeId: string | null | undefined;
      let linkedEmployeeName: string | undefined;
      if (body.employeeId !== undefined) {
        const trimmedEmpId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
        if (!trimmedEmpId) {
          nextEmployeeId = null;
        } else {
          const emp = db.employees.find((e) => e.id === trimmedEmpId);
          if (!emp) {
            res.status(404).json({ error: 'Selected employee profile was not found.' });
            return;
          }
          const conflictingUser = db.users.find(
            (u) => u.id !== target.id && u.employeeId === emp.id
          );
          if (conflictingUser) {
            res.status(409).json({
              error: `Employee profile "${emp.fullName}" is already linked to ${conflictingUser.email}. Unlink it there first or choose another profile.`,
            });
            return;
          }
          nextEmployeeId = emp.id;
          linkedEmployeeName = emp.fullName;
        }
      }

      if (actor.role === 'manager') {
        const changes: string[] = [];
        if (body.active === false && target.active) {
          target.active = false;
          changes.push(`disabled employee account ${target.email}`);
        }
        if (nextEmployeeId !== undefined) {
          target.employeeId = nextEmployeeId || undefined;
          changes.push(
            nextEmployeeId
              ? `linked employee profile "${linkedEmployeeName}" (${nextEmployeeId}) to ${target.email}`
              : `unlinked employee profile from ${target.email}`
          );
        }

        appendAuditLog(
          db,
          actor,
          nextEmployeeId !== undefined && body.active === undefined
            ? nextEmployeeId
              ? 'USER_PROFILE_LINKED'
              : 'USER_PROFILE_UNLINKED'
            : 'USER_DISABLED_BY_MANAGER',
          'User',
          target.id,
          `Manager ${changes.join(' and ') || `updated ${target.email}`}.`
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
      if (nextEmployeeId !== undefined) {
        target.employeeId = nextEmployeeId || undefined;
      }
      if (body.password !== undefined && String(body.password).length > 0) {
        const pwPolicy = validatePasswordPolicy(String(body.password));
        if (!pwPolicy.isValid) {
          res.status(400).json({ error: pwPolicy.errorMessage || 'Password does not meet security requirements.' });
          return;
        }
        target.passwordHash = hashPassword(String(body.password));
      }
      const profileNote =
        nextEmployeeId !== undefined
          ? nextEmployeeId
            ? `, linkedProfile=${linkedEmployeeName} (${nextEmployeeId})`
            : ', linkedProfile=none'
          : '';
      appendAuditLog(
        db,
        actor,
        nextEmployeeId !== undefined &&
          body.active === undefined &&
          body.role === undefined &&
          body.name === undefined &&
          body.password === undefined
          ? nextEmployeeId
            ? 'USER_PROFILE_LINKED'
            : 'USER_PROFILE_UNLINKED'
          : 'USER_UPDATED',
        'User',
        target.id,
        `Updated user ${target.email} (active=${target.active}, role=${target.role}${profileNote}).`
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
      audienceTagline: db.settings.audienceTagline || 'For Him · For Her · For Everyone',
      location: db.settings.location,
      phone: db.settings.phone || '0740301726',
      socialHandle: db.settings.socialHandle || '@Trendyunisex.salon',
      socialPlatforms: db.settings.socialPlatforms || ['TikTok', 'Instagram', 'Facebook'],
      walkInsWelcome: db.settings.walkInsWelcome ?? true,
      promotionalBannerUrl:
        db.settings.promotionalBannerUrl || '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg',
      backgroundImageUrl:
        db.settings.backgroundImageUrl ||
        '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg',
      salonLogoUrl: db.settings.salonLogoUrl || '',
    });
  });

  // ==================== PUBLIC CLIENT BOOKING PORTAL ====================
  const STANDARD_BOOKING_SLOTS = [
    '08:00',
    '08:30',
    '09:00',
    '09:30',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
    '12:30',
    '13:00',
    '13:30',
    '14:00',
    '14:30',
    '15:00',
    '15:30',
    '16:00',
    '16:30',
    '17:00',
    '17:30',
    '18:00',
    '18:30',
    '19:00',
    '19:30',
    '20:00',
  ];

  function isStylistFreeAtSlot(
    db: SalonDatabase,
    employeeId: string,
    date: string,
    startTime: string,
    durationMinutes: number
  ): { free: boolean; reason?: string } {
    const emp = db.employees.find(
      (e) => e.id === employeeId && e.active && resolveEmployeeStatus(e) === 'Active'
    );
    if (!emp) {
      return { free: false, reason: 'Stylist unavailable' };
    }
    const dayOff = db.schedules.find(
      (s) => s.employeeId === employeeId && s.date === date && s.isDayOff
    );
    if (dayOff) {
      return { free: false, reason: 'Day Off' };
    }
    const newStart = timeToMinutes(startTime);
    const newEnd = newStart + Math.max(15, durationMinutes);
    const conflict = db.appointments.find((a) => {
      if (a.employeeId !== employeeId || a.date !== date) return false;
      if (['Cancelled', 'No Show', 'Completed'].includes(a.status)) return false;
      const existStart = timeToMinutes(a.startTime);
      const existEnd = existStart + a.durationMinutes;
      return newStart < existEnd && newEnd > existStart;
    });
    if (conflict) {
      return { free: false, reason: 'Booked' };
    }
    return { free: true };
  }

  router.get('/public/booking-catalog', (_req, res) => {
    const db = readDb();
    const activeStylists = db.employees
      .filter((e) => e.active && resolveEmployeeStatus(e) === 'Active')
      .map((e) => ({
        id: e.id,
        fullName: e.fullName,
        roleTitle: e.roleTitle,
        specialties: e.specialties,
        avatarUrl: e.avatarUrl || '',
        workingDays: e.workingDays,
        defaultShiftStart: e.defaultShiftStart,
        defaultShiftEnd: e.defaultShiftEnd,
      }));

    res.json({
      branding: {
        businessName: db.settings.businessName,
        tagline: db.settings.tagline,
        audienceTagline: db.settings.audienceTagline || 'For Him · For Her · For Everyone',
        location: db.settings.location,
        phone: db.settings.phone || '0740301726',
        socialHandle: db.settings.socialHandle || '@Trendyunisex.salon',
        socialPlatforms: db.settings.socialPlatforms || ['TikTok', 'Instagram', 'Facebook'],
        walkInsWelcome: db.settings.walkInsWelcome ?? true,
        promotionalBannerUrl:
          db.settings.promotionalBannerUrl || '/assets/aistudio/LADY_JOAN_BEAUTY___BARBER_LOUNGE_dcf44bc3.jpg',
        backgroundImageUrl:
          db.settings.backgroundImageUrl ||
          '/assets/aistudio/___Kang_Huda_Official_11_Oct_09_51.__iPhone_17_-_Auto_By_Kang_Huda_Official___93bd0b34.jpg',
        salonLogoUrl: db.settings.salonLogoUrl || '',
        operatingHours: db.settings.operatingHours,
      },
      categories: db.serviceCategories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
      })),
      services: db.services
        .filter((s) => s.active)
        .map((s) => ({
          id: s.id,
          name: s.name,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
          price: s.price,
          durationMinutes: s.durationMinutes,
          qualifiedEmployeeIds: s.qualifiedEmployeeIds,
        })),
      stylists: activeStylists,
    });
  });

  router.get('/public/availability', (req, res) => {
    const db = readDb();
    const date = String(req.query.date || todayIsoDate()).slice(0, 10);
    const employeeId = req.query.employeeId ? String(req.query.employeeId) : 'any';
    const duration = Math.max(15, Number(req.query.duration) || 60);
    const today = todayIsoDate();

    if (date < today) {
      res.json({
        date,
        slots: STANDARD_BOOKING_SLOTS.map((time) => ({
          time,
          available: false,
          availableStylistCount: 0,
          reason: 'Past date',
        })),
      });
      return;
    }

    const activeStylists = db.employees.filter(
      (e) => e.active && resolveEmployeeStatus(e) === 'Active'
    );

    const slots = STANDARD_BOOKING_SLOTS.map((time) => {
      if (employeeId && employeeId !== 'any') {
        const check = isStylistFreeAtSlot(db, employeeId, date, time, duration);
        return {
          time,
          available: check.free,
          availableStylistCount: check.free ? 1 : 0,
          reason: check.reason,
        };
      }
      const freeCount = activeStylists.filter(
        (emp) => isStylistFreeAtSlot(db, emp.id, date, time, duration).free
      ).length;
      return {
        time,
        available: freeCount > 0,
        availableStylistCount: freeCount,
        reason: freeCount > 0 ? undefined : 'Fully booked',
      };
    });

    res.json({ date, slots });
  });

  router.post('/public/bookings', (req, res) => {
    const db = readDb();
    const { fullName, phone, email, gender, serviceIds, employeeId, date, startTime, notes } =
      req.body as {
        fullName?: string;
        phone?: string;
        email?: string;
        gender?: Customer['gender'];
        serviceIds?: string[];
        employeeId?: string;
        date?: string;
        startTime?: string;
        notes?: string;
      };

    if (!fullName?.trim() || !phone?.trim()) {
      res.status(400).json({ error: 'Please enter your full name and phone number.' });
      return;
    }
    if (!Array.isArray(serviceIds) || serviceIds.length === 0) {
      res.status(400).json({ error: 'Please select at least one salon service.' });
      return;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !startTime || !/^\d{2}:\d{2}$/.test(startTime)) {
      res.status(400).json({ error: 'Valid booking date and start time are required.' });
      return;
    }
    if (date < todayIsoDate()) {
      res.status(400).json({ error: 'Booking date cannot be in the past.' });
      return;
    }

    const selectedServices = db.services.filter((s) => s.active && serviceIds.includes(s.id));
    if (selectedServices.length === 0) {
      res.status(400).json({ error: 'Selected services are no longer available.' });
      return;
    }

    const calcDuration =
      selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0) ||
      db.settings.defaultAppointmentDuration ||
      60;
    const estimatedTotal = selectedServices.reduce((sum, s) => sum + s.price, 0);

    let chosenStylist: Employee | undefined;
    if (employeeId && employeeId !== 'any') {
      const check = isStylistFreeAtSlot(db, employeeId, date, startTime, calcDuration);
      if (!check.free) {
        res.status(409).json({
          error: `Selected time (${startTime}) is not available (${check.reason || 'conflict'}). Please choose another time slot or stylist.`,
        });
        return;
      }
      chosenStylist = db.employees.find((e) => e.id === employeeId);
    } else {
      const activeStylists = db.employees.filter(
        (e) => e.active && resolveEmployeeStatus(e) === 'Active'
      );
      const qualifiedFirst = [
        ...activeStylists.filter((e) =>
          selectedServices.some((s) => s.qualifiedEmployeeIds.includes(e.id))
        ),
        ...activeStylists.filter(
          (e) => !selectedServices.some((s) => s.qualifiedEmployeeIds.includes(e.id))
        ),
      ];
      chosenStylist = qualifiedFirst.find(
        (e) => isStylistFreeAtSlot(db, e.id, date, startTime, calcDuration).free
      );
      if (!chosenStylist) {
        res.status(409).json({
          error: `All stylists are booked at ${startTime} on ${date}. Please select another time slot.`,
        });
        return;
      }
    }

    if (!chosenStylist) {
      res.status(404).json({ error: 'No active stylist available for booking.' });
      return;
    }

    const cleanPhone = phone.trim();
    const digitsOnly = cleanPhone.replace(/\D/g, '');
    let customer = db.customers.find((c) => {
      const cDigits = c.phone.replace(/\D/g, '');
      return c.phone.trim() === cleanPhone || (digitsOnly.length >= 7 && cDigits.endsWith(digitsOnly.slice(-9)));
    });

    if (!customer) {
      customer = {
        id: makeId('CUST'),
        fullName: fullName.trim(),
        phone: cleanPhone,
        email: email?.trim() || '',
        gender: gender || '',
        registrationDate: todayIsoDate(),
        preferredStylistId: chosenStylist.id,
        loyaltyPoints: 0,
        loyaltyTier: 'Bronze',
        totalVisits: 0,
        totalSpent: 0,
      };
      db.customers.push(customer);
    }

    const now = new Date().toISOString();
    const appt: Appointment = {
      id: makeId('APT'),
      customerId: customer.id,
      customerName: customer.fullName,
      customerPhone: customer.phone,
      employeeId: chosenStylist.id,
      employeeName: chosenStylist.fullName,
      serviceIds: selectedServices.map((s) => s.id),
      serviceNames: selectedServices.map((s) => s.name),
      date,
      startTime,
      durationMinutes: calcDuration,
      status: 'Confirmed',
      source: 'Online',
      notes: notes?.trim() || undefined,
      reminderSent: false,
      createdAt: now,
      updatedAt: now,
    };

    db.appointments.push(appt);
    db.notifications.unshift({
      id: makeId('NTF'),
      type: 'appointment',
      title: 'Online Client Booking',
      message: `${customer.fullName} (${customer.phone}) booked ${appt.serviceNames.join(', ')} with ${chosenStylist.fullName} on ${date} at ${startTime}.`,
      severity: 'info',
      read: false,
      targetRoles: ['owner', 'manager', 'employee'],
      createdAt: now,
    });
    appendAuditLog(
      db,
      {
        userId: 'CLIENT-PORTAL',
        userName: `${customer.fullName} (Online Client)`,
        userRole: 'employee',
      },
      'ONLINE_BOOKING_CREATED',
      'Appointment',
      appt.id,
      `Self-service client booking ${appt.id} for ${customer.fullName} with ${chosenStylist.fullName} on ${date} ${startTime} (${calcDuration} min).`
    );
    writeDb(db);

    res.status(201).json({
      booking: {
        reference: appt.id,
        customerName: appt.customerName,
        customerPhone: appt.customerPhone,
        employeeId: appt.employeeId,
        employeeName: appt.employeeName,
        serviceNames: appt.serviceNames,
        date: appt.date,
        startTime: appt.startTime,
        durationMinutes: appt.durationMinutes,
        estimatedTotal,
        status: appt.status,
        source: appt.source,
        notes: appt.notes || '',
      },
    });
  });

  router.get('/public/bookings/lookup', (req, res) => {
    const db = readDb();
    const reference = String(req.query.reference || '').trim().toUpperCase();
    const phone = String(req.query.phone || '').trim();
    const phoneDigits = phone.replace(/\D/g, '');

    if (!reference || phoneDigits.length < 6) {
      res.status(400).json({ error: 'Enter both your booking reference (e.g. APT-...) and phone number.' });
      return;
    }

    const appt = db.appointments.find((a) => {
      if (a.id.toUpperCase() !== reference) return false;
      const aDigits = a.customerPhone.replace(/\D/g, '');
      return a.customerPhone.trim() === phone || aDigits.endsWith(phoneDigits.slice(-9));
    });

    if (!appt) {
      res.status(404).json({ error: 'No booking found matching that reference and phone number.' });
      return;
    }

    const estimatedTotal = db.services
      .filter((s) => appt.serviceIds.includes(s.id))
      .reduce((sum, s) => sum + s.price, 0);

    res.json({
      booking: {
        reference: appt.id,
        customerName: appt.customerName,
        employeeName: appt.employeeName,
        serviceNames: appt.serviceNames,
        date: appt.date,
        startTime: appt.startTime,
        durationMinutes: appt.durationMinutes,
        estimatedTotal,
        status: appt.status,
        source: appt.source,
        notes: appt.notes || '',
      },
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
        socialHandle:
          body.socialHandle !== undefined
            ? String(body.socialHandle).trim()
            : db.settings.socialHandle,
        audienceTagline:
          body.audienceTagline !== undefined
            ? String(body.audienceTagline).trim()
            : db.settings.audienceTagline,
        promotionalBannerUrl:
          body.promotionalBannerUrl !== undefined
            ? String(body.promotionalBannerUrl).trim()
            : db.settings.promotionalBannerUrl,
        backgroundImageUrl:
          body.backgroundImageUrl !== undefined
            ? String(body.backgroundImageUrl).trim()
            : db.settings.backgroundImageUrl,
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

  router.get(
    '/session-history',
    requireAuth,
    requireRole(['owner', 'manager']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const all = db.sessionHistory || [];
      const statusFilter = (req.query.status as string) || 'all';
      const userIdFilter = (req.query.userId as string) || '';
      const search = ((req.query.search as string) || '').trim().toLowerCase();

      const filtered = all.filter((item) => {
        if (statusFilter === 'suspicious') {
          if (!item.suspicious && item.status !== 'suspicious') return false;
        } else if (statusFilter !== 'all' && item.status !== statusFilter) {
          return false;
        }
        if (userIdFilter && item.userId !== userIdFilter) return false;
        if (search) {
          const hay = `${item.userName || ''} ${item.email} ${item.role || ''} ${item.ipAddress || ''} ${item.reason || ''}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      });

      res.json({
        sessions: filtered,
        currentSessionId: req.sessionUser?.sessionId || null,
        summary: {
          totalEvents: all.length,
          activeSessions: all.filter((s) => s.status === 'active').length,
          signedOutCount: all.filter((s) => s.status === 'signed_out').length,
          suspiciousCount: all.filter((s) => s.suspicious || s.status === 'suspicious').length,
          failedAttemptsCount: all.filter((s) => s.status === 'failed_login').length,
          revokedCount: all.filter((s) => s.status === 'revoked').length,
        },
      });
    }
  );

  router.post(
    '/session-history/:id/revoke',
    requireAuth,
    requireRole(['owner']),
    (req: AuthenticatedRequest, res) => {
      const db = readDb();
      const target = (db.sessionHistory || []).find((s) => s.id === req.params.id);
      if (!target) {
        res.status(404).json({ error: 'Session history record not found.' });
        return;
      }
      if (target.sessionId && target.sessionId === req.sessionUser?.sessionId) {
        res.status(400).json({ error: 'You cannot revoke your own active session. Use Sign Out instead.' });
        return;
      }
      if (target.status !== 'active') {
        res.status(400).json({ error: 'Only active sessions can be revoked.' });
        return;
      }

      const now = new Date().toISOString();
      target.status = 'revoked';
      target.logoutAt = now;
      target.reason = `Session revoked by ${req.sessionUser!.name} (${req.sessionUser!.role})`;

      appendAuditLog(
        db,
        req.sessionUser!,
        'SESSION_REVOKED',
        'Security',
        target.id,
        `Revoked active session for ${target.email} (login ${target.loginAt}).`
      );
      writeDb(db);
      res.json({ session: target });
    }
  );

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
