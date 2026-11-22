import crypto from 'node:crypto';
import type { DriveDocumentCategory, SalonDatabase } from './types.ts';

export const SALON_DRIVE_ROOT_FOLDER_NAME = 'Trendy Unisex Salon - Records & Media';

export const DRIVE_CATEGORY_SUBFOLDERS: Record<DriveDocumentCategory, string> = {
  'Employee Photo': 'Employee Photos',
  'National ID': 'National IDs',
  'Trading Licence': 'Business & Licensing',
  'Expense Receipt': 'Expense Receipts',
  'Staff Contract': 'Staff Contracts',
  'Salon Media': 'Salon Media',
  'Supplier Invoice': 'Supplier Invoices',
  Backup: 'Backups & Exports',
  Other: 'Other Documents',
};

const WORKSHEET_TITLES = [
  'Users',
  'Employees',
  'Employee Schedules',
  'Attendance',
  'Customers',
  'Appointments',
  'Services',
  'Daily Sales',
  'POS Transactions',
  'Commission Ledger',
  'Lunch Deductions',
  'Commission Payments',
  'Expenses',
  'Stock Items',
  'Stock Movements',
  'Gift Cards',
  'Audit Logs',
  'Settings',
  '_SystemState',
];

const SYSTEM_STATE_TAB = '_SystemState';
const STATE_CHUNK_SIZE = 40000;

let cachedServerToken: { token: string; expiresAt: number } | null = null;

function parseServiceAccountCredentials(): { clientEmail: string; privateKey: string } | null {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch {
      // Fall through to individual env vars
    }
  }
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (clientEmail && privateKey) {
    return {
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    };
  }
  return null;
}

export function getAppsScriptBridgeUrl(settingsUrl?: string): string | undefined {
  const fromEnv = process.env.GOOGLE_APPS_SCRIPT_URL?.trim();
  const url = settingsUrl?.trim() || fromEnv;
  if (!url) return undefined;
  return url;
}

export function getServerGoogleCredentialsStatus(settingsAppsScriptUrl?: string): {
  configured: boolean;
  mode: 'apps_script' | 'refresh_token' | 'service_account' | 'none';
} {
  if (getAppsScriptBridgeUrl(settingsAppsScriptUrl)) {
    return { configured: true, mode: 'apps_script' };
  }
  if (
    process.env.GOOGLE_CLIENT_ID?.trim() &&
    process.env.GOOGLE_CLIENT_SECRET?.trim() &&
    process.env.GOOGLE_REFRESH_TOKEN?.trim()
  ) {
    return { configured: true, mode: 'refresh_token' };
  }
  if (parseServiceAccountCredentials()) {
    return { configured: true, mode: 'service_account' };
  }
  return { configured: false, mode: 'none' };
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function getServerGoogleAccessToken(): Promise<string | null> {
  if (cachedServerToken && cachedServerToken.expiresAt > Date.now() + 60_000) {
    return cachedServerToken.token;
  }

  const sa = parseServiceAccountCredentials();
  if (sa) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claimSet = base64UrlEncode(
      JSON.stringify({
        iss: sa.clientEmail,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
        aud: 'https://oauth2.googleapis.com/token',
        exp: nowSec + 3600,
        iat: nowSec,
      })
    );
    const unsignedJwt = `${header}.${claimSet}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    const signature = base64UrlEncode(signer.sign(sa.privateKey));
    const assertion = `${unsignedJwt}.${signature}`;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Service account token exchange failed (${tokenRes.status}): ${errText}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    cachedServerToken = {
      token: tokenJson.access_token,
      expiresAt: Date.now() + (tokenJson.expires_in || 3500) * 1000,
    };
    return cachedServerToken.token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`OAuth refresh token exchange failed (${tokenRes.status}): ${errText}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token: string; expires_in?: number };
    cachedServerToken = {
      token: tokenJson.access_token,
      expiresAt: Date.now() + (tokenJson.expires_in || 3500) * 1000,
    };
    return cachedServerToken.token;
  }

  return null;
}

function encodeSystemStateRows(db: SalonDatabase): (string | number | boolean)[][] {
  const json = JSON.stringify(db);
  const chunks: string[] = [];
  for (let i = 0; i < json.length; i += STATE_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + STATE_CHUNK_SIZE));
  }
  return [
    ['ChunkIndex', 'UpdatedAt', 'TotalChunks', 'Payload'],
    ...chunks.map((chunk, idx) => [idx, new Date().toISOString(), chunks.length, chunk]),
  ];
}

