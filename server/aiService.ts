import { GoogleGenAI } from '@google/genai';
import type { SessionPayload } from './auth.ts';
import { getEmployeeCommissionSummary } from './commissionEngine.ts';
import { todayIsoDate } from './db.ts';
import type { SalonDatabase } from './types.ts';

function getAiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildRoleScopedContext(db: SalonDatabase, user: SessionPayload) {
  const today = todayIsoDate();
  const monthPrefix = today.slice(0, 7);

  // Compute week start (Monday) anchored strictly to salon business day
  const nowAnchor = new Date(`${today}T00:00:00Z`);
  const dayOfWeek = nowAnchor.getUTCDay();
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(nowAnchor);
  monday.setUTCDate(nowAnchor.getUTCDate() + diffToMon);
  const weekStart = monday.toISOString().slice(0, 10);

  // Tomorrow ISO date
  const tmr = new Date(nowAnchor);
  tmr.setUTCDate(nowAnchor.getUTCDate() + 1);
  const tomorrow = tmr.toISOString().slice(0, 10);

  if (user.role === 'employee') {
    const empId = user.employeeId || '';
    const emp = db.employees.find((e) => e.id === empId);
    const summary = empId ? getEmployeeCommissionSummary(db, empId) : null;
    const mySchedules = db.schedules.filter((s) => s.employeeId === empId && s.date >= today);
    const myAttendance = db.attendance.filter((a) => a.employeeId === empId && a.date.startsWith(monthPrefix));
    const myAppointments = db.appointments.filter((a) => a.employeeId === empId && a.date >= today);
    const myLedger = db.commissionLedger.filter((c) => c.employeeId === empId && c.date.startsWith(monthPrefix));
    const myPayments = db.commissionPayments.filter((p) => p.employeeId === empId);

    return {
      accessScope: 'EMPLOYEE_SELF_ONLY',
      reportingDates: { today, tomorrow, weekStart, monthPrefix },
      employee: emp ? { id: emp.id, fullName: emp.fullName, roleTitle: emp.roleTitle } : null,
      commissionSummaryAllTime: summary,
      thisMonthLedgerCount: myLedger.length,
      thisMonthGrossEarnings: myLedger.reduce((s, c) => s + c.grossEarnings, 0),
      thisMonthLunchDeductions: db.lunchDeductions
        .filter((l) => l.employeeId === empId && l.date.startsWith(monthPrefix))
        .reduce((s, l) => s + l.amount, 0),
      thisMonthCommission: myLedger.reduce((s, c) => s + c.employeeCommission, 0),
      recentPayments: myPayments.slice(0, 10),
      upcomingAppointments: myAppointments.slice(0, 10),
      upcomingSchedules: mySchedules.slice(0, 10),
      monthAttendance: myAttendance,
    };
  }

  // Owner & Manager operational + full financial context
  const activeTx = db.posTransactions.filter((t) => t.status !== 'Reversed' && t.status !== 'Refunded');
  const todayTx = activeTx.filter((t) => t.date === today);
  const monthTx = activeTx.filter((t) => t.date.startsWith(monthPrefix));

  const sumItems = (txs: typeof activeTx, type: 'service' | 'product') =>
    txs.reduce(
      (sum, tx) =>
        sum +
        tx.items.filter((i) => i.itemType === type).reduce((s, i) => s + i.lineTotal, 0),
      0
    );

  const lowStockItems = db.stockItems
    .filter((s) => s.active && s.currentQuantity <= s.minStockLevel)
    .map((s) => ({
      sku: s.sku,
      name: s.name,
      currentQuantity: s.currentQuantity,
      minStockLevel: s.minStockLevel,
      unit: s.unit,
    }));

  const tomorrowAppointments = db.appointments.filter(
    (a) => a.date === tomorrow && a.status !== 'Cancelled'
  );

  const cancelledThisMonth = db.appointments.filter(
    (a) => a.date.startsWith(monthPrefix) && a.status === 'Cancelled'
  ).length;

  const baseOperational = {
    accessScope: 'MANAGEMENT_FULL',
    reportingDates: { today, tomorrow, weekStart, monthPrefix },
    businessInfo: {
      name: db.settings.businessName,
      location: db.settings.location,
      currency: db.settings.currency,
    },
    todayMetrics: {
      transactionCount: todayTx.length,
      totalSalesBilled: todayTx.reduce((s, t) => s + t.totalAmount, 0),
      totalCollected: todayTx.reduce((s, t) => s + t.amountPaid, 0),
      serviceRevenue: sumItems(todayTx, 'service'),
      retailProductSales: sumItems(todayTx, 'product'),
      uniqueCustomersToday: new Set(todayTx.map((t) => t.customerId || t.customerName)).size,
      completedAppointmentsToday: db.appointments.filter(
        (a) => a.date === today && a.status === 'Completed'
      ).length,
      walkInsToday: db.walkIns.filter((w) => w.arrivalTime.startsWith(today)).length,
    },
    tomorrowAppointmentsCount: tomorrowAppointments.length,
    tomorrowAppointments: tomorrowAppointments.slice(0, 15).map((a) => ({
      time: a.startTime,
      customer: a.customerName,
      services: a.serviceNames,
      stylist: a.employeeName,
      status: a.status,
    })),
    cancelledAppointmentsThisMonth: cancelledThisMonth,
    lowStockItems,
    totalCustomers: db.customers.length,
    returningCustomersCount: db.customers.filter((c) => c.totalVisits >= 2).length,
  };

  // Owner & Manager full financial context
  const monthLedger = db.commissionLedger.filter(
    (c) => c.date.startsWith(monthPrefix) && c.paymentStatus !== 'Reversed'
  );
  const weekExpenses = db.expenses.filter(
    (e) => e.date >= weekStart && e.date <= today && e.status !== 'Rejected'
  );
  const monthExpenses = db.expenses.filter(
    (e) => e.date.startsWith(monthPrefix) && e.status !== 'Rejected'
  );
  const monthLunch = db.lunchDeductions.filter((l) => l.date.startsWith(monthPrefix));

  const employeeRankings = db.employees.map((emp) => {
    const empMonthLedger = monthLedger.filter((c) => c.employeeId === emp.id);
    const summary = getEmployeeCommissionSummary(db, emp.id);
    return {
      employeeId: emp.id,
      fullName: emp.fullName,
      monthGrossServiceSales: empMonthLedger.reduce((s, c) => s + c.grossEarnings, 0),
      monthCommissionEarned: empMonthLedger.reduce((s, c) => s + c.employeeCommission, 0),
      allTimeOutstandingCommission: summary.outstandingBalance,
      allTimePaidCommission: summary.totalPaid,
    };
  });

  // Service revenue breakdown this month
  const serviceRevenueMap: Record<string, number> = {};
  for (const tx of monthTx) {
    for (const item of tx.items) {
      if (item.itemType === 'service') {
        serviceRevenueMap[item.name] = (serviceRevenueMap[item.name] || 0) + item.lineTotal;
      }
    }
  }

  const totalOutstandingCommissions = employeeRankings.reduce(
    (s, e) => s + e.allTimeOutstandingCommission,
    0
  );

  const monthServiceRev = sumItems(monthTx, 'service');
  const monthProductRev = sumItems(monthTx, 'product');
  const monthTotalRev = monthTx.reduce((s, t) => s + t.totalAmount, 0);
  const monthSalonShare = monthLedger.reduce((s, c) => s + c.salonShare, 0);
  const monthExpensesTotal = monthExpenses.reduce((s, e) => s + e.amount, 0);

  return {
    ...baseOperational,
    monthlyFinancials: {
      monthPrefix,
      totalSales: monthTotalRev,
      serviceRevenue: monthServiceRev,
      retailProductSales: monthProductRev,
      employeeCommissions: monthLedger.reduce((s, c) => s + c.employeeCommission, 0),
      salonShareFromServices: monthSalonShare,
      totalLunchDeductedThisMonth: monthLunch.reduce((s, l) => s + l.amount, 0),
      totalExpensesThisMonth: monthExpensesTotal,
      estimatedOperatingProfit: monthSalonShare + monthProductRev - monthExpensesTotal,
    },
    weeklyExpenses: {
      period: `${weekStart} to ${today}`,
      total: weekExpenses.reduce((s, e) => s + e.amount, 0),
      count: weekExpenses.length,
    },
    outstandingCommissionsTotal: totalOutstandingCommissions,
    employeePerformanceThisMonth: employeeRankings,
    topServicesThisMonth: Object.entries(serviceRevenueMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([service, revenue]) => ({ service, revenue })),
    activeCommissionPolicy: db.commissionPolicies[db.commissionPolicies.length - 1],
    giftCardOutstandingLiability: db.giftCards
      .filter((g) => g.status === 'Active')
      .reduce((s, g) => s + g.balance, 0),
  };
}

