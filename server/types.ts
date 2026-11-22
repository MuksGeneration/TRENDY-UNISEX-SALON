export type UserRole = 'owner' | 'manager' | 'employee';

export type AppointmentStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Checked In'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'No Show'
  | 'Rescheduled';

export type PaymentMethod = 'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Card' | 'Gift Card';

export type LunchAllocationMethod =
  | 'proportional'
  | 'highest_earning_category'
  | 'lowest_rate_first';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  employeeId?: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export type SessionEventStatus =
  | 'active'
  | 'signed_out'
  | 'suspicious'
  | 'failed_login'
  | 'revoked';

export interface UserSessionRecord {
  id: string;
  sessionId?: string;
  userId?: string;
  userName?: string;
  email: string;
  role?: UserRole;
  authMethod: 'credentials' | 'google_workspace' | 'token';
  status: SessionEventStatus;
  loginAt: string;
  logoutAt?: string;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  suspicious: boolean;
  suspiciousSeverity?: 'low' | 'medium' | 'high';
}

export type EmployeeStatus = 'Active' | 'On Leave' | 'Inactive';

export interface Employee {
  id: string;
  fullName: string;
  roleTitle: string;
  phone: string;
  secondaryPhone?: string;
  email: string;
  nationalId?: string;
  nationalIdDocumentUrl?: string;
  nationalIdBackUrl?: string;
  homeAddress?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  specialties: string[];
  avatarUrl?: string;
  avatarDriveFileId?: string;
  avatarDriveLink?: string;
  nationalIdFrontDriveFileId?: string;
  nationalIdFrontDriveLink?: string;
  nationalIdBackDriveFileId?: string;
  nationalIdBackDriveLink?: string;
  status?: EmployeeStatus;
  active: boolean;
  hireDate: string;
  lastDocumentUpdatedAt?: string;
  lastDocumentUpdatedBy?: string;
  lunchEligible: boolean;
  defaultShiftStart: string;
  defaultShiftEnd: string;
  workingDays: string[]; // ['Mon','Tue',...]
}

export interface EmployeeSchedule {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  shiftStart: string;
  shiftEnd: string;
  breakStart?: string;
  breakEnd?: string;
  isDayOff: boolean;
  notes?: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD
  clockIn?: string;
  clockOut?: string;
  hoursWorked: number;
  status: 'Present' | 'Late' | 'Absent' | 'Approved Leave';
  notes?: string;
}

export interface LeaveRecord {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
}

export interface Customer {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  gender?: 'Female' | 'Male' | 'Prefer not to say' | '';
  registrationDate: string;
  preferredStylistId?: string;
  preferences?: string;
  specialInstructions?: string;
  hairColorHistory?: string;
  productPreferences?: string;
  birthday?: string; // MM-DD or YYYY-MM-DD
  referredByCustomerId?: string;
  loyaltyPoints: number;
  loyaltyTier: 'Bronze' | 'Silver' | 'Gold' | 'VIP';
  notes?: string;
  totalVisits: number;
  totalSpent: number;
  lastVisitDate?: string;
}

export interface CustomerNote {
  id: string;
  customerId: string;
  authorId: string;
  authorName: string;
  note: string;
  createdAt: string;
}

export interface CustomerFeedback {
  id: string;
  customerId: string;
  transactionId?: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  commissionRate: number; // 0.50, 0.30, 0.40
  description?: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  price: number;
  durationMinutes: number;
  commissionRateOverride?: number;
  qualifiedEmployeeIds: string[];
  active: boolean;
}

export interface ServicePricingHistory {
  id: string;
  serviceId: string;
  serviceName: string;
  oldPrice: number;
  newPrice: number;
  changedBy: string;
  changedAt: string;
}

