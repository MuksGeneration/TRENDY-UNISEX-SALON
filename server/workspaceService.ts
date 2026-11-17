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
];

function buildSheetMatrix(db: SalonDatabase): Record<string, (string | number | boolean)[][]> {
  return {
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
      ['ID', 'SKU', 'Name', 'Category', 'Brand', 'Unit', 'CurrentQty', 'PurchasePriceUGX', 'SellingPriceUGX', 'MinLevel', 'Retail'],
      ...db.stockItems.map((s) => [
        s.id,
        s.sku,
        s.name,
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
      ['Location', db.settings.location],
      ['Currency', db.settings.currency],
      ['Phone', db.settings.phone],
      ['OperatingHours', db.settings.operatingHours],
      ['LastSyncAt', new Date().toISOString()],
    ],
  };
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
  db: SalonDatabase
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

  const matrix = buildSheetMatrix(db);
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