export function getRelevantSheetTabsForApiPath(apiPath: string): string[] | undefined {
  const p = apiPath.toLowerCase();
  if (p.startsWith('/pos/')) {
    return [
      '_SystemState',
      'POS Transactions',
      'Daily Sales',
      'Commission Ledger',
      'Lunch Deductions',
      'Customers',
      'Appointments',
      'Stock Items',
      'Stock Movements',
      'Gift Cards',
      'Audit Logs',
      'Settings',
    ];
  }
  if (p.startsWith('/appointments') || p.startsWith('/walk-ins') || p.startsWith('/public/bookings')) {
    return ['_SystemState', 'Appointments', 'Customers', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/customers')) {
    return ['_SystemState', 'Customers', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/employees') || p.startsWith('/schedules') || p.startsWith('/attendance') || p.startsWith('/leaves')) {
    return ['_SystemState', 'Employees', 'Employee Schedules', 'Attendance', 'Users', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/services')) {
    return ['_SystemState', 'Services', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/commissions')) {
    return ['_SystemState', 'Commission Ledger', 'Lunch Deductions', 'Commission Payments', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/expenses')) {
    return ['_SystemState', 'Expenses', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/inventory')) {
    return ['_SystemState', 'Stock Items', 'Stock Movements', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/gift-cards')) {
    return ['_SystemState', 'Gift Cards', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/users')) {
    return ['_SystemState', 'Users', 'Employees', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/auth/')) {
    return ['_SystemState', 'Audit Logs', 'Settings'];
  }
  if (p.startsWith('/settings')) {
    return ['_SystemState', 'Settings', 'Audit Logs'];
  }
  return undefined;
}

export function buildSheetMatrix(
  db: SalonDatabase,
  onlyTabs?: string[]
): Record<string, (string | number | boolean)[][]> {
  const fullMatrix: Record<string, (string | number | boolean)[][]> = {
    Users: [
      ['ID', 'Name', 'Email', 'Role', 'EmployeeID', 'Active', 'CreatedAt'],
      ...db.users.map((u) => [u.id, u.name, u.email, u.role, u.employeeId || '', u.active, u.createdAt]),
    ],
    Employees: [
      [
        'ID',
        'FullName',
        'RoleTitle',
        'Phone',
        'SecondaryPhone',
        'Email',
        'NationalID',
        'NationalIDDocOnFile',
        'HomeAddress',
        'EmergencyContact',
        'EmergencyPhone',
        'Specialties',
        'LunchEligible',
        'Active',
        'HireDate',
        'Status',
        'LastDocumentUpdate',
      ],
      ...db.employees.map((e) => [
        e.id,
        e.fullName,
        e.roleTitle,
        e.phone,
        e.secondaryPhone || '',
        e.email,
        e.nationalId || '',
        Boolean(e.nationalIdDocumentUrl || e.nationalIdBackUrl),
        e.homeAddress || '',
        e.emergencyContactName || '',
        e.emergencyContactPhone || '',
        e.specialties.join(', '),
        e.lunchEligible,
        e.active,
        e.hireDate,
        e.status || (e.active ? 'Active' : 'Inactive'),
        e.lastDocumentUpdatedAt || '',
      ]),
    ],
    'Employee Schedules': [
      ['ID', 'EmployeeID', 'Date', 'ShiftStart', 'ShiftEnd', 'IsDayOff', 'Notes'],
      ...db.schedules.map((s) => [s.id, s.employeeId, s.date, s.shiftStart, s.shiftEnd, s.isDayOff, s.notes || '']),
    ],
    Attendance: [
      ['ID', 'EmployeeID', 'Date', 'ClockIn', 'ClockOut', 'HoursWorked', 'Status', 'Notes'],
      ...db.attendance.map((a) => [
        a.id,
        a.employeeId,
        a.date,
        a.clockIn || '',
        a.clockOut || '',
        a.hoursWorked,
        a.status,
        a.notes || '',
      ]),
    ],
    Customers: [
      ['ID', 'FullName', 'Phone', 'Email', 'Gender', 'RegistrationDate', 'LoyaltyPoints', 'Tier', 'TotalVisits', 'TotalSpent', 'LastVisit'],
      ...db.customers.map((c) => [
        c.id,
        c.fullName,
        c.phone,
        c.email || '',
        c.gender || '',
        c.registrationDate,
        c.loyaltyPoints,
        c.loyaltyTier,
        c.totalVisits,
        c.totalSpent,
        c.lastVisitDate || '',
      ]),
    ],
    Appointments: [
      ['ID', 'Customer', 'Phone', 'Employee', 'Services', 'Date', 'StartTime', 'DurationMin', 'Status', 'Source'],
      ...db.appointments.map((a) => [
        a.id,
        a.customerName,
        a.customerPhone,
        a.employeeName,
        a.serviceNames.join(', '),
        a.date,
        a.startTime,
        a.durationMinutes,
        a.status,
        a.source,
      ]),
    ],
    Services: [
      ['ID', 'Name', 'Category', 'PriceUGX', 'DurationMin', 'Active'],
      ...db.services.map((s) => [s.id, s.name, s.categoryName, s.price, s.durationMinutes, s.active]),
    ],
    'Daily Sales': [
      ['Reference', 'Date', 'Customer', 'SubtotalUGX', 'DiscountUGX', 'TipUGX', 'TotalUGX', 'PaidUGX', 'BalanceUGX', 'Status'],
      ...db.posTransactions.map((t) => [
        t.reference,
        t.date,
        t.customerName,
        t.subtotal,
        t.discountTotal,
        t.tipAmount,
        t.totalAmount,
        t.amountPaid,
        t.balanceDue,
        t.status,
      ]),
    ],
    'POS Transactions': [
      ['ID', 'Reference', 'Date', 'Cashier', 'Customer', 'TotalUGX', 'AmountPaidUGX', 'BalanceDueUGX', 'Status', 'IsHistorical'],
      ...db.posTransactions.map((t) => [
        t.id,
        t.reference,
        t.date,
        t.cashierName,
        t.customerName,
        t.totalAmount,
        t.amountPaid,
        t.balanceDue,
        t.status,
        Boolean(t.isHistorical),
      ]),
    ],
    'Commission Ledger': [
      ['ID', 'TransactionRef', 'Date', 'Employee', 'Service', 'Category', 'GrossUGX', 'LunchAllocUGX', 'NetCommissionableUGX', 'Rate', 'CommissionUGX', 'SalonShareUGX', 'Status', 'IsHistorical'],
      ...db.commissionLedger.map((c) => [
        c.id,
        c.transactionReference,
        c.date,
        c.employeeName,
        c.serviceName,
        c.serviceCategory,
        c.grossEarnings,
        c.lunchAllocation,
        c.netCommissionableEarnings,
        c.commissionRate,
        c.employeeCommission,
        c.salonShare,
        c.paymentStatus,
        Boolean(c.isHistorical),
      ]),
    ],
    'Lunch Deductions': [
      ['ID', 'EmployeeID', 'EmployeeName', 'Date', 'AmountUGX', 'AllocationMethod', 'GrossDailyEarningsUGX', 'IsHistorical'],
      ...db.lunchDeductions.map((l) => [
        l.id,
        l.employeeId,
        l.employeeName,
        l.date,
        l.amount,
        l.allocationMethod,
        l.grossDailyEarnings,
        Boolean(l.isHistorical),
      ]),
    ],
    'Commission Payments': [
      ['ID', 'Reference', 'Employee', 'AmountUGX', 'PaymentDate', 'Method', 'PaidBy', 'Notes'],
      ...db.commissionPayments.map((p) => [
        p.id,
        p.reference,
        p.employeeName,
        p.amount,
        p.paymentDate,
        p.paymentMethod,
        p.paidByName,
        p.notes || '',
      ]),
    ],
    Expenses: [
      ['ID', 'Date', 'Category', 'Description', 'AmountUGX', 'Method', 'Responsible', 'Status', 'ApprovedBy'],
      ...db.expenses.map((e) => [
        e.id,
        e.date,
        e.category,
        e.description,
        e.amount,
        e.paymentMethod,
        e.responsiblePerson,
        e.status,
        e.approvedBy || '',
      ]),
    ],
    'Stock Items': [
      ['ID', 'SKU', 'Name', 'InventoryPart', 'Category', 'Brand', 'Unit', 'CurrentQty', 'PurchasePriceUGX', 'SellingPriceUGX', 'MinLevel', 'Retail'],
      ...db.stockItems.map((s) => [
        s.id,
        s.sku,
        s.name,
        s.inventoryGroup === 'for_sale' || (s.inventoryGroup !== 'salon_owned' && s.isRetail)
          ? 'Items for Sale'
          : 'Owned by Salon',
        s.category,
        s.brand,
        s.unit,
        s.currentQuantity,
        s.purchasePrice,
        s.sellingPrice,
        s.minStockLevel,
        s.isRetail,
      ]),
    ],
    'Stock Movements': [
      ['ID', 'StockItem', 'Date', 'Type', 'Delta', 'QuantityAfter', 'ReferenceID', 'RecordedBy', 'Notes'],
      ...db.stockMovements.map((m) => [
        m.id,
        m.stockItemName,
        m.date,
        m.type,
        m.quantityDelta,
        m.quantityAfter,
        m.referenceId || '',
        m.recordedBy,
        m.notes || '',
      ]),
    ],
    'Gift Cards': [
      ['ID', 'Code', 'Customer', 'InitialValueUGX', 'BalanceUGX', 'IssuedDate', 'ExpirationDate', 'Status'],
      ...db.giftCards.map((g) => [
        g.id,
        g.code,
        g.customerName || '',
        g.initialValue,
        g.balance,
        g.issuedDate,
        g.expirationDate || '',
        g.status,
      ]),
    ],
    'Audit Logs': [
      ['ID', 'Timestamp', 'User', 'Role', 'Action', 'EntityType', 'EntityID', 'Details'],
      ...db.auditLogs.slice(0, 500).map((a) => [
        a.id,
        a.timestamp,
        a.userName,
        a.userRole,
        a.action,
        a.entityType,
        a.entityId,
        a.details,
      ]),
    ],
    Settings: [
      ['Key', 'Value'],
      ['BusinessName', db.settings.businessName],
      ['Tagline', db.settings.tagline],
      ['AudienceTagline', db.settings.audienceTagline || 'For Him · For Her · For Everyone'],
      ['Location', db.settings.location],
      ['Currency', db.settings.currency],
      ['Phone', db.settings.phone],
      ['SocialHandle', db.settings.socialHandle || '@Trendyunisex.salon'],
      ['WalkInsWelcome', db.settings.walkInsWelcome === false ? 'No' : 'Yes'],
      ['OperatingHours', db.settings.operatingHours],
      ['LastSyncAt', new Date().toISOString()],
    ],
    [SYSTEM_STATE_TAB]: encodeSystemStateRows(db),
  };
  if (!onlyTabs || onlyTabs.length === 0) {
    return fullMatrix;
  }
  const allow = new Set([...onlyTabs, SYSTEM_STATE_TAB]);
  const filtered: Record<string, (string | number | boolean)[][]> = {};
  for (const [key, val] of Object.entries(fullMatrix)) {
    if (allow.has(key)) {
      filtered[key] = val;
    }
  }
  return filtered;
}

export async function createSalonGoogleSpreadsheet(
  accessToken: string,
  db: SalonDatabase
): Promise<{ spreadsheetId: string; spreadsheetUrl: string; sheetCount: number }> {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: `Trendy Unisex Salon Database (${new Date().toISOString().slice(0, 10)})`,
      },
      sheets: WORKSHEET_TITLES.map((title) => ({
        properties: { title },
      })),
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Google Sheets creation failed (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };

  await syncDatabaseToGoogleSheet(accessToken, created.spreadsheetId, db);

  return {
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    sheetCount: WORKSHEET_TITLES.length,
  };
}

export async function syncDatabaseToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  db: SalonDatabase,
  onlyTabs?: string[]
): Promise<{ updatedCells: number; sheetTabs: string[] }> {
  // First fetch existing spreadsheet metadata so we never assume sheet names blindly
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Failed to inspect spreadsheet metadata (${metaRes.status}): ${errText}`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const existingTitles = new Set(
    (meta.sheets || []).map((s) => s.properties?.title).filter((t): t is string => Boolean(t))
  );

  // Add any missing tabs
  const missingTitles = WORKSHEET_TITLES.filter((t) => !existingTitles.has(t));
  if (missingTitles.length > 0) {
    const batchAddRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingTitles.map((title) => ({
            addSheet: { properties: { title } },
          })),
        }),
      }
    );
    if (!batchAddRes.ok) {
      const errText = await batchAddRes.text();
      throw new Error(`Failed to create missing worksheet tabs: ${errText}`);
    }
  }

  const matrix = buildSheetMatrix(db, onlyTabs);
  const data = Object.entries(matrix).map(([sheetTitle, values]) => ({
    range: `'${sheetTitle}'!A1`,
    majorDimension: 'ROWS',
    values,
  }));

  // Clear and update each tab cleanly
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ranges: Object.keys(matrix).map((t) => `'${t}'!A1:Z5000`),
      }),
    }
  );

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data,
      }),
    }
  );

  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Failed to sync values to Google Sheets: ${errText}`);
  }

  const updateJson = (await updateRes.json()) as { totalUpdatedCells?: number };
  return {
    updatedCells: updateJson.totalUpdatedCells || 0,
    sheetTabs: Object.keys(matrix),
  };
}

export async function syncSystemStateOnlyToGoogleSheet(
  accessToken: string,
  spreadsheetId: string,
  db: SalonDatabase
): Promise<void> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Failed to inspect spreadsheet metadata (${metaRes.status}): ${errText}`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const existingTitles = new Set(
    (meta.sheets || []).map((s) => s.properties?.title).filter((t): t is string => Boolean(t))
  );

  if (!existingTitles.has(SYSTEM_STATE_TAB)) {
    const addRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [{ addSheet: { properties: { title: SYSTEM_STATE_TAB } } }],
        }),
      }
    );
    if (!addRes.ok) {
      const errText = await addRes.text();
      throw new Error(`Failed to create _SystemState tab: ${errText}`);
    }
  }

  const values = encodeSystemStateRows(db);
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ranges: [`'${SYSTEM_STATE_TAB}'!A1:D5000`] }),
    }
  );

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [{ range: `'${SYSTEM_STATE_TAB}'!A1`, majorDimension: 'ROWS', values }],
      }),
    }
  );
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Failed to save _SystemState snapshot: ${errText}`);
  }
}

export async function readDatabaseFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<SalonDatabase | null> {
  const range = encodeURIComponent(`'${SYSTEM_STATE_TAB}'!A1:D500`);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 400 || res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to read Google Sheet database state (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  const rows = data.values || [];
  if (rows.length < 2) {
    return null;
  }
  const payload = rows
    .slice(1)
    .sort((a, b) => Number(a[0] || 0) - Number(b[0] || 0))
    .map((r) => r[3] || '')
    .join('');

  if (!payload.trim()) return null;
  const parsed = JSON.parse(payload) as SalonDatabase;
  if (!parsed || !Array.isArray(parsed.users) || !parsed.settings) {
    return null;
  }
  return parsed;
}

export interface WorkbookReadResult {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  hasSystemState: boolean;
  tabSummaries: Array<{ name: string; rowCount: number; headers: string[] }>;
  sheets: Record<string, Record<string, unknown>[]>;
}

export async function readWorkbookFromGoogleSheet(
  accessToken: string,
  spreadsheetId: string
): Promise<WorkbookReadResult> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetUrl,sheets.properties.title`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Unable to inspect Google Spreadsheet (${metaRes.status}): ${errText}`);
  }
  const meta = (await metaRes.json()) as {
    spreadsheetUrl?: string;
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const allTitles = (meta.sheets || [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
  const hasSystemState = allTitles.includes(SYSTEM_STATE_TAB);
  const dataTabs = allTitles.filter((t) => t !== SYSTEM_STATE_TAB);

  const sheets: Record<string, Record<string, unknown>[]> = {};
  const tabSummaries: Array<{ name: string; rowCount: number; headers: string[] }> = [];

  if (dataTabs.length > 0) {
    const rangesQuery = dataTabs
      .map((t) => `ranges=${encodeURIComponent(`'${t}'!A1:Z5000`)}`)
      .join('&');
    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchGet?${rangesQuery}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!batchRes.ok) {
      const errText = await batchRes.text();
      throw new Error(`Failed to read Google Sheet tabs (${batchRes.status}): ${errText}`);
    }
    const batchJson = (await batchRes.json()) as {
      valueRanges?: Array<{ range?: string; values?: string[][] }>;
    };
    const valueRanges = batchJson.valueRanges || [];
    for (let idx = 0; idx < dataTabs.length; idx++) {
      const tabName = dataTabs[idx];
      const grid = valueRanges[idx]?.values || [];
      if (grid.length < 2) {
        const hdr = (grid[0] || []).map((h) => String(h || '').trim()).filter(Boolean);
        tabSummaries.push({ name: tabName, rowCount: 0, headers: hdr });
        continue;
      }
      const headers = (grid[0] || []).map((h, ci) => String(h || '').trim() || `Column_${ci + 1}`);
      const objects: Record<string, unknown>[] = [];
      for (let r = 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const obj: Record<string, unknown> = {};
        let hasContent = false;
        for (let c = 0; c < headers.length; c++) {
          const val = row[c] ?? '';
          if (String(val).trim() !== '') hasContent = true;
          obj[headers[c]] = val;
        }
        if (hasContent) objects.push(obj);
      }
      sheets[tabName] = objects;
      tabSummaries.push({ name: tabName, rowCount: objects.length, headers });
    }
  }

  return {
    spreadsheetId,
    spreadsheetUrl: meta.spreadsheetUrl,
    hasSystemState,
    tabSummaries,
    sheets,
  };
}

export async function readGoogleSheetTab(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle?: string
): Promise<{ availableTabs: string[]; activeTab: string; rows: string[][] }> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!metaRes.ok) {
    throw new Error(`Unable to read Google Spreadsheet (${metaRes.status})`);
  }
  const meta = (await metaRes.json()) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const availableTabs = (meta.sheets || [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));

  if (availableTabs.length === 0) {
    return { availableTabs: [], activeTab: '', rows: [] };
  }

  const activeTab = sheetTitle && availableTabs.includes(sheetTitle) ? sheetTitle : availableTabs[0];
  const valRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${activeTab}'!A1:Z500`)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!valRes.ok) {
    throw new Error(`Unable to read sheet tab "${activeTab}"`);
  }
  const valJson = (await valRes.json()) as { values?: string[][] };
  return {
    availableTabs,
    activeTab,
    rows: valJson.values || [],
  };
}

