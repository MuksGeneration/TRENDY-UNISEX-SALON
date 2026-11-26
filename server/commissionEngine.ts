import type {
  CommissionLedgerEntry,
  CommissionPolicy,
  LunchAllocationMethod,
  LunchDeductionRecord,
  POSTransaction,
  SalonDatabase,
} from './types.ts';

/**
 * Resolves the active commission policy for a given transaction date (YYYY-MM-DD).
 * Picks the latest policy whose effectiveDate <= date.
 */
export function getPolicyForDate(policies: CommissionPolicy[], date: string): CommissionPolicy {
  const sorted = [...policies].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let active = sorted[0];
  for (const p of sorted) {
    if (p.effectiveDate <= date) {
      active = p;
    }
  }
  return active;
}

/**
 * Determines the applicable employee commission rate based on service category
 * and the Trendy Unisex Salon rules:
 * - Plaiting Hair: 50%
 * - Blow Dry: 30%
 * - All other services: 40%
 */
export function resolveServiceCommissionRate(
  categoryName: string,
  policy: CommissionPolicy,
  serviceOverrideRate?: number
): number {
  if (typeof serviceOverrideRate === 'number' && serviceOverrideRate >= 0 && serviceOverrideRate <= 1) {
    return serviceOverrideRate;
  }
  const normalized = categoryName.trim().toLowerCase();
  if (normalized.includes('plait')) {
    return policy.plaitingRate;
  }
  if (normalized.includes('blow dry') || normalized.includes('blowdry')) {
    return policy.blowDryRate;
  }
  return policy.defaultOtherRate;
}

/**
 * Allocates the single once-per-day lunch deduction across multiple service items
 * performed by the same employee on the same working day.
 *
 * CRITICAL ORDER OF OPERATIONS:
 * 1. Deduct lunch ONLY ONCE per employee per working day.
 * 2. Net Commissionable Earnings = Gross Daily Earnings - Lunch Deduction.
 * 3. Employee Commission = Net Commissionable Earnings * Applicable Commission Rate.
 * 4. Salon Share = Net Commissionable Earnings - Employee Commission.
 */
export function allocateLunchAcrossItems(
  items: Array<{ grossEarnings: number; commissionRate: number }>,
  totalLunchToDeduct: number,
  method: LunchAllocationMethod
): number[] {
  const totalGross = items.reduce((sum, item) => sum + item.grossEarnings, 0);
  if (totalGross <= 0 || totalLunchToDeduct <= 0 || items.length === 0) {
    return items.map(() => 0);
  }

  const effectiveLunch = Math.min(totalLunchToDeduct, totalGross);
  const allocations = new Array(items.length).fill(0);

  if (method === 'proportional') {
    let allocatedSoFar = 0;
    let largestIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].grossEarnings > items[largestIdx].grossEarnings) {
        largestIdx = i;
      }
      const share = Math.round((items[i].grossEarnings / totalGross) * effectiveLunch);
      allocations[i] = Math.min(share, items[i].grossEarnings);
      allocatedSoFar += allocations[i];
    }
    const diff = effectiveLunch - allocatedSoFar;
    if (diff !== 0) {
      allocations[largestIdx] = Math.max(
        0,
        Math.min(items[largestIdx].grossEarnings, allocations[largestIdx] + diff)
      );
    }
    return allocations;
  }

  // Ordered priority allocation (highest_earning_category or lowest_rate_first)
  const indexed = items.map((item, idx) => ({ ...item, idx }));
  if (method === 'highest_earning_category') {
    indexed.sort((a, b) => b.grossEarnings - a.grossEarnings);
  } else {
    indexed.sort((a, b) => a.commissionRate - b.commissionRate);
  }

  let remaining = effectiveLunch;
  for (const entry of indexed) {
    if (remaining <= 0) break;
    const take = Math.min(entry.grossEarnings, remaining);
    allocations[entry.idx] = take;
    remaining -= take;
  }

  return allocations;
}

/**
 * Rebuilds non-historical commission ledger entries and the single lunch deduction
 * record for a specific (employeeId, date) whenever a new POS transaction is saved
 * or reversed on that date.
 *
 * Historical records (isHistorical === true) are strictly untouched.
 */