export interface Appointment {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  employeeId: string;
  employeeName: string;
  serviceIds: string[];
  serviceNames: string[];
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationMinutes: number;
  status: AppointmentStatus;
  source: 'Scheduled' | 'Online' | 'Walk-In';
  instructions?: string;
  notes?: string;
  reminderSent?: boolean;
  posTransactionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WalkInEntry {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  requestedServiceIds: string[];
  requestedServiceNames: string[];
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  arrivalTime: string; // ISO
  status: 'Waiting' | 'Being Served' | 'Completed' | 'Left';
  notes?: string;
  posTransactionId?: string;
}

export interface TransactionItem {
  id: string;
  itemType: 'service' | 'product';
  refId: string;
  name: string;
  categoryName: string;
  employeeId?: string;
  employeeName?: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  commissionRateApplied?: number;
}

export interface TransactionPayment {
  id: string;
  transactionId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  giftCardCode?: string;
  paidAt: string;
  recordedBy: string;
}

export interface POSTransaction {
  id: string;
  reference: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
  customerId?: string;
  customerName: string;
  appointmentId?: string;
  walkInId?: string;
  cashierId: string;
  cashierName: string;
  items: TransactionItem[];
  subtotal: number;
  discountTotal: number;
  taxAmount: number;
  tipAmount: number;
  tipEmployeeId?: string;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  payments: TransactionPayment[];
  status: 'Completed' | 'Partial' | 'Reversed' | 'Refunded';
  isHistorical?: boolean;
  notes?: string;
}

export interface RefundRecord {
  id: string;
  transactionId: string;
  transactionReference: string;
  amount: number;
  reason: string;
  processedById: string;
  processedByName: string;
  createdAt: string;
}

export interface TipRecord {
  id: string;
  transactionId: string;
  date: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  distributionMode: 'direct_to_employee' | 'salon_pool';
  createdAt: string;
}

export interface GiftCard {
  id: string;
  code: string;
  customerId?: string;
  customerName?: string;
  initialValue: number;
  balance: number;
  issuedDate: string;
  expirationDate?: string;
  status: 'Active' | 'Redeemed' | 'Expired' | 'Cancelled';
  issuedBy: string;
}

export interface GiftCardTransaction {
  id: string;
  giftCardId: string;
  code: string;
  type: 'Purchase' | 'Redemption' | 'Cancellation';
  amount: number;
  balanceAfter: number;
  posTransactionId?: string;
  createdAt: string;
  performedBy: string;
}

export interface CommissionPolicy {
  id: string;
  effectiveDate: string; // YYYY-MM-DD
  plaitingRate: number; // 0.50
  blowDryRate: number; // 0.30
  defaultOtherRate: number; // 0.40
  productCommissionEnabled: boolean;
  productCommissionRate: number;
  lunchDeductionAmount: number; // 2500
  lunchAllocationMethod: LunchAllocationMethod;
  tipPolicy: 'direct_to_employee' | 'salon_pool';
  approvedBy: string;
  createdAt: string;
  notes?: string;
}

export interface LunchDeductionRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string; // YYYY-MM-DD
  amount: number;
  allocationMethod: LunchAllocationMethod;
  grossDailyEarnings: number;
  isHistorical?: boolean;
  createdAt: string;
}

export interface CommissionLedgerEntry {
  id: string;
  transactionId: string;
  transactionReference: string;
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeName: string;
  serviceName: string;
  serviceCategory: string;
  grossEarnings: number;
  lunchAllocation: number;
  netCommissionableEarnings: number;
  commissionRate: number;
  employeeCommission: number;
  salonShare: number;
  paymentStatus: 'Unpaid' | 'Partially Paid' | 'Paid' | 'Reversed';
  isHistorical?: boolean;
  policyId?: string;
  createdAt: string;
}

export interface CommissionPayment {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  paymentDate: string; // YYYY-MM-DD
  paymentMethod: PaymentMethod;
  notes?: string;
  paidById: string;
  paidByName: string;
  createdAt: string;
}

export interface CommissionAdjustment {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  amount: number; // positive or negative adjustment to employee commission
  reason: string;
  approvedById: string;
  approvedByName: string;
  createdAt: string;
}

export interface ExpenseRecord {
  id: string;
  date: string; // YYYY-MM-DD
  category: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  responsiblePerson: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
  attachmentName?: string;
  isHistorical?: boolean;
  createdBy: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
  description?: string;
  unit: string;
  openingQuantity: number;
  currentQuantity: number;
  purchasePrice: number;
  sellingPrice: number;
  supplierId?: string;
  supplierName?: string;
  minStockLevel: number;
  expirationDate?: string;
  isRetail: boolean;
  inventoryGroup?: 'salon_owned' | 'for_sale';
  active: boolean;
}