export async function askSalonAiAssistant(
  db: SalonDatabase,
  user: SessionPayload,
  question: string
): Promise<{ answer: string; scope: string; generatedAt: string }> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }

  const contextData = buildRoleScopedContext(db, user);
  const ai = getAiClient();

  const systemInstruction = `You are the Business Intelligence Assistant for Trendy Unisex Salon (Busia District Road, near ASA Microfinance, Madibira 'A', Uganda). Currency is Uganda Shillings (UGX).

STRICT RULES:
1. Answer ONLY using the exact JSON salon database snapshot provided in the prompt. NEVER invent, guess, or extrapolate financial figures.
2. Always state the reporting period used (e.g., Today's date, This Month, or All-Time).
3. Explain clearly how totals were calculated (e.g., Gross Earnings minus UGX 2,500 daily lunch deduction = Net Commissionable Earnings × Commission Rate; or Salon Share + Retail Sales − Approved Expenses = Operating Profit Estimate).
4. If the requested metric is 0 because no records have been entered yet for that period, state clearly that 0 transactions/records exist for that period.
5. Respect access control strictly:
   - If accessScope is EMPLOYEE_SELF_ONLY, you may ONLY discuss this employee's own records. Politely decline questions about other employees' earnings, salon profit, or overall salon expenses.
6. You are read-only: NEVER claim you deleted, modified, or approved any financial record, commission rate, payment, or stock quantity.
7. Keep answers concise, structured, and formatted cleanly in plain markdown with UGX amounts formatted with commas (e.g. UGX 100,000).`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `User Role: ${user.role} (${user.name})\nQuestion: ${question}\n\nVerified Salon Database Snapshot:\n${JSON.stringify(
      contextData,
      null,
      2
    )}`,
    config: {
      systemInstruction,
    },
  });

  return {
    answer: response.text || 'Unable to generate an answer from current salon records.',
    scope: contextData.accessScope,
    generatedAt: new Date().toISOString(),
  };
}