export function parseDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!match) {
    throw new Error('Invalid base64 data URL format.');
  }
  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  return { mimeType, buffer };
}

function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function verifyDriveFolderExists(accessToken: string, folderId: string): Promise<boolean> {
  if (!folderId) return false;
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,trashed,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { trashed?: boolean; mimeType?: string };
  return !json.trashed && json.mimeType === 'application/vnd.google-apps.folder';
}

export async function ensureDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<string> {
  const qParts = [
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    `name='${escapeDriveQueryLiteral(folderName)}'`,
  ];
  if (parentId) {
    qParts.push(`'${escapeDriveQueryLiteral(parentId)}' in parents`);
  }

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qParts.join(' and '))}&fields=files(id,name)&pageSize=5`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (searchRes.ok) {
    const searchJson = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (searchJson.files && searchJson.files.length > 0) {
      return searchJson.files[0].id;
    }
  }

  const createBody: Record<string, unknown> = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    createBody.parents = [parentId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createBody),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create Google Drive folder "${folderName}" (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as { id: string };
  return created.id;
}

export async function ensureSalonDriveRootFolder(
  accessToken: string,
  existingRootId?: string
): Promise<string> {
  if (existingRootId && (await verifyDriveFolderExists(accessToken, existingRootId))) {
    return existingRootId;
  }
  return ensureDriveFolder(accessToken, SALON_DRIVE_ROOT_FOLDER_NAME);
}

export async function ensureCategoryDriveFolder(
  accessToken: string,
  category: DriveDocumentCategory,
  existingRootId?: string
): Promise<{ rootFolderId: string; folderId: string; folderName: string }> {
  const rootFolderId = await ensureSalonDriveRootFolder(accessToken, existingRootId);
  const folderName = DRIVE_CATEGORY_SUBFOLDERS[category] || 'Other Documents';
  const folderId = await ensureDriveFolder(accessToken, folderName, rootFolderId);
  return { rootFolderId, folderId, folderName };
}

export async function uploadBinaryToGoogleDrive(
  accessToken: string,
  options: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    folderId?: string;
    description?: string;
  }
): Promise<{ id: string; name: string; mimeType: string; sizeBytes: number; webViewLink?: string }> {
  const metadata: Record<string, unknown> = {
    name: options.fileName,
    mimeType: options.mimeType,
    description: options.description || 'Uploaded by Trendy Unisex Salon Management System',
  };
  if (options.folderId) {
    metadata.parents = [options.folderId];
  }

  const boundary = `trendy_salon_bin_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const headerPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${options.mimeType}\r\n\r\n`;
  const footerPart = `\r\n--${boundary}--`;

  const bodyBuffer = Buffer.concat([
    Buffer.from(headerPart, 'utf8'),
    options.buffer,
    Buffer.from(footerPart, 'utf8'),
  ]);

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBuffer,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Google Drive upload failed (${uploadRes.status}): ${errText}`);
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    mimeType?: string;
    size?: string;
    webViewLink?: string;
  };

  return {
    id: uploaded.id,
    name: uploaded.name,
    mimeType: uploaded.mimeType || options.mimeType,
    sizeBytes: uploaded.size ? Number(uploaded.size) : options.buffer.length,
    webViewLink: uploaded.webViewLink,
  };
}