export function recomputeEmployeeDailyCommission(
  db: SalonDatabase,
  employeeId: string,
  date: string
): void {
  const employee = db.employees.find((e) => e.id === employeeId);
  if (!employee) return;

  const policy = getPolicyForDate(db.commissionPolicies, date);

  // Collect all non-historical, non-reversed/non-refunded POS service items for this employee & date
  const activeTransactions = db.posTransactions.filter(
    (tx) =>
      tx.date === date &&
      !tx.isHistorical &&
      tx.status !== 'Reversed' &&
      tx.status !== 'Refunded'
  );

  interface DailyServiceLine {
    transactionId: string;
    transactionReference: string;
    serviceName: string;
    serviceCategory: string;
    grossEarnings: number;
    commissionRate: number;
    createdAt: string;
  }

  const serviceLines: DailyServiceLine[] = [];

  for (const tx of activeTransactions) {
    for (const item of tx.items) {
      const isService = item.itemType === 'service';
      const isRetailCommissionable =
        item.itemType === 'product' && policy.productCommissionEnabled && policy.productCommissionRate > 0;

      if ((isService || isRetailCommissionable) && item.employeeId === employeeId && item.lineTotal > 0) {
        const serviceDef = isService ? db.services.find((s) => s.id === item.refId) : undefined;
        const rate = isService
          ? item.commissionRateApplied ??
            resolveServiceCommissionRate(item.categoryName, policy, serviceDef?.commissionRateOverride)
          : policy.productCommissionRate;

        serviceLines.push({
          transactionId: tx.id,
          transactionReference: tx.reference,
          serviceName: item.name,
          serviceCategory: item.categoryName,
          grossEarnings: item.lineTotal,
          commissionRate: rate,
          createdAt: tx.createdAt,
        });
      }
    }
  }

  // Remove existing non-historical ledger entries & lunch deductions for this (employeeId, date)
  db.commissionLedger = db.commissionLedger.filter(
    (entry) => !(entry.employeeId === employeeId && entry.date === date && !entry.isHistorical)
  );
  db.lunchDeductions = db.lunchDeductions.filter(
    (ld) => !(ld.employeeId === employeeId && ld.date === date && !ld.isHistorical)
  );

  if (serviceLines.length === 0) {
    return;
  }

  const grossDailyEarnings = serviceLines.reduce((sum, l) => sum + l.grossEarnings, 0);
  const lunchAmount = employee.lunchEligible
    ? Math.min(policy.lunchDeductionAmount, grossDailyEarnings)
    : 0;

  if (lunchAmount > 0) {
    const lunchRecord: LunchDeductionRecord = {
      id: `LUNCH-${date}-${employeeId}`,
      employeeId,
      employeeName: employee.fullName,
      date,
      amount: lunchAmount,
      allocationMethod: policy.lunchAllocationMethod,
      grossDailyEarnings,
      isHistorical: false,
      createdAt: new Date().toISOString(),
    };
    db.lunchDeductions.push(lunchRecord);
  }

  const allocations = allocateLunchAcrossItems(
    serviceLines.map((l) => ({ grossEarnings: l.grossEarnings, commissionRate: l.commissionRate })),
    lunchAmount,
    policy.lunchAllocationMethod
  );

  serviceLines.forEach((line, idx) => {
    const lunchAlloc = allocations[idx];
    const netCommissionable = Math.max(0, line.grossEarnings - lunchAlloc);
    const empCommission = Math.round(netCommissionable * line.commissionRate);
    const salonShare = netCommissionable - empCommission;

    const entry: CommissionLedgerEntry = {
      id: `COM-${date}-${employeeId}-${idx + 1}-${line.transactionReference}`,
      transactionId: line.transactionId,
      transactionReference: line.transactionReference,
      date,
      employeeId,
      employeeName: employee.fullName,
      serviceName: line.serviceName,
      serviceCategory: line.serviceCategory,
      grossEarnings: line.grossEarnings,
      lunchAllocation: lunchAlloc,
      netCommissionableEarnings: netCommissionable,
      commissionRate: line.commissionRate,
      employeeCommission: empCommission,
      salonShare,
      paymentStatus: 'Unpaid',
      isHistorical: false,
      policyId: policy.id,
      createdAt: line.createdAt,
    };

    db.commissionLedger.push(entry);
  });

  syncEmployeeCommissionLedgerStatuses(db, employeeId);
}