export interface StockMovement {
  id: string;
  stockItemId: string;
  stockItemName: string;
  date: string;
  type:
    | 'Opening Stock'
    | 'Purchase'
    | 'Retail Sale'
    | 'Service Usage'
    | 'Adjustment'
    | 'Damaged'
    | 'Expired'
    | 'Return';
  quantityDelta: number;
  quantityAfter: number;
  unitCost?: number;
  referenceId?: string;
  notes?: string;
  recordedBy: string;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type:
    | 'appointment'
    | 'low_stock'
    | 'expiring_stock'
    | 'commission'
    | 'expense'
    | 'system';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'alert';
  read: boolean;
  targetRoles: UserRole[];
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
}

export interface DataMigrationLog {
  id: string;
  fileName: string;
  migratedAt: string;
  migratedBy: string;
  backupId: string;
  sheetsImported: string[];
  recordsImported: number;
  notes?: string;
}

export interface SystemBackupRecord {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string;
  recordCount: number;
  driveFileId?: string;
}

export type DriveDocumentCategory =
  | 'Employee Photo'
  | 'National ID'
  | 'Trading Licence'
  | 'Expense Receipt'
  | 'Staff Contract'
  | 'Salon Media'
  | 'Supplier Invoice'
  | 'Backup'
  | 'Other';

export interface DriveDocumentRecord {
  id: string;
  driveFileId: string;
  name: string;
  category: DriveDocumentCategory;
  mimeType: string;
  sizeBytes?: number;
  webViewLink?: string;
  folderName?: string;
  relatedEmployeeId?: string;
  relatedEmployeeName?: string;
  notes?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface SalonSettings {
  businessName: string;
  tagline: string;
  audienceTagline?: string;
  location: string;
  phone: string;
  email: string;
  socialHandle?: string;
  socialPlatforms?: string[];
  walkInsWelcome?: boolean;
  promotionalBannerUrl?: string;
  backgroundImageUrl?: string;
  currency: string;
  operatingHours: string;
  defaultAppointmentDuration: number;
  cancellationPolicy: string;
  taxEnabled: boolean;
  taxRate: number;
  allowNegativeStockWithApproval: boolean;
  loyaltyPointsPer10k: number;
  loyaltyPointsValueUgx: number;
  receiptFooterMessage: string;
  whatsappProviderConfigured: boolean;
  smsProviderConfigured: boolean;
  emailProviderConfigured: boolean;
  salonLogoUrl?: string;
  salonLogoDriveFileId?: string;
  salonLogoDriveLink?: string;
  tradingLicenceNumber?: string;
  tradingLicenceExpiry?: string;
  tradingLicenceUrl?: string;
  tradingLicenceDriveFileId?: string;
  tradingLicenceDriveLink?: string;
  googleSpreadsheetId?: string;
  googleSpreadsheetUrl?: string;
  googleDriveFolderId?: string;
  googleAppsScriptUrl?: string;
  lastSheetsSyncAt?: string;
}

export interface SalonDatabase {
  users: User[];
  employees: Employee[];
  schedules: EmployeeSchedule[];
  attendance: AttendanceRecord[];
  leaves: LeaveRecord[];
  customers: Customer[];
  customerNotes: CustomerNote[];
  customerFeedback: CustomerFeedback[];
  serviceCategories: ServiceCategory[];
  services: ServiceItem[];
  servicePricingHistory: ServicePricingHistory[];
  appointments: Appointment[];
  walkIns: WalkInEntry[];
  posTransactions: POSTransaction[];
  refunds: RefundRecord[];
  tips: TipRecord[];
  giftCards: GiftCard[];
  giftCardTransactions: GiftCardTransaction[];
  commissionPolicies: CommissionPolicy[];
  lunchDeductions: LunchDeductionRecord[];
  commissionLedger: CommissionLedgerEntry[];
  commissionPayments: CommissionPayment[];
  commissionAdjustments: CommissionAdjustment[];
  expenses: ExpenseRecord[];
  expenseCategories: string[];
  suppliers: Supplier[];
  stockItems: StockItem[];
  stockMovements: StockMovement[];
  driveDocuments: DriveDocumentRecord[];
  notifications: NotificationItem[];
  auditLogs: AuditLogEntry[];
  sessionHistory: UserSessionRecord[];
  migrationLogs: DataMigrationLog[];
  backups: SystemBackupRecord[];
  settings: SalonSettings;
}