export async function fetchGoogleDriveFileMedia(
  accessToken: string,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,trashed`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw new Error(`Google Drive file lookup failed (${metaRes.status}): ${errText}`);
  }
  const meta = (await metaRes.json()) as { name?: string; mimeType?: string; trashed?: boolean };
  if (meta.trashed) {
    throw new Error('This file has been moved to Trash in Google Drive.');
  }

  const mediaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!mediaRes.ok) {
    const errText = await mediaRes.text();
    throw new Error(`Failed to download file bytes from Google Drive (${mediaRes.status}): ${errText}`);
  }
  const arrayBuf = await mediaRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuf),
    mimeType: meta.mimeType || 'application/octet-stream',
    name: meta.name || `drive_file_${fileId}`,
  };
}

export async function deleteGoogleDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 404) {
    return;
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to delete Google Drive file (${res.status}): ${errText}`);
  }
}

export async function backupDatabaseToGoogleDrive(
  accessToken: string,
  db: SalonDatabase,
  label: string
): Promise<{ id: string; name: string; webViewLink?: string; rootFolderId: string }> {
  const { rootFolderId, folderId } = await ensureCategoryDriveFolder(
    accessToken,
    'Backup',
    db.settings.googleDriveFolderId
  );
  const fileName = `Trendy_Unisex_Salon_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const uploaded = await uploadBinaryToGoogleDrive(accessToken, {
    fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(db, null, 2), 'utf8'),
    folderId,
    description: `${label} — Trendy Unisex Salon Management System`,
  });

  return {
    id: uploaded.id,
    name: uploaded.name,
    webViewLink: uploaded.webViewLink,
    rootFolderId,
  };
}

export async function listAppDriveFiles(accessToken: string) {
  const q = "trashed=false and mimeType!='application/vnd.google-apps.folder'";
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,size,webViewLink,parents)&orderBy=modifiedTime desc&pageSize=50`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to list Google Drive files (${res.status}): ${errText}`);
  }
  return (await res.json()) as {
    files: Array<{
      id: string;
      name: string;
      mimeType: string;
      modifiedTime: string;
      size?: string;
      webViewLink?: string;
      parents?: string[];
    }>;
  };
}

function normalizeAndValidateAppsScriptUrl(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) {
    throw new Error('Apps Script Web App URL is empty.');
  }
  if (url.includes('docs.google.com/spreadsheets/')) {
    throw new Error(
      'You pasted a Google Spreadsheet URL into the Apps Script field. Paste the Spreadsheet link/ID in the "Google Spreadsheet ID" field below instead, or deploy Code.gs in Extensions → Apps Script and paste the /exec Web App URL here.'
    );
  }
  if (/^https:\/\/script\.google\.com\/.*\/dev(\?.*)?$/i.test(url)) {
    throw new Error(
      'You pasted a "/dev" test deployment URL, which requires a Google login cookie (HTTP 401). In Apps Script, click Deploy → Manage deployments → copy the Web app URL ending in "/exec" with Who has access set to "Anyone".'
    );
  }
  if (/^https:\/\/script\.google\.com\/.*\/edit/i.test(url) || url.includes('/home/projects/')) {
    throw new Error(
      'You pasted the Apps Script editor URL instead of the deployed Web App URL. Click Deploy → New deployment → Web app ("Execute as: Me", "Who has access: Anyone") and copy the URL ending in "/exec".'
    );
  }
  return url;
}

// ==================== GOOGLE APPS SCRIPT WEB APP BRIDGE (NO SERVICE ACCOUNT) ====================
async function callAppsScriptBridge<T>(
  bridgeUrl: string,
  action: string,
  payload: Record<string, unknown> = {},
  timeoutMs?: number
): Promise<T> {
  const validUrl = normalizeAndValidateAppsScriptUrl(bridgeUrl);
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET?.trim() || undefined;
  const effectiveTimeout =
    timeoutMs ??
    (action === 'readState' || action === 'health' || action === 'readSheet' || action === 'readWorkbook'
      ? 12_000
      : 22_000);

  let res: Response;
  try {
    res = await fetch(validUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal: AbortSignal.timeout(effectiveTimeout),
      body: JSON.stringify({
        action,
        ...(secret ? { secret } : {}),
        ...payload,
      }),
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message.toLowerCase().includes('timeout'))
    ) {
      throw new Error(
        `Google Sheets Apps Script bridge timed out after ${Math.round(effectiveTimeout / 1000)}s during "${action}".`
      );
    }
    throw err;
  }

  const text = await res.text();
  const isGoogleLoginHtml =
    res.status === 401 ||
    res.status === 403 ||
    text.includes('ppConfig') ||
    text.includes('ServiceLogin') ||
    text.includes('accounts.google.com');

  if (isGoogleLoginHtml) {
    throw new Error(
      `Google returned HTTP ${res.status} (Sign-In Required) for this Apps Script URL. Fix: In your Sheet open Extensions → Apps Script → Deploy → Manage deployments → Edit (pencil) → set "Who has access" to "Anyone" (NOT "Only myself" and NOT "Anyone with Google account"), choose "New version", click Deploy, and copy the "/exec" URL. Or leave Apps Script blank, click "Connect Google Workspace", and paste your Sheet URL/ID below.`
    );
  }

  if (!res.ok) {
    throw new Error(`Apps Script bridge HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let parsed: { ok?: boolean; error?: string } & T;
  try {
    parsed = JSON.parse(text) as { ok?: boolean; error?: string } & T;
  } catch {
    throw new Error(
      'Apps Script returned HTML instead of JSON. Ensure the Web App is deployed as a New version with Execute as "Me" and Who has access "Anyone", and that you pasted the "/exec" URL.'
    );
  }

  if (parsed.ok === false || parsed.error) {
    throw new Error(parsed.error || 'Apps Script bridge action failed.');
  }
  return parsed;
}

