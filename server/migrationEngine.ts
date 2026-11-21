import type {
  Appointment,
  AppointmentStatus,
  Customer,
  Employee,
  PaymentMethod,
  POSTransaction,
  SalonDatabase,
  ServiceItem,
  UserRole,
} from './types.ts';

export type DetectedSheetEntity =
  | 'customers'
  | 'services'
  | 'employees'
  | 'stock'
  | 'expenses'
  | 'commissions'
  | 'appointments'
  | 'transactions'
  | 'unknown';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildRowLookup(row: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    const nk = normKey(k);
    if (nk && !map.has(nk)) {
      map.set(nk, v);
    }
  }
  return map;
}

function pickField(lookup: Map<string, unknown>, aliases: string[]): unknown {
  for (const alias of aliases) {
    const val = lookup.get(normKey(alias));
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return val;
    }
  }
  return undefined;
}

function pickString(lookup: Map<string, unknown>, aliases: string[], fallback = ''): string {
  const val = pickField(lookup, aliases);
  if (val === undefined || val === null) return fallback;
  return String(val).trim();
}

function pickNumber(lookup: Map<string, unknown>, aliases: string[], fallback = 0): number {
  const val = pickField(lookup, aliases);
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'number') return Number.isFinite(val) ? val : fallback;
  const cleaned = String(val)
    .replace(/ugx|shs|ush|,|\s/gi, '')
    .trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

function parseIsoDate(raw: unknown, fallback: string): string {
  if (!raw) return fallback;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && raw > 25000 && raw < 80000) {
    const utcMs = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(utcMs);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return fallback;
}

function parsePaymentMethod(raw: string): PaymentMethod {
  const lower = raw.toLowerCase();
  if (lower.includes('mtn') || lower.includes('airtel') || lower.includes('momo') || lower.includes('mobile')) {
    return 'Mobile Money';
  }
  if (lower.includes('card') || lower.includes('visa') || lower.includes('pos')) return 'Card';
  if (lower.includes('bank') || lower.includes('transfer')) return 'Bank Transfer';
  if (lower.includes('gift')) return 'Gift Card';
  return 'Cash';
}

function parseTimeHhmm(raw: string, fallback = '09:00'): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim());
  if (!match) return fallback;
  const h = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, '0');
  const m = String(Math.min(59, Math.max(0, Number(match[2])))).padStart(2, '0');
  return `${h}:${m}`;
}

const APP_INTERNAL_SYSTEM_TABS = new Set([
  '_systemstate',
  'employee schedules',
  'attendance',
  'daily sales',
  'lunch deductions',
  'commission payments',
  'stock movements',
  'gift cards',
  'audit logs',
  'settings',
  'users',
]);

