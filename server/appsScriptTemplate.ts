export function generateAppsScriptCode(spreadsheetId?: string): string {
  const idLiteral = spreadsheetId || 'YOUR_SPREADSHEET_ID_HERE';
  return `/**
 * Trendy Unisex Salon Management System — Google Apps Script Backend
 * Business: Trendy Unisex Salon, Busia District Road, Madibira 'A', Uganda
 * Currency: UGX
 *
 * Deployment Instructions:
 * 1. Open script.google.com and create a new project bound to your Salon Spreadsheet.
 * 2. Paste this code into Code.gs.
 * 3. Replace SPREADSHEET_ID if running standalone, then Deploy > New deployment > Web App.
 * 4. Execute as: Me | Who has access: Anyone with Google account (verified via Session/Token).
 */

const SPREADSHEET_ID = '${idLiteral}';

const REQUIRED_SHEETS = [
  'Users', 'Employees', 'Employee Schedules', 'Attendance', 'Leave Records',
  'Customers', 'Customer Notes', 'Customer Preferences', 'Customer Visits',
  'Appointments', 'Appointment Services', 'Appointment Reminders', 'Customer Feedback', 'Loyalty Points',
  'Services', 'Service Categories', 'Service Pricing History',
  'Daily Sales', 'Sales Items', 'POS Transactions', 'Transaction Payments', 'Refunds', 'Tips',
  'Gift Cards', 'Gift Card Transactions',
  'Commission Policies', 'Lunch Deductions', 'Commission Ledger', 'Commission Payments', 'Commission Adjustments',
  'Expenses', 'Expense Categories', 'Suppliers', 'Stock Items', 'Stock Purchases', 'Stock Movements', 'Stock Usage', 'Stock Adjustments',
  'Settings', 'Notifications', 'Audit Logs', 'Data Migration Logs', 'System Backups'
];

function getSpreadsheet_() {
  return SPREADSHEET_ID !== 'YOUR_SPREADSHEET_ID_HERE'
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function initializeSalonWorkbook() {
  const ss = getSpreadsheet_();
  REQUIRED_SHEETS.forEach((name) => {
    if (!ss.getSheetByName(name)) {
      ss.insertSheet(name);
    }
  });
  return { status: 'ok', sheetsCount: REQUIRED_SHEETS.length };
}

/**
 * Confirmed Commission & Lunch Deduction Calculation Rule:
 * 1. Deduct UGX 2,500 once per working day from gross daily earnings BEFORE commission.
 * 2. Net Commissionable Earnings = Gross Daily Earnings - Lunch Deduction.
 * 3. Employee Commission = Net Commissionable Earnings * Rate (Plaiting 50%, Blow Dry 30%, Other 40%).
 * 4. Salon Share = Net Commissionable Earnings - Employee Commission.
 */
function calculateDailyCommission(grossEarnings, categoryName, lunchAlreadyDeductedToday) {
  const lunchDeduction = lunchAlreadyDeductedToday ? 0 : Math.min(2500, grossEarnings);
  const netCommissionable = Math.max(0, grossEarnings - lunchDeduction);
  const normalized = String(categoryName || '').toLowerCase();
  let rate = 0.40;
  if (normalized.indexOf('plait') !== -1) rate = 0.50;
  else if (normalized.indexOf('blow dry') !== -1 || normalized.indexOf('blowdry') !== -1) rate = 0.30;

  const employeeCommission = Math.round(netCommissionable * rate);
  const salonShare = netCommissionable - employeeCommission;
  return {
    grossEarnings: grossEarnings,
    lunchDeduction: lunchDeduction,
    netCommissionable: netCommissionable,
    commissionRate: rate,
    employeeCommission: employeeCommission,
    salonShare: salonShare
  };
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'health';
  if (action === 'health') {
    return jsonResponse_({ ok: true, business: 'Trendy Unisex Salon', sheets: REQUIRED_SHEETS.length });
  }
  if (action === 'readSheet') {
    const sheetName = e.parameter.sheet;
    if (!sheetName) return jsonResponse_({ error: 'Missing sheet parameter' }, 400);
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) return jsonResponse_({ error: 'Sheet not found: ' + sheetName }, 404);
    return jsonResponse_({ sheet: sheetName, rows: sheet.getDataRange().getValues() });
  }
  return jsonResponse_({ error: 'Unsupported action' }, 400);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'appendRow') {
      const ss = getSpreadsheet_();
      const sheet = ss.getSheetByName(payload.sheet);
      if (!sheet) return jsonResponse_({ error: 'Sheet not found' }, 404);
      sheet.appendRow(payload.values || []);
      return jsonResponse_({ ok: true, sheet: payload.sheet });
    }
    if (payload.action === 'initWorkbook') {
      return jsonResponse_(initializeSalonWorkbook());
    }
    return jsonResponse_({ error: 'Unknown action' }, 400);
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
}