export async function testAppsScriptBridge(
  bridgeUrl: string,
  spreadsheetId?: string
): Promise<{
  ok: boolean;
  spreadsheetId: string;
  spreadsheetUrl: string;
  rootFolderId: string;
  hasSystemState?: boolean;
  sheetTabs?: Array<{ name: string; rowCount: number; headers?: string[] }>;
}> {
  return callAppsScriptBridge(bridgeUrl, 'health', {
    ...(spreadsheetId ? { spreadsheetId } : {}),
  });
}

export async function createNewSheetViaAppsScript(
  bridgeUrl: string,
  db: SalonDatabase,
  title = 'Trendy Unisex Salon — Database'
): Promise<{
  spreadsheetId: string;
  spreadsheetUrl: string;
  rootFolderId?: string;
  sheetCount: number;
}> {
  const matrix = buildSheetMatrix(db);
  return callAppsScriptBridge(bridgeUrl, 'createNewSheet', { title, sheets: matrix });
}

export async function syncDatabaseViaAppsScript(
  bridgeUrl: string,
  db: SalonDatabase,
  onlyTabs?: string[]
): Promise<{
  updatedCells: number;
  sheetTabs: string[];
  spreadsheetId: string;
  spreadsheetUrl: string;
}> {
  const matrix = buildSheetMatrix(db, onlyTabs);
  return callAppsScriptBridge(bridgeUrl, 'syncMatrix', {
    spreadsheetId: db.settings.googleSpreadsheetId || undefined,
    sheets: matrix,
  });
}

