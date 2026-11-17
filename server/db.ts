import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SalonDatabase, AuditLogEntry, UserRole } from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'salon-db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

function hashDefaultPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createInitialDatabase(): SalonDatabase {
  const today = todayIsoDate();
  const now = new Date().toISOString();

  return {
    users: [
      {
        id: 'USR-OWNER-01',
        name: 'David Mukula',
        email: 'owner@trendysalon.ug',
        role: 'owner',
        passwordHash: hashDefaultPassword('TrendyOwner2026!'),
        active: true,
        createdAt: now,
      },
      {
        id: 'USR-MGR-01',
        name: 'Grace Namukasa',
        email: 'manager@trendysalon.ug',
        role: 'manager',
        passwordHash: hashDefaultPassword('TrendyManager2026!'),
        active: true,
        createdAt: now,
      },
      {
        id: 'USR-EMP-01',
        name: 'Beatrice Okello',
        email: 'beatrice@trendysalon.ug',
        role: 'employee',
        employeeId: 'EMP-001',
        passwordHash: hashDefaultPassword('TrendyStaff2026!'),
        active: true,
        createdAt: now,
      },
      {
        id: 'USR-EMP-02',
        name: 'Kevin Mugisha',
        email: 'kevin@trendysalon.ug',
        role: 'employee',
        employeeId: 'EMP-002',
        passwordHash: hashDefaultPassword('TrendyStaff2026!'),
        active: true,
        createdAt: now,
      },
      {
        id: 'USR-EMP-03',
        name: 'Fadhila Nantongo',
        email: 'fadhila@trendysalon.ug',
        role: 'employee',
        employeeId: 'EMP-003',
        passwordHash: hashDefaultPassword('TrendyStaff2026!'),
        active: true,
        createdAt: now,
      },
    ],
    employees: [
      {
        id: 'EMP-001',
        fullName: 'Beatrice Okello',
        roleTitle: 'Senior Hair Braider & Plaiting Specialist',
        phone: '+256 772 410 112',
        secondaryPhone: '+256 704 410 112',
        email: 'beatrice@trendysalon.ug',
        nationalId: 'CF94012104821K',
        homeAddress: "Madibira 'A' Cell, Eastern Division, Busia Municipality",
        emergencyContactName: 'Esther Akello',
        emergencyContactPhone: '+256 772 889 102',
        specialties: ['Hair Plaiting', 'Braids and Cornrows', 'Dreadlocks', 'Hair Styling'],
        avatarUrl: '/src/assets/images/stylist_portrait_female_braids_1794932003886.jpg',
        status: 'Active',
        active: true,
        hireDate: '2024-03-01',
        lastDocumentUpdatedAt: now,
        lunchEligible: true,
        defaultShiftStart: '08:00',
        defaultShiftEnd: '20:00',
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      },
      {
        id: 'EMP-002',
        fullName: 'Kevin Mugisha',
        roleTitle: 'Master Barber & Grooming Specialist',
        phone: '+256 701 889 234',
        secondaryPhone: '+256 782 889 234',
        email: 'kevin@trendysalon.ug',
        nationalId: 'CM92045109234M',
        homeAddress: 'Sofia Ward, Western Division, Busia Municipality',
        emergencyContactName: 'Samuel Mugisha',
        emergencyContactPhone: '+256 774 301 510',
        specialties: ['Haircuts', 'Beard Trimming', 'Kids Cuts', 'Grooming', 'Dreadlocks'],
        avatarUrl: '/src/assets/images/stylist_portrait_male_barber_1794932004641.jpg',
        status: 'Active',
        active: true,
        hireDate: '2024-05-15',
        lastDocumentUpdatedAt: now,
        lunchEligible: true,
        defaultShiftStart: '08:00',
        defaultShiftEnd: '20:30',
        workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
      {
        id: 'EMP-003',
        fullName: 'Fadhila Nantongo',
        roleTitle: 'Beauty, Wig & Makeup Artist',
        phone: '+256 755 302 918',
        secondaryPhone: '+256 779 302 918',
        email: 'fadhila@trendysalon.ug',
        nationalId: 'CF96088103194F',
        homeAddress: 'Arubaine Cell, Busia District Road, Busia',
        emergencyContactName: 'Hassan Ssemakula',
        emergencyContactPhone: '+256 752 662 409',
        specialties: ['Wig Installation', 'Makeup', 'Nails', 'Facial Treatment', 'Blow Dry', 'Hair Coloring'],
        avatarUrl: '/src/assets/images/stylist_portrait_beauty_artist_1794932004081.jpg',
        status: 'Active',
        active: true,
        hireDate: '2024-08-10',
        lastDocumentUpdatedAt: now,
        lunchEligible: true,
        defaultShiftStart: '08:30',
        defaultShiftEnd: '20:00',
        workingDays: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
    ],
    schedules: [],
    attendance: [],
    leaves: [],
    customers: [],
    customerNotes: [],
    customerFeedback: [],
    serviceCategories: [
      { id: 'CAT-PLAIT', name: 'Hair Plaiting', commissionRate: 0.5, description: 'All plaiting hair styles (50% commission)' },
      { id: 'CAT-BLOW', name: 'Blow Dry', commissionRate: 0.3, description: 'Blow dry & heat styling (30% commission)' },
      { id: 'CAT-STYLE', name: 'Hair Styling', commissionRate: 0.4, description: 'General salon hair styling (40%)' },
      { id: 'CAT-BRAIDS', name: 'Braids and Cornrows', commissionRate: 0.4, description: 'Box braids, knotless, cornrows (40%)' },
      { id: 'CAT-WIG', name: 'Wig Installation', commissionRate: 0.4, description: 'Lace frontal & closure installation (40%)' },
      { id: 'CAT-MAKEUP', name: 'Makeup', commissionRate: 0.4, description: 'Bridal & occasion makeup (40%)' },
      { id: 'CAT-NAILS', name: 'Nails', commissionRate: 0.4, description: 'Manicure, pedicure, acrylics, gel (40%)' },
      { id: 'CAT-FACIAL', name: 'Facial Treatment', commissionRate: 0.4, description: 'Deep cleansing & facials (40%)' },
      { id: 'CAT-CUTS', name: 'Haircuts', commissionRate: 0.4, description: 'Adult unisex haircuts & fades (40%)' },
      { id: 'CAT-BEARD', name: 'Beard Trimming', commissionRate: 0.4, description: 'Beard sculpting & hot towel shave (40%)' },
      { id: 'CAT-COLOR', name: 'Hair Coloring', commissionRate: 0.4, description: 'Tint, highlights & dye services (40%)' },
      { id: 'CAT-LOCKS', name: 'Dreadlocks', commissionRate: 0.4, description: 'Retwist, starter locs & styling (40%)' },
      { id: 'CAT-KIDS', name: 'Kids Cuts', commissionRate: 0.4, description: 'Children haircuts & neat trims (40%)' },
      { id: 'CAT-GROOM', name: 'Grooming', commissionRate: 0.4, description: 'Complete executive grooming packages (40%)' },
    ],
    services: [
      { id: 'SRV-001', name: 'Knotless Plaiting (Medium)', categoryId: 'CAT-PLAIT', categoryName: 'Hair Plaiting', price: 65000, durationMinutes: 150, qualifiedEmployeeIds: ['EMP-001'], active: true },
      { id: 'SRV-002', name: 'African Cornrows Plaiting', categoryId: 'CAT-PLAIT', categoryName: 'Hair Plaiting', price: 35000, durationMinutes: 90, qualifiedEmployeeIds: ['EMP-001'], active: true },
      { id: 'SRV-003', name: 'Wash & Blow Dry', categoryId: 'CAT-BLOW', categoryName: 'Blow Dry', price: 25000, durationMinutes: 45, qualifiedEmployeeIds: ['EMP-001', 'EMP-003'], active: true },
      { id: 'SRV-004', name: 'Silk Press & Blow Dry', categoryId: 'CAT-BLOW', categoryName: 'Blow Dry', price: 45000, durationMinutes: 60, qualifiedEmployeeIds: ['EMP-003'], active: true },
      { id: 'SRV-005', name: 'Signature Skin Fade Haircut', categoryId: 'CAT-CUTS', categoryName: 'Haircuts', price: 15000, durationMinutes: 35, qualifiedEmployeeIds: ['EMP-002'], active: true },
      { id: 'SRV-006', name: 'Beard Sculpt & Hot Towel Shave', categoryId: 'CAT-BEARD', categoryName: 'Beard Trimming', price: 10000, durationMinutes: 25, qualifiedEmployeeIds: ['EMP-002'], active: true },
      { id: 'SRV-007', name: 'Kids Neat Haircut', categoryId: 'CAT-KIDS', categoryName: 'Kids Cuts', price: 10000, durationMinutes: 30, qualifiedEmployeeIds: ['EMP-002'], active: true },
      { id: 'SRV-008', name: 'Lace Frontal Wig Installation', categoryId: 'CAT-WIG', categoryName: 'Wig Installation', price: 70000, durationMinutes: 90, qualifiedEmployeeIds: ['EMP-003'], active: true },
      { id: 'SRV-009', name: 'Glam Occasion Makeup', categoryId: 'CAT-MAKEUP', categoryName: 'Makeup', price: 80000, durationMinutes: 75, qualifiedEmployeeIds: ['EMP-003'], active: true },
      { id: 'SRV-010', name: 'Gel Manicure & Pedicure', categoryId: 'CAT-NAILS', categoryName: 'Nails', price: 50000, durationMinutes: 75, qualifiedEmployeeIds: ['EMP-003'], active: true },
      { id: 'SRV-011', name: 'Deep Cleansing Facial', categoryId: 'CAT-FACIAL', categoryName: 'Facial Treatment', price: 60000, durationMinutes: 60, qualifiedEmployeeIds: ['EMP-003'], active: true },
      { id: 'SRV-012', name: 'Dreadlocks Retwist & Style', categoryId: 'CAT-LOCKS', categoryName: 'Dreadlocks', price: 40000, durationMinutes: 90, qualifiedEmployeeIds: ['EMP-001', 'EMP-002'], active: true },
      { id: 'SRV-013', name: 'Full Hair Dye & Conditioning', categoryId: 'CAT-COLOR', categoryName: 'Hair Coloring', price: 55000, durationMinutes: 90, qualifiedEmployeeIds: ['EMP-003'], active: true },
      { id: 'SRV-014', name: 'Executive Grooming Combo', categoryId: 'CAT-GROOM', categoryName: 'Grooming', price: 30000, durationMinutes: 60, qualifiedEmployeeIds: ['EMP-002'], active: true },
    ],
    servicePricingHistory: [],
    appointments: [],
    walkIns: [],
    posTransactions: [],
    refunds: [],
    tips: [],
    giftCards: [],
    giftCardTransactions: [],
    commissionPolicies: [
      {
        id: 'POL-2026-01',
        effectiveDate: '2026-01-01',
        plaitingRate: 0.5,
        blowDryRate: 0.3,
        defaultOtherRate: 0.4,
        productCommissionEnabled: false,
        productCommissionRate: 0,
        lunchDeductionAmount: 2500,
        lunchAllocationMethod: 'proportional',
        tipPolicy: 'direct_to_employee',
        approvedBy: 'David Mukula (Owner)',
        createdAt: now,
        notes: 'Official Trendy Unisex Salon policy: Plaiting 50%, Blow Dry 30%, All other services 40%. UGX 2,500 daily lunch deducted once before commission.',
      },
    ],
    lunchDeductions: [],
    commissionLedger: [],
    commissionPayments: [],
    commissionAdjustments: [],
    expenses: [],
    expenseCategories: [
      'Rent',
      'Electricity',
      'Water',
      'Internet',
      'Salaries',
      'Salon supplies',
      'Hair products',
      'Cleaning supplies',
      'Transport',
      'Maintenance',
      'Marketing',
      'Other expenses',
    ],
    suppliers: [
      {
        id: 'SUP-001',
        name: 'Kampala Beauty Wholesale Ltd',
        phone: '+256 772 600 411',
        email: 'orders@kampalabeauty.ug',
        address: 'Kikuubo Lane, Kampala',
      },
      {
        id: 'SUP-002',
        name: 'Busia Salon Supplies & Cosmetics',
        phone: '+256 752 310 882',
        address: 'Busia Main Market Road, Busia',
      },
    ],
    stockItems: [
      {
        id: 'STK-001',
        sku: 'TUS-BRD-01',
        name: 'XPression Ultra Braid Pack',
        category: 'Hair products',
        brand: 'XPression',
        unit: 'Pack',
        openingQuantity: 30,
        currentQuantity: 30,
        purchasePrice: 9000,
        sellingPrice: 15000,
        supplierId: 'SUP-001',
        supplierName: 'Kampala Beauty Wholesale Ltd',
        minStockLevel: 8,
        isRetail: true,
        active: true,
      },
      {
        id: 'STK-002',
        sku: 'TUS-SHM-01',
        name: 'Moisture Rich Salon Shampoo (1L)',
        category: 'Shampoos',
        brand: 'ORS Olive Oil',
        unit: 'Bottle',
        openingQuantity: 12,
        currentQuantity: 12,
        purchasePrice: 22000,
        sellingPrice: 35000,
        supplierId: 'SUP-001',
        supplierName: 'Kampala Beauty Wholesale Ltd',
        minStockLevel: 4,
        isRetail: true,
        active: true,
      },
      {
        id: 'STK-003',
        sku: 'TUS-TRT-01',
        name: 'Deep Repair Hair Treatment Mask',
        category: 'Hair treatments',
        brand: 'MegaGrowth',
        unit: 'Jar',
        openingQuantity: 15,
        currentQuantity: 15,
        purchasePrice: 16000,
        sellingPrice: 28000,
        supplierId: 'SUP-002',
        supplierName: 'Busia Salon Supplies & Cosmetics',
        minStockLevel: 5,
        isRetail: true,
        active: true,
      },
      {
        id: 'STK-004',
        sku: 'TUS-STL-01',
        name: 'Edge Control & Shine Gel',
        category: 'Styling products',
        brand: 'Ebin New York',
        unit: 'Jar',
        openingQuantity: 20,
        currentQuantity: 20,
        purchasePrice: 12000,
        sellingPrice: 22000,
        supplierId: 'SUP-001',
        supplierName: 'Kampala Beauty Wholesale Ltd',
        minStockLevel: 6,
        isRetail: true,
        active: true,
      },
      {
        id: 'STK-005',
        sku: 'TUS-CLN-01',
        name: 'Clipper Disinfectant & Cool Spray',
        category: 'Cleaning supplies',
        brand: 'Andis Cool Care',
        unit: 'Can',
        openingQuantity: 8,
        currentQuantity: 8,
        purchasePrice: 25000,
        sellingPrice: 0,
        supplierId: 'SUP-002',
        supplierName: 'Busia Salon Supplies & Cosmetics',
        minStockLevel: 3,
        isRetail: false,
        active: true,
      },
      {
        id: 'STK-006',
        sku: 'TUS-CLR-01',
        name: 'Permanent Jet Black Hair Color Kit',
        category: 'Hair colors',
        brand: 'Dark and Lovely',
        unit: 'Box',
        openingQuantity: 14,
        currentQuantity: 14,
        purchasePrice: 14000,
        sellingPrice: 25000,
        supplierId: 'SUP-001',
        supplierName: 'Kampala Beauty Wholesale Ltd',
        minStockLevel: 4,
        expirationDate: '2027-06-30',
        isRetail: true,
        active: true,
      },
    ],
    stockMovements: [],
    driveDocuments: [],
    notifications: [
      {
        id: 'NOTIF-INIT-01',
        type: 'system',
        title: 'Trendy Unisex Salon System Initialized',
        message: 'Commission policy active: Plaiting Hair 50%, Blow Dry 30%, Other Services 40% with UGX 2,500 daily lunch deduction before commission.',
        severity: 'info',
        read: false,
        targetRoles: ['owner', 'manager'],
        createdAt: now,
      },
    ],
    auditLogs: [
      {
        id: 'AUD-INIT-01',
        timestamp: now,
        userId: 'USR-OWNER-01',
        userName: 'David Mukula',
        userRole: 'owner',
        action: 'SYSTEM_INITIALIZED',
        entityType: 'SalonDatabase',
        entityId: 'POL-2026-01',
        details: `Initialized Trendy Unisex Salon database on ${today} with clean production catalog and commission rules.`,
      },
    ],
    migrationLogs: [],
    backups: [],
    settings: {
      businessName: 'Trendy Unisex Salon',
      tagline: 'Where Beauty Meets Style',
      location: "Busia District Road, near ASA Microfinance, Madibira 'A', Uganda",
      phone: '+256 772 000 100',
      email: 'info@trendysalon.ug',
      currency: 'UGX',
      operatingHours: 'Mon - Sun: 08:00 AM - 09:00 PM',
      defaultAppointmentDuration: 60,
      cancellationPolicy: 'Please notify at least 2 hours prior to scheduled appointment time.',
      taxEnabled: false,
      taxRate: 0,
      allowNegativeStockWithApproval: false,
      loyaltyPointsPer10k: 10,
      loyaltyPointsValueUgx: 500,
      receiptFooterMessage: 'Thank you for visiting Trendy Unisex Salon — Where Beauty Meets Style!',
      whatsappProviderConfigured: false,
      smsProviderConfigured: false,
      emailProviderConfigured: false,
    },
  };
}

function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

let cachedDb: SalonDatabase | null = null;

export function readDb(): SalonDatabase {
  if (cachedDb) return cachedDb;
  ensureDirectories();
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialDatabase();
    writeDb(initial);
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  cachedDb = JSON.parse(raw) as SalonDatabase;
  if (!Array.isArray(cachedDb.driveDocuments)) {
    cachedDb.driveDocuments = [];
  }
  const hadLegacyReceptionistUsers = cachedDb.users.some(
    (u) => (u.role as string) === 'receptionist'
  );
  let hadLegacyNotifRoles = false;
  cachedDb.notifications = cachedDb.notifications.map((n) => {
    if (n.targetRoles.some((r) => (r as string) === 'receptionist')) {
      hadLegacyNotifRoles = true;
      return {
        ...n,
        targetRoles: n.targetRoles.filter((r) => (r as string) !== 'receptionist'),
      };
    }
    return n;
  });
  if (hadLegacyReceptionistUsers || hadLegacyNotifRoles) {
    cachedDb.users = cachedDb.users.filter((u) => (u.role as string) !== 'receptionist');
    writeDb(cachedDb);
  }
  return cachedDb;
}

export function writeDb(db: SalonDatabase): void {
  ensureDirectories();
  const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
  cachedDb = db;
}

export function createBackupSnapshot(db: SalonDatabase, label: string, createdBy: string): string {
  ensureDirectories();
  const backupId = `BKP-${Date.now()}`;
  const backupPath = path.join(BACKUP_DIR, `${backupId}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(db, null, 2), 'utf8');

  const recordCount =
    db.customers.length +
    db.appointments.length +
    db.posTransactions.length +
    db.commissionLedger.length +
    db.expenses.length +
    db.stockItems.length;

  db.backups.unshift({
    id: backupId,
    label,
    createdAt: new Date().toISOString(),
    createdBy,
    recordCount,
  });
  return backupId;
}

export function getBackupSnapshot(backupId: string): SalonDatabase | null {
  const backupPath = path.join(BACKUP_DIR, `${backupId}.json`);
  if (!fs.existsSync(backupPath)) return null;
  return JSON.parse(fs.readFileSync(backupPath, 'utf8')) as SalonDatabase;
}

export function appendAuditLog(
  db: SalonDatabase,
  actor: {
    userId: string;
    userName?: string;
    name?: string;
    userRole?: UserRole;
    role?: UserRole;
  },
  action: string,
  entityType: string,
  entityId: string,
  details: string
): void {
  const entry: AuditLogEntry = {
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    userId: actor.userId,
    userName: actor.userName || actor.name || 'System',
    userRole: actor.userRole || actor.role || 'owner',
    action,
    entityType,
    entityId,
    details,
  };
  db.auditLogs.unshift(entry);
  if (db.auditLogs.length > 2000) {
    db.auditLogs = db.auditLogs.slice(0, 2000);
  }
}