export function detectSheetEntity(tabName: string, rows: Record<string, unknown>[]): DetectedSheetEntity {
  const lower = tabName.toLowerCase().trim();
  if (lower === '_systemstate') return 'unknown';

  if (lower.includes('customer') || lower.includes('client') || lower.includes('member')) {
    return 'customers';
  }
  if (lower.includes('service') || lower.includes('menu') || lower.includes('treatment') || lower.includes('pricelist')) {
    return 'services';
  }
  if (lower.includes('employee') || lower.includes('staff') || lower.includes('stylist') || lower.includes('barber')) {
    return 'employees';
  }
  if (lower.includes('commission') || lower.includes('payout')) {
    return 'commissions';
  }
  if (lower.includes('stock') || lower.includes('inventory') || lower.includes('product') || lower.includes('suppl')) {
    return 'stock';
  }
  if (lower.includes('expense') || lower.includes('outflow') || lower.includes('spending') || lower.includes('bills')) {
    return 'expenses';
  }
  if (lower.includes('appointment') || lower.includes('booking') || lower.includes('schedule')) {
    return 'appointments';
  }
  if (
    lower.includes('sale') ||
    lower.includes('transaction') ||
    lower.includes('income') ||
    lower.includes('revenue') ||
    lower.includes('pos') ||
    lower.includes('receipt')
  ) {
    return 'transactions';
  }

  const sample = rows.find((r) => r && Object.keys(r).length > 0);
  if (!sample) return 'unknown';
  const keys = Object.keys(sample).map(normKey);
  const has = (...candidates: string[]) => candidates.some((c) => keys.includes(normKey(c)));

  if (has('commission', 'employeecommission', 'salonshare', 'commissionrate')) return 'commissions';
  if (has('currentquantity', 'openingquantity', 'minstock', 'reorderlevel', 'purchaseprice', 'sku')) return 'stock';
  if (has('expense', 'particulars', 'responsibleperson', 'paidby') && has('amount', 'total', 'cost', 'ugx')) return 'expenses';
  if (has('duration', 'durationminutes', 'commissiontype') && has('price', 'fee', 'rate')) return 'services';
  if (has('roletitle', 'nationalid', 'hiredate', 'specialties')) return 'employees';
  if (has('starttime', 'appointmentdate') && has('status')) return 'appointments';
  if (has('total', 'totalamount', 'amount', 'sales', 'amountpaid', 'gross')) {
    if (has('expense', 'spending', 'bill')) return 'expenses';
    return 'transactions';
  }
  if (has('phone', 'phonenumber', 'mobile', 'tel') && has('fullname', 'name', 'customer', 'client')) {
    return 'customers';
  }
  return 'unknown';
}

export function isAppGeneratedTabName(tabName: string): boolean {
  const lower = tabName.toLowerCase().trim();
  return (
    APP_INTERNAL_SYSTEM_TABS.has(lower) ||
    [
      'customers',
      'employees',
      'appointments',
      'services',
      'pos transactions',
      'commission ledger',
      'expenses',
      'stock items',
    ].includes(lower)
  );
}

export interface TabImportSummary {
  tabName: string;
  detectedType: DetectedSheetEntity;
  totalRows: number;
  importedCount: number;
  skippedDuplicates: number;
  columns: string[];
}

export interface SheetImportOptions {
  fileName: string;
  actorName: string;
  actorUserId: string;
  actorRole: UserRole;
  sourceKind: 'google_sheet' | 'excel';
  createBackupFn?: (db: SalonDatabase, label: string, createdBy: string) => string;
  targetTabs?: string[];
}

export interface SheetImportResult {
  backupId?: string;
  importedCount: number;
  skippedDuplicates: number;
  sheetsImported: string[];
  tabSummaries: TabImportSummary[];
}