export async function syncSystemStateOnlyViaAppsScript(
  bridgeUrl: string,
  db: SalonDatabase
): Promise<{
  updatedCells: number;
  sheetTabs: string[];
  spreadsheetId: string;
  spreadsheetUrl: string;
}> {
  return callAppsScriptBridge(bridgeUrl, 'syncMatrix', {
    spreadsheetId: db.settings.googleSpreadsheetId || undefined,
    sheets: { [SYSTEM_STATE_TAB]: encodeSystemStateRows(db) },
  });
}

export async function readWorkbookViaAppsScript(
  bridgeUrl: string,
  spreadsheetId?: string
): Promise<WorkbookReadResult> {
  const res = await callAppsScriptBridge<{
    spreadsheetId?: string;
    spreadsheetUrl?: string;
    hasSystemState?: boolean;
    tabSummaries?: Array<{ name: string; rowCount: number; headers: string[] }>;
    sheets?: Record<string, Record<string, unknown>[]>;
  }>(bridgeUrl, 'readWorkbook', {
    ...(spreadsheetId ? { spreadsheetId } : {}),
  });
  return {
    spreadsheetId: res.spreadsheetId,
    spreadsheetUrl: res.spreadsheetUrl,
    hasSystemState: Boolean(res.hasSystemState),
    tabSummaries: res.tabSummaries || [],
    sheets: res.sheets || {},
  };
}