export interface DailyEmployeeCommissionBreakdown {
  date: string;
  grossEarnings: number;
  lunchDeducted: number;
  netCommissionable: number;
  baseCommissionEarned: number;
  adjustments: number;
  totalCommissionEarned: number;
  salonShare: number;
  directTips: number;
  historicalPaid: number;
  paidForDate: number;
  outstandingBalance: number;
  servicesCount: number;
}

/**
 * Computes per-date commission breakdown for an employee.
 * Payments with an explicit `commissionDate` apply STRICTLY to that date so payouts
 * from yesterday never mix with today's commissions. Legacy payments without
 * `commissionDate` match their `paymentDate` first, then FIFO fallback for any remainder.
 */
export function getEmployeeDailyCommissionBreakdown(
  db: SalonDatabase,
  employeeId: string
): DailyEmployeeCommissionBreakdown[] {
  const ledger = db.commissionLedger.filter(
    (c) => c.employeeId === employeeId && c.paymentStatus !== 'Reversed'
  );
  const adjustments = db.commissionAdjustments.filter((a) => a.employeeId === employeeId);
  const lunches = db.lunchDeductions.filter((l) => l.employeeId === employeeId);
  const payments = db.commissionPayments.filter((p) => p.employeeId === employeeId);
  const tips = db.tips.filter(
    (t) => t.employeeId === employeeId && t.distributionMode === 'direct_to_employee'
  );

  const dateSet = new Set<string>();
  for (const c of ledger) dateSet.add(c.date);
  for (const a of adjustments) dateSet.add(a.date);
  for (const l of lunches) dateSet.add(l.date);
  for (const p of payments) dateSet.add(p.commissionDate || p.paymentDate);

  const sortedDates = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  const dayMap = new Map<string, DailyEmployeeCommissionBreakdown>();

  for (const d of sortedDates) {
    const dayLedger = ledger.filter((c) => c.date === d);
    const dayAdj = adjustments.filter((a) => a.date === d);
    const dayLunch = lunches.filter((l) => l.date === d);
    const dayTips = tips.filter((t) => t.date === d);

    const grossEarnings = dayLedger.reduce((s, c) => s + c.grossEarnings, 0);
    const lunchDeducted = dayLunch.reduce((s, l) => s + l.amount, 0);
    const netCommissionable = dayLedger.reduce((s, c) => s + c.netCommissionableEarnings, 0);
    const baseCommissionEarned = dayLedger.reduce((s, c) => s + c.employeeCommission, 0);
    const adjTotal = dayAdj.reduce((s, a) => s + a.amount, 0);
    const totalCommissionEarned = Math.max(0, baseCommissionEarned + adjTotal);
    const salonShare = dayLedger.reduce((s, c) => s + c.salonShare, 0);
    const directTips = dayTips.reduce((s, t) => s + t.amount, 0);
    const historicalPaid = dayLedger
      .filter((c) => c.isHistorical && c.paymentStatus === 'Paid')
      .reduce((s, c) => s + c.employeeCommission, 0);

    dayMap.set(d, {
      date: d,
      grossEarnings,
      lunchDeducted,
      netCommissionable,
      baseCommissionEarned,
      adjustments: adjTotal,
      totalCommissionEarned,
      salonShare,
      directTips,
      historicalPaid,
      paidForDate: 0,
      outstandingBalance: Math.max(0, totalCommissionEarned - historicalPaid),
      servicesCount: dayLedger.length,
    });
  }

  // 1. Apply date-tagged payments strictly to their designated commissionDate
  const legacyPayments: typeof payments = [];
  for (const p of payments) {
    if (p.commissionDate) {
      const target = dayMap.get(p.commissionDate);
      if (target) {
        target.paidForDate += p.amount;
      }
    } else {
      legacyPayments.push(p);
    }
  }

  // 2. Apply legacy payments (without commissionDate) to their own paymentDate first, then FIFO remainder
  const legacyRemainders: number[] = [];
  for (const lp of legacyPayments) {
    let amt = lp.amount;
    const sameDay = dayMap.get(lp.paymentDate);
    if (sameDay) {
      const alreadyCovered = Math.max(sameDay.paidForDate, sameDay.historicalPaid);
      const room = Math.max(0, sameDay.totalCommissionEarned - alreadyCovered);
      const take = Math.min(amt, room);
      sameDay.paidForDate += take;
      amt -= take;
    }
    if (amt > 0) {
      legacyRemainders.push(amt);
    }
  }

  let extraLegacy = legacyRemainders.reduce((s, v) => s + v, 0);
  if (extraLegacy > 0) {
    for (const d of sortedDates) {
      if (extraLegacy <= 0) break;
      const day = dayMap.get(d)!;
      const alreadyCovered = Math.max(day.paidForDate, day.historicalPaid);
      const room = Math.max(0, day.totalCommissionEarned - alreadyCovered);
      const take = Math.min(extraLegacy, room);
      day.paidForDate += take;
      extraLegacy -= take;
    }
    // If excess still remains beyond earned rows, keep it on the last date so totalPaid aligns
    if (extraLegacy > 0 && sortedDates.length > 0) {
      const last = dayMap.get(sortedDates[sortedDates.length - 1])!;
      last.paidForDate += extraLegacy;
    }
  }

  for (const day of dayMap.values()) {
    const effectivePaid = Math.max(day.paidForDate, day.historicalPaid);
    day.outstandingBalance = Math.max(0, day.totalCommissionEarned - effectivePaid);
  }

  return Array.from(dayMap.values());
}