export function importTabularSheetsIntoDb(
  db: SalonDatabase,
  sheets: Record<string, Record<string, unknown>[]>,
  options: SheetImportOptions
): SheetImportResult {
  const backupId = options.createBackupFn
    ? options.createBackupFn(db, `Pre-Migration Backup before ${options.fileName}`, options.actorName)
    : undefined;

  let importedCount = 0;
  let skippedDuplicates = 0;
  const sheetsImported: string[] = [];
  const tabSummaries: TabImportSummary[] = [];

  const selectedSet =
    options.targetTabs && options.targetTabs.length > 0
      ? new Set(options.targetTabs.map((t) => t.trim()))
      : null;

  const sourceTag =
    options.sourceKind === 'google_sheet' ? 'Imported from old Google Sheet' : 'Imported from Excel workbook';

  for (const [sheetName, rawRows] of Object.entries(sheets)) {
    if (sheetName === '_SystemState') continue;
    if (selectedSet && !selectedSet.has(sheetName)) continue;
    if (!Array.isArray(rawRows) || rawRows.length === 0) continue;

    // Filter completely blank rows
    const rows = rawRows.filter(
      (r) => r && Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== '')
    );
    if (rows.length === 0) continue;

    const entity = detectSheetEntity(sheetName, rows);
    if (entity === 'unknown') continue;

    const columns = Object.keys(rows[0] || {});
    let tabImported = 0;
    let tabSkipped = 0;

    if (entity === 'customers') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const name = pickString(lk, ['FullName', 'Full Name', 'Customer', 'Customer Name', 'Client', 'Client Name', 'Name']);
        const phone = pickString(lk, ['Phone', 'Phone Number', 'Tel', 'Telephone', 'Mobile', 'Contact'], 'N/A');
        if (!name) continue;
        const exists = db.customers.some(
          (c) =>
            c.fullName.toLowerCase() === name.toLowerCase() &&
            (phone === 'N/A' || c.phone === 'N/A' || c.phone === phone)
        );
        if (exists) {
          tabSkipped++;
          continue;
        }
        const totalSpent = pickNumber(lk, ['TotalSpent', 'Total Spent', 'Spent', 'Lifetime Value'], 0);
        const points = pickNumber(lk, ['LoyaltyPoints', 'Points', 'Loyalty Points'], 0);
        const genderRaw = pickString(lk, ['Gender', 'Sex']).toLowerCase();
        const gender: Customer['gender'] = genderRaw.startsWith('m')
          ? 'Male'
          : genderRaw.startsWith('f')
            ? 'Female'
            : genderRaw
              ? 'Prefer not to say'
              : undefined;

        db.customers.push({
          id: pickString(lk, ['ID', 'CustomerID', 'Customer ID']) || makeId('CUST-HIST'),
          fullName: name,
          phone,
          email: pickString(lk, ['Email', 'Email Address']) || undefined,
          gender,
          registrationDate: parseIsoDate(pickField(lk, ['RegistrationDate', 'Date', 'Registered', 'Joined']), todayDateStr()),
          loyaltyPoints: points,
          loyaltyTier: points >= 500 ? 'VIP' : points >= 250 ? 'Gold' : points >= 100 ? 'Silver' : 'Bronze',
          totalVisits: pickNumber(lk, ['TotalVisits', 'Visits', 'Visit Count'], 1),
          totalSpent,
          lastVisitDate: pickField(lk, ['LastVisit', 'Last Visit'])
            ? parseIsoDate(pickField(lk, ['LastVisit', 'Last Visit']), todayDateStr())
            : undefined,
          notes: pickString(lk, ['Notes', 'Note', 'Remarks'], sourceTag),
        });
        tabImported++;
      }
    } else if (entity === 'services') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const name = pickString(lk, ['Name', 'Service', 'Service Name', 'ServiceName', 'Title', 'Treatment']);
        const price = pickNumber(lk, ['Price', 'Price (UGX)', 'PriceUGX', 'Fee', 'Amount', 'Rate', 'Cost'], 0);
        if (!name || price <= 0) continue;
        if (db.services.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
          tabSkipped++;
          continue;
        }
        const categoryName = pickString(lk, ['CategoryName', 'Category', 'Department', 'Group'], 'Hair Styling');
        const matchedCat = db.serviceCategories.find(
          (c) => c.name.toLowerCase() === categoryName.toLowerCase()
        );
        const rawRate = pickNumber(lk, ['CommissionRateOverride', 'Commission Rate', 'CommissionValue', 'Commission'], 0);
        const commissionRateOverride =
          rawRate > 0 ? (rawRate > 1 ? rawRate / 100 : rawRate) : undefined;
        const item: ServiceItem = {
          id: pickString(lk, ['ID', 'ServiceID']) || makeId('SRV-HIST'),
          name,
          categoryId: matchedCat?.id || db.serviceCategories[0]?.id || 'CAT-GENERAL',
          categoryName: matchedCat?.name || categoryName,
          price,
          durationMinutes: Math.max(10, pickNumber(lk, ['DurationMinutes', 'Duration', 'Minutes', 'Time'], 45)),
          commissionRateOverride,
          qualifiedEmployeeIds: [],
          active: pickString(lk, ['Active', 'Status'], 'true').toLowerCase() !== 'false',
        };
        db.services.push(item);
        tabImported++;
      }
    } else if (entity === 'employees') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const fullName = pickString(lk, ['FullName', 'Full Name', 'Name', 'Employee', 'Staff', 'Stylist', 'Barber']);
        if (!fullName) continue;
        if (db.employees.some((e) => e.fullName.toLowerCase() === fullName.toLowerCase())) {
          tabSkipped++;
          continue;
        }
        const specsRaw = pickString(lk, ['Specialties', 'Specialty', 'Skills'], 'General Salon');
        const statusRaw = pickString(lk, ['Status'], 'Active');
        const status: Employee['status'] =
          statusRaw === 'On Leave' ? 'On Leave' : statusRaw === 'Inactive' ? 'Inactive' : 'Active';
        db.employees.push({
          id: pickString(lk, ['ID', 'EmployeeID']) || makeId('EMP-HIST'),
          fullName,
          roleTitle: pickString(lk, ['RoleTitle', 'Role Title', 'Role', 'Title', 'Position'], 'Salon Stylist'),
          phone: pickString(lk, ['Phone', 'Phone Number', 'Tel', 'Mobile'], 'N/A'),
          email: pickString(lk, ['Email', 'Email Address'], `${normKey(fullName)}@trendysalon.ug`),
          nationalId: pickString(lk, ['NationalID', 'National ID', 'NIN']) || undefined,
          homeAddress: pickString(lk, ['HomeAddress', 'Address']) || undefined,
          specialties: specsRaw.split(',').map((s) => s.trim()).filter(Boolean),
          status,
          active: status !== 'Inactive',
          hireDate: parseIsoDate(pickField(lk, ['HireDate', 'Hire Date', 'Joined', 'Date']), todayDateStr()),
          lunchEligible: pickString(lk, ['LunchEligible', 'Lunch Eligible'], 'true').toLowerCase() !== 'false',
          defaultShiftStart: '08:00',
          defaultShiftEnd: '20:00',
          workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
        });
        tabImported++;
      }
    } else if (entity === 'expenses') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const amount = pickNumber(lk, ['Amount', 'Amount (UGX)', 'AmountUGX', 'Total', 'Cost', 'UGX', 'Spent'], 0);
        const desc = pickString(lk, ['Description', 'Item', 'Expense', 'Particulars', 'Details', 'Title', 'Note']);
        if (amount <= 0 || !desc) continue;
        const expDate = parseIsoDate(pickField(lk, ['Date', 'ExpenseDate', 'RecordedDate', 'CreatedAt']), todayDateStr());
        const exists = db.expenses.some(
          (e) =>
            e.date === expDate &&
            e.amount === amount &&
            e.description.toLowerCase() === desc.toLowerCase()
        );
        if (exists) {
          tabSkipped++;
          continue;
        }
        db.expenses.push({
          id: pickString(lk, ['ID', 'ExpenseID']) || makeId('EXP-HIST'),
          date: expDate,
          category: pickString(lk, ['Category', 'Type', 'Group'], 'Other expenses'),
          description: desc,
          amount,
          paymentMethod: parsePaymentMethod(pickString(lk, ['PaymentMethod', 'Payment Method', 'Method', 'Mode'], 'Cash')),
          responsiblePerson: pickString(lk, ['ResponsiblePerson', 'Responsible', 'Recorded By', 'Paid By', 'Staff'], 'Historical Import'),
          status: 'Approved',
          approvedBy: 'Historical Record',
          isHistorical: true,
          createdBy: options.actorName,
          createdAt: new Date().toISOString(),
        });
        tabImported++;
      }
    } else if (entity === 'commissions') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const empName = pickString(lk, ['EmployeeName', 'Employee', 'Stylist', 'Staff', 'Barber', 'Worker']);
        const gross = pickNumber(lk, ['GrossEarnings', 'Gross', 'Gross Earnings', 'Sales', 'Amount', 'Total'], 0);
        const comm = pickNumber(lk, ['EmployeeCommission', 'Commission', 'Employee Commission', 'CommissionUGX', 'Pay', 'Share'], 0);
        if (!empName || (gross <= 0 && comm <= 0)) continue;

        const cDate = parseIsoDate(pickField(lk, ['Date', 'CreatedAt']), todayDateStr());
        const ref = pickString(lk, ['TransactionReference', 'Reference', 'Ref'], `HIST-${cDate}-${empName}-${gross}`);
        if (
          db.commissionLedger.some(
            (c) => c.transactionReference === ref && c.employeeName.toLowerCase() === empName.toLowerCase()
          )
        ) {
          tabSkipped++;
          continue;
        }

        const emp = db.employees.find((e) => e.fullName.toLowerCase() === empName.toLowerCase());
        const lunch = pickNumber(lk, ['LunchAllocation', 'Lunch', 'Lunch Deduction', 'LunchUGX'], 0);
        const effectiveGross = gross > 0 ? gross : comm;
        const net = pickNumber(lk, ['NetEarnings', 'NetCommissionableEarnings', 'Net', 'Net Earnings'], Math.max(0, effectiveGross - lunch));
        const salonShare = pickNumber(lk, ['SalonShare', 'Salon Share', 'SalonShareUGX'], Math.max(0, net - comm));
        const statusRaw = pickString(lk, ['PaymentStatus', 'Status'], 'Paid').toLowerCase();

        db.commissionLedger.push({
          id: pickString(lk, ['ID', 'CommissionID']) || makeId('COM-HIST'),
          transactionId: makeId('TX-HIST'),
          transactionReference: ref,
          date: cDate,
          employeeId: emp?.id || 'HISTORICAL',
          employeeName: empName,
          serviceName: pickString(lk, ['ServiceName', 'Service', 'Item'], 'Historical Service'),
          serviceCategory: pickString(lk, ['ServiceCategory', 'Category'], 'Historical'),
          grossEarnings: effectiveGross,
          lunchAllocation: lunch,
          netCommissionableEarnings: net,
          commissionRate: pickNumber(lk, ['CommissionRate', 'Rate'], net > 0 ? comm / net : 0),
          employeeCommission: comm,
          salonShare,
          paymentStatus: statusRaw.includes('unpaid') || statusRaw.includes('pending') ? 'Unpaid' : 'Paid',
          isHistorical: true,
          createdAt: new Date().toISOString(),
        });
        tabImported++;
      }
    } else if (entity === 'stock') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const name = pickString(lk, ['Name', 'Product Name', 'Product', 'Item', 'Item Name', 'Stock Item']);
        if (!name) continue;
        const sku = pickString(lk, ['SKU', 'Stock ID', 'Code']) || makeId('SKU');
        const exists = db.stockItems.some(
          (s) => s.name.toLowerCase() === name.toLowerCase() || (sku && s.sku.toLowerCase() === sku.toLowerCase())
        );
        if (exists) {
          tabSkipped++;
          continue;
        }
        const qty = pickNumber(lk, ['CurrentQuantity', 'Quantity', 'Current Quantity', 'Qty', 'Balance', 'Remaining'], 0);
        const openingQty = pickNumber(lk, ['OpeningQuantity', 'Opening Quantity'], qty);
        const sellingPrice = pickNumber(lk, ['SellingPrice', 'Selling Price', 'Price', 'Retail Price'], 0);
        db.stockItems.push({
          id: pickString(lk, ['ID', 'StockID']) || makeId('STK-HIST'),
          sku,
          name,
          category: pickString(lk, ['Category', 'Group'], 'Hair products'),
          brand: pickString(lk, ['Brand', 'Supplier'], 'Salon Stock'),
          unit: pickString(lk, ['Unit', 'UOM'], 'Unit'),
          openingQuantity: openingQty,
          currentQuantity: qty,
          purchasePrice: pickNumber(lk, ['PurchasePrice', 'Purchase Price', 'Cost', 'Buying Price'], 0),
          sellingPrice,
          minStockLevel: pickNumber(lk, ['MinStockLevel', 'Min Stock', 'MinStock', 'Reorder Level', 'Reorder'], 3),
          isRetail: sellingPrice > 0,
          active: true,
        });
        tabImported++;
      }
    } else if (entity === 'appointments') {
      for (const r of rows) {
        const lk = buildRowLookup(r);
        const customerName = pickString(lk, ['CustomerName', 'Customer', 'Client', 'Full Name', 'Name']);
        const serviceName = pickString(lk, ['ServiceName', 'Service', 'Treatment', 'Description'], 'Salon Service');
        if (!customerName) continue;
        const appDate = parseIsoDate(pickField(lk, ['Date', 'AppointmentDate']), todayDateStr());
        const startTime = parseTimeHhmm(pickString(lk, ['StartTime', 'Time', 'Start'], '09:00'));
        const exists = db.appointments.some(
          (a) =>
            a.date === appDate &&
            a.startTime === startTime &&
            a.customerName.toLowerCase() === customerName.toLowerCase()
        );
        if (exists) {
          tabSkipped++;
          continue;
        }
        const empName = pickString(lk, ['EmployeeName', 'Employee', 'Stylist', 'Barber', 'Staff']);
        const emp = db.employees.find((e) => e.fullName.toLowerCase() === empName.toLowerCase()) || db.employees[0];
        const srv = db.services.find((s) => s.name.toLowerCase() === serviceName.toLowerCase());
        const statusRaw = pickString(lk, ['Status'], 'Completed');
        const validStatuses: AppointmentStatus[] = [
          'Pending',
          'Confirmed',
          'Checked In',
          'In Progress',
          'Completed',
          'Cancelled',
          'No Show',
          'Rescheduled',
        ];
        const status: AppointmentStatus = validStatuses.includes(statusRaw as AppointmentStatus)
          ? (statusRaw as AppointmentStatus)
          : 'Completed';
        const nowIso = new Date().toISOString();

        const apt: Appointment = {
          id: pickString(lk, ['ID', 'AppointmentID']) || makeId('APT-HIST'),
          customerId: 'HIST',
          customerName,
          customerPhone: pickString(lk, ['CustomerPhone', 'Phone', 'Tel', 'Mobile'], 'N/A'),
          employeeId: emp?.id || 'HISTORICAL',
          employeeName: empName || emp?.fullName || 'Salon Stylist',
          serviceIds: [srv?.id || 'HIST'],
          serviceNames: [serviceName],
          date: appDate,
          startTime,
          durationMinutes: Math.max(15, pickNumber(lk, ['DurationMinutes', 'Duration'], srv?.durationMinutes || 45)),
          status,
          source: 'Scheduled',
          notes: `${sourceTag} (${sheetName})`,
          reminderSent: true,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        db.appointments.push(apt);
        tabImported++;
      }
    } else if (entity === 'transactions') {
      let seq = 0;
      for (const r of rows) {
        seq++;
        const lk = buildRowLookup(r);
        const total = pickNumber(lk, ['TotalAmount', 'Total', 'Amount', 'Sales', 'Revenue', 'Income', 'Price', 'AmountPaid'], 0);
        if (total <= 0) continue;
        const txDate = parseIsoDate(pickField(lk, ['Date', 'TransactionDate', 'CreatedAt']), todayDateStr());
        const srvName = pickString(lk, ['Service', 'ServiceName', 'Description', 'Item', 'Particulars'], 'Historical Service');
        const customerName = pickString(lk, ['CustomerName', 'Customer', 'Client', 'Full Name', 'Name'], 'Walk-in Client');
        const empName = pickString(lk, ['EmployeeName', 'Employee', 'Stylist', 'Staff', 'Barber', 'Worker']);
        const explicitRef = pickString(lk, ['Reference', 'Ref', 'Receipt', 'ReceiptNo', 'ID']);
        const ref = explicitRef || `HIST-${sheetName.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 6) || 'SHEET'}-${txDate}-${seq}`;

        const exists = db.posTransactions.some(
          (t) =>
            t.reference === ref ||
            (explicitRef === '' &&
              t.date === txDate &&
              t.totalAmount === total &&
              t.customerName.toLowerCase() === customerName.toLowerCase() &&
              t.items[0]?.name.toLowerCase() === srvName.toLowerCase())
        );
        if (exists) {
          tabSkipped++;
          continue;
        }

        const emp = db.employees.find((e) => e.fullName.toLowerCase() === empName.toLowerCase());
        const method = parsePaymentMethod(pickString(lk, ['PaymentMethod', 'Payment Method', 'PaymentMethods', 'Method', 'Mode'], 'Cash'));
        const statusRaw = pickString(lk, ['Status'], 'Completed');
        const txStatus: POSTransaction['status'] =
          statusRaw === 'Reversed' || statusRaw === 'Refunded' || statusRaw === 'Partial'
            ? statusRaw
            : statusRaw === 'Void'
              ? 'Reversed'
              : 'Completed';

        db.posTransactions.push({
          id: makeId('TX-HIST'),
          reference: ref,
          date: txDate,
          createdAt: new Date().toISOString(),
          customerName,
          cashierId: options.actorUserId,
          cashierName: pickString(lk, ['CashierName', 'Cashier', 'Recorded By'], 'Historical Import'),
          items: [
            {
              id: makeId('ITEM'),
              itemType: 'service',
              refId: 'HIST',
              name: srvName,
              categoryName: pickString(lk, ['Category', 'Department'], 'Hair Styling'),
              employeeId: emp?.id,
              employeeName: empName || undefined,
              quantity: Math.max(1, pickNumber(lk, ['Quantity', 'Qty'], 1)),
              unitPrice: total,
              discount: pickNumber(lk, ['Discount', 'DiscountTotal'], 0),
              lineTotal: total,
            },
          ],
          subtotal: total,
          discountTotal: pickNumber(lk, ['DiscountTotal', 'Discount'], 0),
          taxAmount: 0,
          tipAmount: pickNumber(lk, ['TipAmount', 'Tip'], 0),
          totalAmount: total,
          amountPaid: pickNumber(lk, ['AmountPaid', 'Paid'], total),
          balanceDue: pickNumber(lk, ['BalanceDue', 'Balance'], 0),
          payments: [
            {
              id: makeId('PAY-HIST'),
              transactionId: ref,
              method,
              amount: total,
              paidAt: new Date().toISOString(),
              recordedBy: 'Historical Import',
            },
          ],
          status: txStatus,
          isHistorical: true,
          notes: `${sourceTag} (${sheetName})`,
        });
        tabImported++;
      }
    }

    if (tabImported > 0 || tabSkipped > 0) {
      sheetsImported.push(sheetName);
    }
    importedCount += tabImported;
    skippedDuplicates += tabSkipped;
    tabSummaries.push({
      tabName: sheetName,
      detectedType: entity,
      totalRows: rows.length,
      importedCount: tabImported,
      skippedDuplicates: tabSkipped,
      columns,
    });
  }

  if (importedCount > 0) {
    db.migrationLogs.unshift({
      id: makeId('MIG'),
      fileName: options.fileName,
      migratedAt: new Date().toISOString(),
      migratedBy: options.actorName,
      backupId: backupId || 'AUTO-HYDRATE',
      sheetsImported,
      recordsImported: importedCount,
      notes: `${sourceTag}. Historical records preserved with isHistorical=true; skipped ${skippedDuplicates} duplicates.`,
    });

    db.auditLogs.unshift({
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: new Date().toISOString(),
      userId: options.actorUserId,
      userName: options.actorName,
      userRole: options.actorRole,
      action: 'HISTORICAL_DATA_MIGRATED',
      entityType: 'DataMigrationLog',
      entityId: backupId || options.fileName,
      details: `Imported ${importedCount} historical records from ${options.fileName} (${sheetsImported.join(', ')}).`,
    });
  }

  return {
    backupId,
    importedCount,
    skippedDuplicates,
    sheetsImported,
    tabSummaries,
  };
}