export async function readDatabaseViaAppsScript(
  bridgeUrl: string,
  spreadsheetId?: string
): Promise<{ db: SalonDatabase | null; spreadsheetId?: string; spreadsheetUrl?: string }> {
  const res = await callAppsScriptBridge<{
    rows?: string[][];
    spreadsheetId?: string;
    spreadsheetUrl?: string;
  }>(bridgeUrl, 'readState', {
    ...(spreadsheetId ? { spreadsheetId } : {}),
  });

  const rows = res.rows || [];
  if (rows.length < 2) {
    return { db: null, spreadsheetId: res.spreadsheetId, spreadsheetUrl: res.spreadsheetUrl };
  }
  const payload = rows
    .slice(1)
    .sort((a, b) => Number(a[0] || 0) - Number(b[0] || 0))
    .map((r) => r[3] || '')
    .join('');

  if (!payload.trim()) {
    return { db: null, spreadsheetId: res.spreadsheetId, spreadsheetUrl: res.spreadsheetUrl };
  }
  const parsed = JSON.parse(payload) as SalonDatabase;
  if (!parsed || !Array.isArray(parsed.users) || !parsed.settings) {
    return { db: null, spreadsheetId: res.spreadsheetId, spreadsheetUrl: res.spreadsheetUrl };
  }
  return { db: parsed, spreadsheetId: res.spreadsheetId, spreadsheetUrl: res.spreadsheetUrl };
}