/**
 * Updates `paymentStatus` flags (`Paid` | `Partially Paid` | `Unpaid`) per earning date
 * so paying out one date only marks that date's ledger entries as paid.
 */
export function syncEmployeeCommissionLedgerStatuses(db: SalonDatabase, employeeId: string): void {
  const breakdown = getEmployeeDailyCommissionBreakdown(db, employeeId);
  const byDate = new Map(breakdown.map((b) => [b.date, b]));

  for (const [date, day] of byDate.entries()) {
    let remainingBudget = Math.max(0, day.paidForDate - day.historicalPaid);
    const entries = db.commissionLedger.filter(
      (c) =>
        c.employeeId === employeeId &&
        c.date === date &&
        !c.isHistorical &&
        c.paymentStatus !== 'Reversed'
    );
    for (const entry of entries) {
      if (remainingBudget >= entry.employeeCommission) {
        entry.paymentStatus = 'Paid';
        remainingBudget -= entry.employeeCommission;
      } else if (remainingBudget > 0) {
        entry.paymentStatus = 'Partially Paid';
        remainingBudget = 0;
      } else {
        entry.paymentStatus = 'Unpaid';
      }
    }
  }
}

/**
 * Computes per-employee commission summary (earned, adjustments, paid, outstanding)
 * and updates paymentStatus flags accurately without altering historical amounts.
 */
export function getEmployeeCommissionSummary(db: SalonDatabase, employeeId: string) {
  const ledger = db.commissionLedger.filter(
    (c) => c.employeeId === employeeId && c.paymentStatus !== 'Reversed'
  );
  const adjustments = db.commissionAdjustments.filter((a) => a.employeeId === employeeId);
  const payments = db.commissionPayments.filter((p) => p.employeeId === employeeId);
  const lunches = db.lunchDeductions.filter((l) => l.employeeId === employeeId);
  const tips = db.tips.filter(
    (t) => t.employeeId === employeeId && t.distributionMode === 'direct_to_employee'
  );

  const grossEarnings = ledger.reduce((s, c) => s + c.grossEarnings, 0);
  const totalLunchDeducted = lunches.reduce((s, l) => s + l.amount, 0);
  const netCommissionable = ledger.reduce((s, c) => s + c.netCommissionableEarnings, 0);
  const baseCommissionEarned = ledger.reduce((s, c) => s + c.employeeCommission, 0);
  const totalAdjustments = adjustments.reduce((s, a) => a.amount + s, 0);
  const totalCommissionEarned = baseCommissionEarned + totalAdjustments;
  const totalSalonShare = ledger.reduce((s, c) => s + c.salonShare, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const outstandingBalance = Math.max(0, totalCommissionEarned - totalPaid);
  const directTips = tips.reduce((s, t) => s + t.amount, 0);

  return {
    grossEarnings,
    totalLunchDeducted,
    netCommissionable,
    baseCommissionEarned,
    totalAdjustments,
    totalCommissionEarned,
    totalSalonShare,
    totalPaid,
    outstandingBalance,
    directTips,
  };
}
