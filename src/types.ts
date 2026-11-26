export type UserRole = 'owner' | 'manager' | 'employee';

export type NavSection =
  | 'dashboard'
  | 'appointments'
  | 'pos'
  | 'customers'
  | 'employees'
  | 'scheduling'
  | 'attendance'
  | 'services'
  | 'commissions'
  | 'payments'
  | 'lunch'
  | 'expenses'
  | 'inventory'
  | 'gift-cards'
  | 'reports'
  | 'ai-assistant'
  | 'notifications'
  | 'users'
  | 'settings'
  | 'audit-logs';

export interface SessionUser {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  employeeId?: string;
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

export interface UserSessionSummary {
  totalEvents: number;
  activeSessions: number;
  signedOutCount: number;
  suspiciousCount: number;
  failedAttemptsCount: number;
  revokedCount: number;
}

export type PaymentMethod = 'Cash' | 'Mobile Money' | 'Bank Transfer' | 'Card' | 'Gift Card';
export type AppointmentStatus =
  | 'Pending'
  | 'Confirmed'
  | 'Checked In'
  | 'In Progress'
  | 'Completed'
  | 'Cancelled'
  | 'No Show'
  | 'Rescheduled';

export interface EmployeeSummary {
  grossEarnings: number;
  totalLunchDeducted: number;
  netCommissionable: number;
  baseCommissionEarned: number;
  totalAdjustments: number;
  totalCommissionEarned: number;
  totalSalonShare: number;
  totalPaid: number;
  outstandingBalance: number;
  directTips: number;
}

export type EmployeeStatus = 'Active' | 'On Leave' | 'Inactive';

export interface EmployeeRecord {
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
  workingDays: string[];
  summary?: EmployeeSummary | null;
}

export interface CustomerRecord {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  gender?: string;
  registrationDate: string;
  preferredStylistId?: string;
  preferences?: string;
  specialInstructions?: string;
  hairColorHistory?: string;
  productPreferences?: string;
  birthday?: string;
  loyaltyPoints: number;
  loyaltyTier: 'Bronze' | 'Silver' | 'Gold' | 'VIP';
  notes?: string;
  totalVisits: number;
  totalSpent: number;
  lastVisitDate?: string;
}

export interface ServiceCategory {
  id: string;
  name: string;
  commissionRate: number;
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
  imageUrl?: string;
  active: boolean;
}

export interface AppointmentRecord {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  employeeId: string;
  employeeName: string;
  serviceIds: string[];
  serviceNames: string[];
  date: string;
  startTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  source: 'Scheduled' | 'Online' | 'Walk-In';
  instructions?: string;
  notes?: string;
  reminderSent?: boolean;
  posTransactionId?: string;
}

export interface WalkInRecord {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  requestedServiceIds: string[];
  requestedServiceNames: string[];
  assignedEmployeeId?: string;
  assignedEmployeeName?: string;
  arrivalTime: string;
  status: 'Waiting' | 'Being Served' | 'Completed' | 'Left';
  notes?: string;
  posTransactionId?: string;
}

export interface StockItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  brand: string;
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

export interface POSTransactionRecord {
  id: string;
  reference: string;
  date: string;
  createdAt: string;
  customerId?: string;
  customerName: string;
  cashierName: string;
  items: Array<{
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
  }>;
  subtotal: number;
  discountTotal: number;
  taxAmount: number;
  tipAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  payments: Array<{
    id: string;
    method: PaymentMethod;
    amount: number;
    reference?: string;
    giftCardCode?: string;
    paidAt: string;
  }>;
  status: 'Completed' | 'Partial' | 'Reversed' | 'Refunded';
  isHistorical?: boolean;
  notes?: string;
}

export interface CommissionLedgerEntry {
  id: string;
  transactionId: string;
  transactionReference: string;
  date: string;
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
}

export interface CommissionPolicy {
  id: string;
  effectiveDate: string;
  plaitingRate: number;
  blowDryRate: number;
  defaultOtherRate: number;
  productCommissionEnabled: boolean;
  productCommissionRate: number;
  lunchDeductionAmount: number;
  lunchAllocationMethod: 'proportional' | 'highest_earning_category' | 'lowest_rate_first';
  tipPolicy: 'direct_to_employee' | 'salon_pool';
  approvedBy: string;
  createdAt: string;
  notes?: string;
}

export interface LunchDeductionRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  amount: number;
  allocationMethod: string;
  grossDailyEarnings: number;
  isHistorical?: boolean;
}

export interface CommissionPaymentRecord {
  id: string;
  reference: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  commissionDate?: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  notes?: string;
  paidByName: string;
}

export interface ExpenseRecord {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paymentMethod: PaymentMethod;
  responsiblePerson: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvedBy?: string;
  isHistorical?: boolean;
  createdBy: string;
}

export interface GiftCardRecord {
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

export interface SalonBranding {
  businessName: string;
  tagline: string;
  audienceTagline?: string;
  location: string;
  phone?: string;
  socialHandle?: string;
  socialPlatforms?: string[];
  walkInsWelcome?: boolean;
  promotionalBannerUrl?: string;
  backgroundImageUrl?: string;
  salonLogoUrl?: string;
  operatingHours?: string;
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