export async function readGoogleSheetTabViaAppsScript(
  bridgeUrl: string,
  sheetTitle?: string,
  spreadsheetId?: string
): Promise<{ availableTabs: string[]; activeTab: string; rows: string[][] }> {
  return callAppsScriptBridge(bridgeUrl, 'readSheet', {
    sheetTitle,
    ...(spreadsheetId ? { spreadsheetId } : {}),
  });
}

export async function uploadBinaryViaAppsScript(
  bridgeUrl: string,
  options: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    category: DriveDocumentCategory;
    description?: string;
  }
): Promise<{
  rootFolderId: string;
  folderId: string;
  folderName: string;
  file: { id: string; name: string; mimeType: string; sizeBytes: number; webViewLink?: string };
}> {
  return callAppsScriptBridge(bridgeUrl, 'driveUpload', {
    fileName: options.fileName,
    mimeType: options.mimeType,
    base64Data: options.buffer.toString('base64'),
    category: options.category,
    description: options.description || 'Uploaded by Trendy Unisex Salon Management System',
  });
}

export async function backupDatabaseViaAppsScript(
  bridgeUrl: string,
  db: SalonDatabase,
  label: string
): Promise<{ id: string; name: string; webViewLink?: string; rootFolderId: string }> {
  const fileName = `Trendy_Unisex_Salon_Backup_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const res = await uploadBinaryViaAppsScript(bridgeUrl, {
    fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(db, null, 2), 'utf8'),
    category: 'Backup',
    description: `${label} — Trendy Unisex Salon Management System`,
  });
  return {
    id: res.file.id,
    name: res.file.name,
    webViewLink: res.file.webViewLink,
    rootFolderId: res.rootFolderId,
  };
}

export async function fetchDriveMediaViaAppsScript(
  bridgeUrl: string,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
  const res = await callAppsScriptBridge<{
    name: string;
    mimeType: string;
    base64Data: string;
  }>(bridgeUrl, 'driveMedia', { fileId });
  return {
    buffer: Buffer.from(res.base64Data, 'base64'),
    mimeType: res.mimeType || 'application/octet-stream',
    name: res.name || `drive_file_${fileId}`,
  };
}

export async function listDriveFilesViaAppsScript(bridgeUrl: string): Promise<{
  rootFolderId: string;
  files: Array<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: string;
    size?: string;
    webViewLink?: string;
    parents?: string[];
  }>;
}> {
  return callAppsScriptBridge(bridgeUrl, 'driveList');
}

export async function deleteDriveFileViaAppsScript(
  bridgeUrl: string,
  fileId: string
): Promise<void> {
  await callAppsScriptBridge(bridgeUrl, 'driveDelete', { fileId });
}
