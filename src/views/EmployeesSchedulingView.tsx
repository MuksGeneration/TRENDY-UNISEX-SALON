import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  FileDown,
  Clock,
  CheckCircle2,
  X,
  Pencil,
  Upload,
  Trash2,
  MapPin,
  CreditCard,
  Phone,
  Mail,
  ShieldAlert,
  Search,
  UserRound,
  FileSpreadsheet,
  FileText,
  Eye,
  Cloud,
  ExternalLink,
  FileClock,
} from 'lucide-react';
import {
  apiFetch,
  exportReportToPdf,
  exportRowsToExcel,
  fetchDriveMediaBlobUrl,
  formatUGX,
} from '../lib/api';
import { ConfirmModal } from '../components/ConfirmModal';
import type { CommissionLedgerEntry, EmployeeRecord, EmployeeStatus, SessionUser } from '../types';

interface EmployeesSchedulingViewProps {
  mode: 'employees' | 'scheduling' | 'attendance';
  user: SessionUser;
  googleConnected?: boolean;
  onConnectGoogle?: () => Promise<void>;
}

const ALL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EMPLOYEE_STATUS_OPTIONS: EmployeeStatus[] = ['Active', 'On Leave', 'Inactive'];

const STATUS_BADGE_MAP: Record<
  EmployeeStatus,
  { badgeClass: string; darkBadgeClass: string; dotClass: string }
> = {
  Active: {
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    darkBadgeClass: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
    dotClass: 'bg-emerald-500',
  },
  'On Leave': {
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
    darkBadgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/40',
    dotClass: 'bg-amber-500',
  },
  Inactive: {
    badgeClass: 'bg-stone-100 text-stone-600 border-stone-200',
    darkBadgeClass: 'bg-white/10 text-white/75 border-white/25',
    dotClass: 'bg-stone-400',
  },
};

function getEmployeeStatus(emp: Pick<EmployeeRecord, 'status' | 'active'>): EmployeeStatus {
  if (emp.status && EMPLOYEE_STATUS_OPTIONS.includes(emp.status)) {
    return emp.status;
  }
  return emp.active ? 'Active' : 'Inactive';
}

function formatLastDocumentUpdate(iso?: string): string {
  if (!iso) return 'Not recorded yet';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Not recorded yet';
  return parsed.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Resizes and center-crops an uploaded image file to a clean 360x360 JPEG Data URL
 * so staff profile pictures look crisp and stay compact in JSON storage and backups.
 */
async function resizeImageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, or WebP).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Selected image is too large (max 10 MB before compression).');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.onload = () => {
        const targetSize = 360;
        const canvas = document.createElement('canvas');
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser canvas is unavailable for image processing.'));
          return;
        }
        const side = Math.min(img.width, img.height);
        const sx = Math.max(0, (img.width - side) / 2);
        const sy = Math.max(0, (img.height - side) / 2);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Processes an uploaded National ID document (PNG, JPG, WebP, or PDF).
 * Images are preserved in full aspect ratio (max 1200px wide) so NIN text & portrait remain sharp.
 */
async function readNationalIdFileToDataUrl(file: File): Promise<string> {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) {
    throw new Error('Please upload a National ID photo (PNG, JPG, WebP) or PDF document.');
  }
  if (isPdf) {
    if (file.size > 2.5 * 1024 * 1024) {
      throw new Error('PDF file is too large (maximum 2.5 MB).');
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the selected PDF file.'));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Selected image is too large (max 12 MB before compression).');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.onload = () => {
        const maxWidth = 1200;
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser canvas is unavailable for image processing.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export const EmployeesSchedulingView: React.FC<EmployeesSchedulingViewProps> = ({
  mode,
  user,
  googleConnected = false,
  onConnectGoogle,
}) => {
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [schedules, setSchedules] = useState<
    Array<{
      id: string;
      employeeId: string;
      date: string;
      shiftStart: string;
      shiftEnd: string;
      breakStart?: string;
      breakEnd?: string;
      isDayOff: boolean;
      notes?: string;
    }>
  >([]);
  const [attendance, setAttendance] = useState<
    Array<{
      id: string;
      employeeId: string;
      date: string;
      clockIn?: string;
      clockOut?: string;
      hoursWorked: number;
      status: 'Present' | 'Late' | 'Absent' | 'Approved Leave';
      notes?: string;
    }>
  >([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Search & filter for Employees
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | EmployeeStatus>('all');

  // Add / Edit Employee Modal state
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [editingEmpId, setEditingEmpId] = useState<string | null>(null);
  const [empName, setEmpName] = useState('');
  const [empRole, setEmpRole] = useState('Salon Stylist');
  const [empPhone, setEmpPhone] = useState('');
  const [empSecondaryPhone, setEmpSecondaryPhone] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empNationalId, setEmpNationalId] = useState('');
  const [empIdFrontUrl, setEmpIdFrontUrl] = useState('');
  const [empIdBackUrl, setEmpIdBackUrl] = useState('');
  const [empHomeAddress, setEmpHomeAddress] = useState('');
  const [empEmergencyName, setEmpEmergencyName] = useState('');
  const [empEmergencyPhone, setEmpEmergencyPhone] = useState('');
  const [empAvatarUrl, setEmpAvatarUrl] = useState('');
  const [empHireDate, setEmpHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [empSpecialties, setEmpSpecialties] = useState('');
  const [empShiftStart, setEmpShiftStart] = useState('08:00');
  const [empShiftEnd, setEmpShiftEnd] = useState('20:00');
  const [empWorkingDays, setEmpWorkingDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const [empLunchEligible, setEmpLunchEligible] = useState(true);
  const [empStatus, setEmpStatus] = useState<EmployeeStatus>('Active');
  const [empLastDocUpdatedAt, setEmpLastDocUpdatedAt] = useState<string | undefined>(undefined);
  const [empLastDocUpdatedBy, setEmpLastDocUpdatedBy] = useState<string | undefined>(undefined);
  const [savingEmp, setSavingEmp] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingIdSide, setUploadingIdSide] = useState<'front' | 'back' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const idFrontInputRef = useRef<HTMLInputElement | null>(null);
  const idBackInputRef = useRef<HTMLInputElement | null>(null);

  // Full Profile Modal & ID Document Preview Lightbox
  const [profileEmp, setProfileEmp] = useState<EmployeeRecord | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{
    title: string;
    url: string;
    isPdf?: boolean;
    isObjectUrl?: boolean;
    driveLink?: string;
  } | null>(null);
  const [showSyncDriveConfirm, setShowSyncDriveConfirm] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
  const [deleteEmpTarget, setDeleteEmpTarget] = useState<EmployeeRecord | null>(null);
  const [deletingEmp, setDeletingEmp] = useState(false);

  // Statement modal
  const [statement, setStatement] = useState<{
    employee: EmployeeRecord;
    summary: NonNullable<EmployeeRecord['summary']>;
    ledger: CommissionLedgerEntry[];
    lunchDeductions: Array<{ id: string; date: string; amount: number; grossDailyEarnings: number }>;
    payments: Array<{ id: string; reference: string; paymentDate: string; amount: number; paymentMethod: string }>;
  } | null>(null);

  // Schedule form
  const [schEmpId, setSchEmpId] = useState('');
  const [schDate, setSchDate] = useState(new Date().toISOString().slice(0, 10));
  const [schStart, setSchStart] = useState('08:00');
  const [schEnd, setSchEnd] = useState('20:00');
  const [schDayOff, setSchDayOff] = useState(false);
  const [schNotes, setSchNotes] = useState('');

  // Attendance form
  const [attEmpId, setAttEmpId] = useState('');
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10));
  const [attIn, setAttIn] = useState('08:00');
  const [attOut, setAttOut] = useState('20:00');
  const [attStatus, setAttStatus] = useState<'Present' | 'Late' | 'Absent' | 'Approved Leave'>('Present');

  const isOwner = user.role === 'owner';
  const isManager = user.role === 'manager';
  const canManage = isOwner || isManager;
  const canLogAttendance = ['owner', 'manager'].includes(user.role);

  const load = async () => {
    try {
      const [eRes, sRes, aRes] = await Promise.all([
        apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
        apiFetch<{ schedules: typeof schedules }>('/api/schedules'),
        apiFetch<{ attendance: typeof attendance }>('/api/attendance'),
      ]);
      setEmployees(eRes.employees);
      setSchedules(sRes.schedules);
      setAttendance(aRes.attendance);
      if (eRes.employees.length > 0) {
        if (!schEmpId) setSchEmpId(eRes.employees[0].id);
        if (!attEmpId) setAttEmpId(eRes.employees[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staff data.');
    }
  };

  useEffect(() => {
    void load();
  }, [mode]);

  const filteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((emp) => {
      const currentStatus = getEmployeeStatus(emp);
      if (statusFilter !== 'all' && currentStatus !== statusFilter) return false;
      if (!q) return true;
      return (
        emp.fullName.toLowerCase().includes(q) ||
        emp.roleTitle.toLowerCase().includes(q) ||
        emp.phone.toLowerCase().includes(q) ||
        (emp.secondaryPhone || '').toLowerCase().includes(q) ||
        (emp.nationalId || '').toLowerCase().includes(q) ||
        (emp.homeAddress || '').toLowerCase().includes(q) ||
        emp.specialties.some((s) => s.toLowerCase().includes(q))
      );
    });
  }, [employees, searchQuery, statusFilter]);

  const openAddEmployeeModal = () => {
    setEditingEmpId(null);
    setEmpName('');
    setEmpRole('Salon Stylist');
    setEmpPhone('');
    setEmpSecondaryPhone('');
    setEmpEmail('');
    setEmpNationalId('');
    setEmpIdFrontUrl('');
    setEmpIdBackUrl('');
    setEmpHomeAddress('');
    setEmpEmergencyName('');
    setEmpEmergencyPhone('');
    setEmpAvatarUrl('');
    setEmpHireDate(new Date().toISOString().slice(0, 10));
    setEmpSpecialties('');
    setEmpShiftStart('08:00');
    setEmpShiftEnd('20:00');
    setEmpWorkingDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    setEmpLunchEligible(true);
    setEmpStatus('Active');
    setEmpLastDocUpdatedAt(undefined);
    setEmpLastDocUpdatedBy(undefined);
    setError('');
    setShowEmpModal(true);
  };

  const openEditEmployeeModal = (emp: EmployeeRecord) => {
    setEditingEmpId(emp.id);
    setEmpName(emp.fullName);
    setEmpRole(emp.roleTitle);
    setEmpPhone(emp.phone);
    setEmpSecondaryPhone(emp.secondaryPhone || '');
    setEmpEmail(emp.email || '');
    setEmpNationalId(emp.nationalId || '');
    setEmpIdFrontUrl(emp.nationalIdDocumentUrl || '');
    setEmpIdBackUrl(emp.nationalIdBackUrl || '');
    setEmpHomeAddress(emp.homeAddress || '');
    setEmpEmergencyName(emp.emergencyContactName || '');
    setEmpEmergencyPhone(emp.emergencyContactPhone || '');
    setEmpAvatarUrl(emp.avatarUrl || '');
    setEmpHireDate(emp.hireDate || new Date().toISOString().slice(0, 10));
    setEmpSpecialties(emp.specialties.join(', '));
    setEmpShiftStart(emp.defaultShiftStart || '08:00');
    setEmpShiftEnd(emp.defaultShiftEnd || '20:00');
    setEmpWorkingDays(emp.workingDays?.length ? emp.workingDays : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    setEmpLunchEligible(emp.lunchEligible);
    setEmpStatus(getEmployeeStatus(emp));
    setEmpLastDocUpdatedAt(emp.lastDocumentUpdatedAt);
    setEmpLastDocUpdatedBy(emp.lastDocumentUpdatedBy);
    setError('');
    setShowEmpModal(true);
  };

  const handlePhotoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setError('');
    try {
      const dataUrl = await resizeImageFileToDataUrl(file);
      setEmpAvatarUrl(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process profile picture.');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleNationalIdFileSelected = async (
    side: 'front' | 'back',
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIdSide(side);
    setError('');
    try {
      const dataUrl = await readNationalIdFileToDataUrl(file);
      if (side === 'front') {
        setEmpIdFrontUrl(dataUrl);
      } else {
        setEmpIdBackUrl(dataUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload National ID file.');
    } finally {
      setUploadingIdSide(null);
      if (side === 'front' && idFrontInputRef.current) {
        idFrontInputRef.current.value = '';
      }
      if (side === 'back' && idBackInputRef.current) {
        idBackInputRef.current.value = '';
      }
    }
  };

  const toggleWorkingDay = (day: string) => {
    setEmpWorkingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (empWorkingDays.length === 0) {
      setError('Please select at least one working day for the employee.');
      return;
    }

    setSavingEmp(true);
    const payload = {
      fullName: empName,
      roleTitle: empRole,
      phone: empPhone,
      secondaryPhone: empSecondaryPhone,
      email: empEmail,
      nationalId: empNationalId,
      nationalIdDocumentUrl: empIdFrontUrl,
      nationalIdBackUrl: empIdBackUrl,
      homeAddress: empHomeAddress,
      emergencyContactName: empEmergencyName,
      emergencyContactPhone: empEmergencyPhone,
      avatarUrl: empAvatarUrl,
      hireDate: empHireDate,
      specialties: empSpecialties
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      defaultShiftStart: empShiftStart,
      defaultShiftEnd: empShiftEnd,
      workingDays: empWorkingDays,
      lunchEligible: empLunchEligible,
      status: empStatus,
      active: empStatus === 'Active',
    };

    try {
      let saveRes: { employee: EmployeeRecord; driveWarning?: string };
      if (editingEmpId) {
        saveRes = await apiFetch<{ employee: EmployeeRecord; driveWarning?: string }>(
          `/api/employees/${editingEmpId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          }
        );
        setMsg(
          saveRes.driveWarning
            ? `Updated profile for ${empName}.`
            : googleConnected && (empAvatarUrl || empIdFrontUrl || empIdBackUrl)
              ? `Updated profile for ${empName} and synced media to Google Drive.`
              : `Updated profile for ${empName}.`
        );
      } else {
        saveRes = await apiFetch<{ employee: EmployeeRecord; driveWarning?: string }>('/api/employees', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMsg(
          saveRes.driveWarning
            ? `Registered new employee: ${empName}.`
            : googleConnected && (empAvatarUrl || empIdFrontUrl || empIdBackUrl)
              ? `Registered ${empName} and stored photo/ID documents on Google Drive.`
              : `Registered new employee: ${empName}.`
        );
      }
      if (saveRes.driveWarning) {
        setError(saveRes.driveWarning);
      }
      setShowEmpModal(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save employee record.');
    } finally {
      setSavingEmp(false);
    }
  };

  const closePreviewModal = () => {
    if (previewDoc?.isObjectUrl && previewDoc.url.startsWith('blob:')) {
      URL.revokeObjectURL(previewDoc.url);
    }
    setPreviewDoc(null);
  };

  const openDocumentPreview = async (
    title: string,
    localUrl?: string,
    driveFileId?: string,
    driveLink?: string
  ) => {
    setError('');
    if (localUrl) {
      setPreviewDoc({
        title,
        url: localUrl,
        isPdf: localUrl.startsWith('data:application/pdf'),
        driveLink,
      });
      return;
    }
    if (driveFileId) {
      try {
        const fetched = await fetchDriveMediaBlobUrl(driveFileId);
        setPreviewDoc({
          title,
          url: fetched.blobUrl,
          isPdf: fetched.mimeType === 'application/pdf',
          isObjectUrl: true,
          driveLink,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load preview from Google Drive.');
      }
    }
  };

  const handleSyncStaffMediaToDrive = async () => {
    setShowSyncDriveConfirm(false);
    setSyncingDrive(true);
    setError('');
    setMsg('');
    try {
      const res = await apiFetch<{
        syncedCount: number;
        skippedCount: number;
        errors: string[];
      }>('/api/workspace/drive/sync-employee-media', { method: 'POST' });
      if (res.errors.length > 0) {
        setError(`Some files had errors: ${res.errors.join(' | ')}`);
      }
      setMsg(
        res.syncedCount > 0
          ? `Uploaded ${res.syncedCount} staff photo/National ID file(s) to Google Drive (${res.skippedCount} already synced).`
          : `All staff photos and National IDs are already synced to Google Drive (${res.skippedCount} files).`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync staff media to Google Drive.');
    } finally {
      setSyncingDrive(false);
    }
  };

  const handleStatusChange = async (emp: EmployeeRecord, nextStatus: EmployeeStatus) => {
    const currentStatus = getEmployeeStatus(emp);
    if (currentStatus === nextStatus) return;
    if (isManager && currentStatus === 'Inactive' && nextStatus !== 'Inactive') {
      setError('Only the Owner / Admin can re-enable a disabled employee account.');
      return;
    }
    setError('');
    setMsg('');
    try {
      await apiFetch(`/api/employees/${emp.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus, active: nextStatus === 'Active' }),
      });
      setMsg(`${emp.fullName} status updated to ${nextStatus}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed.');
    }
  };

  const handleConfirmDeleteEmployee = async () => {
    if (!deleteEmpTarget || !isOwner) return;
    const target = deleteEmpTarget;
    setDeleteEmpTarget(null);
    setDeletingEmp(true);
    setError('');
    setMsg('');
    try {
      await apiFetch(`/api/employees/${target.id}`, { method: 'DELETE' });
      setMsg(`Deleted employee profile and linked account for ${target.fullName}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete employee.');
    } finally {
      setDeletingEmp(false);
    }
  };

  const openStatement = async (empId: string) => {
    setError('');
    try {
      const res = await apiFetch<NonNullable<typeof statement>>(`/api/employees/${empId}/statement`);
      setStatement(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load statement.');
    }
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: schEmpId,
          date: schDate,
          shiftStart: schStart,
          shiftEnd: schEnd,
          isDayOff: schDayOff,
          notes: schNotes,
        }),
      });
      setMsg('Shift schedule saved.');
      setSchNotes('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule.');
    }
  };

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: attEmpId,
          date: attDate,
          clockIn: attStatus === 'Absent' ? undefined : attIn,
          clockOut: attStatus === 'Absent' ? undefined : attOut,
          status: attStatus,
        }),
      });
      setMsg('Attendance logged and working hours calculated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save attendance.');
    }
  };

  const handleExportStaffPdf = () => {
    exportReportToPdf(
      'Staff Directory & HR Register',
      `Trendy Unisex Salon · ${filteredEmployees.length} Employees`,
      ['ID', 'Full Name', 'Role', 'National ID', 'Contacts', 'Home Address', 'Status', 'Last Doc Update'],
      filteredEmployees.map((e) => [
        e.id,
        e.fullName,
        e.roleTitle,
        e.nationalId || '—',
        [e.phone, e.secondaryPhone, e.email].filter(Boolean).join(' / '),
        e.homeAddress || '—',
        getEmployeeStatus(e),
        formatLastDocumentUpdate(e.lastDocumentUpdatedAt),
      ]),
      [
        `Total Staff Listed: ${filteredEmployees.length} (${
          filteredEmployees.filter((e) => getEmployeeStatus(e) === 'Active').length
        } Active, ${
          filteredEmployees.filter((e) => getEmployeeStatus(e) === 'On Leave').length
        } On Leave)`,
      ]
    );
  };

  const handleExportStaffExcel = () => {
    exportRowsToExcel('trendy_salon_staff_directory.xlsx', [
      {
        name: 'Employees',
        rows: filteredEmployees.map((e) => ({
          EmployeeID: e.id,
          FullName: e.fullName,
          RoleTitle: e.roleTitle,
          NationalID: e.nationalId || '',
          PrimaryPhone: e.phone,
          SecondaryPhone: e.secondaryPhone || '',
          Email: e.email || '',
          HomeAddress: e.homeAddress || '',
          EmergencyContactName: e.emergencyContactName || '',
          EmergencyContactPhone: e.emergencyContactPhone || '',
          Specialties: e.specialties.join(', '),
          HireDate: e.hireDate,
          Shift: `${e.defaultShiftStart}-${e.defaultShiftEnd}`,
          WorkingDays: e.workingDays.join(', '),
          LunchEligible: e.lunchEligible ? 'Yes' : 'No',
          Status: getEmployeeStatus(e),
          LastDocumentUpdate: e.lastDocumentUpdatedAt || '',
          LastUpdatedBy: e.lastDocumentUpdatedBy || '',
        })),
      },
    ]);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>
      )}
      {msg && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{msg}</span>
        </div>
      )}

      {mode === 'employees' && (
        <>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Salon Team &amp; Employee Records</h2>
              <p className="text-xs text-[#1D1717]/60">
                Manage staff profile pictures, National IDs (NIN), contacts, home addresses, emergency contacts, and commission statements
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManage && (
                <>
                  {googleConnected ? (
                    <button
                      type="button"
                      disabled={syncingDrive}
                      onClick={() => setShowSyncDriveConfirm(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E83B84]/35 bg-[#F3BFD3]/30 hover:bg-[#F3BFD3]/50 text-[#1D1717] text-xs font-semibold cursor-pointer disabled:opacity-60"
                    >
                      <Cloud className="w-3.5 h-3.5 text-[#E83B84]" />
                      {syncingDrive ? 'Syncing Drive...' : 'Sync Media to Drive'}
                    </button>
                  ) : (
                    onConnectGoogle && (
                      <button
                        type="button"
                        onClick={() => void onConnectGoogle()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#E83B84]/35 bg-white hover:bg-[#F8EEEB] text-[#E83B84] text-xs font-semibold cursor-pointer"
                      >
                        <Cloud className="w-3.5 h-3.5" /> Connect Drive Storage
                      </button>
                    )
                  )}
                  <button
                    onClick={handleExportStaffExcel}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-xs font-semibold cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" /> Excel
                  </button>
                  <button
                    onClick={handleExportStaffPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-xs font-semibold cursor-pointer"
                  >
                    <FileDown className="w-3.5 h-3.5 text-[#1D1717]" /> PDF Register
                  </button>
                  <button
                    onClick={openAddEmployeeModal}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12f74] text-white text-xs font-semibold cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Employee
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Search & Status Filter */}
          {employees.length > 1 && (
            <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-[#1D1717]/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by employee name, phone, National ID (NIN), or home address..."
                  className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs focus:outline-none focus:border-[#E83B84]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {(['all', 'Active', 'On Leave', 'Inactive'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1.5 rounded-xl font-semibold cursor-pointer ${
                      statusFilter === tab
                        ? 'bg-[#1D1717] text-white'
                        : 'bg-[#F8EEEB] text-[#1D1717]/75 hover:bg-[#F3BFD3]/50'
                    }`}
                  >
                    {tab === 'all' ? 'All' : tab}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredEmployees.map((emp) => {
              const empStatusValue = getEmployeeStatus(emp);
              const badgeStyle = STATUS_BADGE_MAP[empStatusValue];
              return (
              <div
                key={emp.id}
                className={`bg-white border rounded-2xl p-5 flex flex-col justify-between space-y-4 transition-colors ${
                  empStatusValue === 'Active'
                    ? 'border-[#1D1717]/10'
                    : empStatusValue === 'On Leave'
                      ? 'border-amber-200/80'
                      : 'border-[#1D1717]/15 opacity-75'
                }`}
              >
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    {emp.avatarUrl ? (
                      <img
                        src={emp.avatarUrl}
                        alt={emp.fullName}
                        referrerPolicy="no-referrer"
                        className="w-16 h-16 rounded-xl object-cover border border-[#1D1717]/10 shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-[#F3BFD3]/50 flex items-center justify-center text-lg font-bold text-[#E83B84] shrink-0">
                        {emp.fullName
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-bold text-[#1D1717] truncate">{emp.fullName}</h3>
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md border shrink-0 ${badgeStyle.badgeClass}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${badgeStyle.dotClass}`} />
                          {empStatusValue}
                        </span>
                      </div>
                      <p className="text-xs text-[#E83B84] font-medium truncate">{emp.roleTitle}</p>
                      <p className="text-[11px] font-mono text-[#1D1717]/55 mt-0.5">{emp.id}</p>
                    </div>
                  </div>

                  {/* HR & Contact Details */}
                  <div className="bg-[#F8EEEB]/70 rounded-xl p-3 space-y-1.5 text-xs text-[#1D1717]/80">
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5 text-[#E83B84] shrink-0" />
                      <span className="font-mono truncate">
                        {emp.phone}
                        {emp.secondaryPhone ? ` · ${emp.secondaryPhone}` : ''}
                      </span>
                    </div>
                    {emp.email && (
                      <div className="flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-[#E83B84] shrink-0" />
                        <span className="truncate">{emp.email}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <CreditCard className="w-3.5 h-3.5 text-[#E83B84] shrink-0" />
                        <span className="font-mono truncate">
                          <span className="font-sans text-[#1D1717]/60">NIN: </span>
                          {emp.nationalId || 'Not set'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(emp.avatarDriveFileId ||
                          emp.nationalIdFrontDriveFileId ||
                          emp.nationalIdBackDriveFileId) && (
                          <span
                            title="Documents/photo backed up on Google Drive"
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F3BFD3]/50 text-[#1D1717] border border-[#E83B84]/25"
                          >
                            <Cloud className="w-2.5 h-2.5 text-[#E83B84]" /> Drive
                          </span>
                        )}
                        {(emp.nationalIdDocumentUrl ||
                          emp.nationalIdBackUrl ||
                          emp.nationalIdFrontDriveFileId ||
                          emp.nationalIdBackDriveFileId) && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            ID Scan
                          </span>
                        )}
                      </div>
                    </div>

                    {(emp.nationalIdDocumentUrl ||
                      emp.nationalIdBackUrl ||
                      emp.nationalIdFrontDriveFileId ||
                      emp.nationalIdBackDriveFileId) && (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {(emp.nationalIdDocumentUrl || emp.nationalIdFrontDriveFileId) && (
                          <button
                            type="button"
                            onClick={() =>
                              void openDocumentPreview(
                                `${emp.fullName} — National ID Front`,
                                emp.nationalIdDocumentUrl,
                                emp.nationalIdFrontDriveFileId,
                                emp.nationalIdFrontDriveLink
                              )
                            }
                            className="group bg-white rounded-lg border border-[#1D1717]/10 p-1.5 text-left hover:border-[#E83B84] transition-colors cursor-pointer"
                          >
                            {emp.nationalIdDocumentUrl ? (
                              emp.nationalIdDocumentUrl.startsWith('data:application/pdf') ? (
                                <div className="h-12 rounded bg-[#F8EEEB] flex items-center justify-center gap-1 text-[10px] font-semibold text-[#E83B84]">
                                  <FileText className="w-3.5 h-3.5" /> Front PDF
                                </div>
                              ) : (
                                <img
                                  src={emp.nationalIdDocumentUrl}
                                  alt={`${emp.fullName} National ID Front`}
                                  className="w-full h-12 object-cover rounded"
                                />
                              )
                            ) : (
                              <div className="h-12 rounded bg-[#F8EEEB] flex items-center justify-center gap-1 text-[10px] font-semibold text-[#E83B84]">
                                <Cloud className="w-3.5 h-3.5" /> On Drive
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-between text-[10px] text-[#1D1717]/70">
                              <span className="font-semibold">ID Front</span>
                              <Eye className="w-3 h-3 text-[#E83B84] opacity-75 group-hover:opacity-100" />
                            </div>
                          </button>
                        )}
                        {(emp.nationalIdBackUrl || emp.nationalIdBackDriveFileId) && (
                          <button
                            type="button"
                            onClick={() =>
                              void openDocumentPreview(
                                `${emp.fullName} — National ID Back`,
                                emp.nationalIdBackUrl,
                                emp.nationalIdBackDriveFileId,
                                emp.nationalIdBackDriveLink
                              )
                            }
                            className="group bg-white rounded-lg border border-[#1D1717]/10 p-1.5 text-left hover:border-[#E83B84] transition-colors cursor-pointer"
                          >
                            {emp.nationalIdBackUrl ? (
                              emp.nationalIdBackUrl.startsWith('data:application/pdf') ? (
                                <div className="h-12 rounded bg-[#F8EEEB] flex items-center justify-center gap-1 text-[10px] font-semibold text-[#E83B84]">
                                  <FileText className="w-3.5 h-3.5" /> Back PDF
                                </div>
                              ) : (
                                <img
                                  src={emp.nationalIdBackUrl}
                                  alt={`${emp.fullName} National ID Back`}
                                  className="w-full h-12 object-cover rounded"
                                />
                              )
                            ) : (
                              <div className="h-12 rounded bg-[#F8EEEB] flex items-center justify-center gap-1 text-[10px] font-semibold text-[#E83B84]">
                                <Cloud className="w-3.5 h-3.5" /> On Drive
                              </div>
                            )}
                            <div className="mt-1 flex items-center justify-between text-[10px] text-[#1D1717]/70">
                              <span className="font-semibold">ID Back</span>
                              <Eye className="w-3 h-3 text-[#E83B84] opacity-75 group-hover:opacity-100" />
                            </div>
                          </button>
                        )}
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <MapPin className="w-3.5 h-3.5 text-[#E83B84] shrink-0 mt-0.5" />
                      <span className="line-clamp-2">
                        {emp.homeAddress || 'Home address not recorded'}
                      </span>
                    </div>
                    {(emp.emergencyContactName || emp.emergencyContactPhone) && (
                      <div className="flex items-start gap-2 pt-1 border-t border-[#1D1717]/10">
                        <ShieldAlert className="w-3.5 h-3.5 text-[#1D1717]/55 shrink-0 mt-0.5" />
                        <span className="text-[11px] text-[#1D1717]/70 truncate">
                          Next of Kin: {[emp.emergencyContactName, emp.emergencyContactPhone].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="text-xs text-[#1D1717]/75 space-y-1">
                    <div>
                      <span className="font-semibold">Specialties:</span>{' '}
                      {emp.specialties.join(' · ') || 'General'}
                    </div>
                    <div className="font-mono text-[#1D1717]/60">
                      Shift: {emp.defaultShiftStart}–{emp.defaultShiftEnd} &middot;{' '}
                      {emp.lunchEligible ? 'Lunch Deductible' : 'No Lunch Ded.'}
                    </div>
                    <div
                      className="flex items-center gap-1.5 text-[11px] text-[#1D1717]/60 pt-0.5"
                      title={
                        emp.lastDocumentUpdatedBy
                          ? `Last modified by ${emp.lastDocumentUpdatedBy}`
                          : undefined
                      }
                    >
                      <FileClock className="w-3.5 h-3.5 text-[#E83B84] shrink-0" />
                      <span>
                        Last Document Update:{' '}
                        <span className="font-mono font-medium text-[#1D1717]/80">
                          {formatLastDocumentUpdate(emp.lastDocumentUpdatedAt)}
                        </span>
                      </span>
                    </div>
                  </div>

                  {emp.summary && (
                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#1D1717]/10 text-xs">
                      <div>
                        <div className="text-[#1D1717]/55">Earned Commission</div>
                        <div className="font-mono font-bold tabular-nums">
                          {formatUGX(emp.summary.totalCommissionEarned)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[#1D1717]/55">Outstanding Balance</div>
                        <div className="font-mono font-bold tabular-nums text-[#E83B84]">
                          {formatUGX(emp.summary.outstandingBalance)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    onClick={() => setProfileEmp(emp)}
                    className="px-3 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold hover:bg-[#F8EEEB] cursor-pointer inline-flex items-center gap-1"
                  >
                    <UserRound className="w-3.5 h-3.5" /> Profile
                  </button>
                  {(canManage || user.employeeId === emp.id) && (
                    <button
                      onClick={() => void openStatement(emp.id)}
                      className="flex-1 py-2 px-3 rounded-xl bg-[#F8EEEB] hover:bg-[#F3BFD3]/60 text-xs font-semibold text-[#1D1717] cursor-pointer"
                    >
                      Statement
                    </button>
                  )}
                  {canManage && (
                    <>
                      <button
                        onClick={() => openEditEmployeeModal(emp)}
                        className="px-3 py-2 rounded-xl bg-[#1D1717] text-white hover:bg-[#1D1717]/85 text-xs font-semibold cursor-pointer inline-flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      <select
                        aria-label={`Change employment status for ${emp.fullName}`}
                        value={empStatusValue}
                        disabled={isManager && empStatusValue === 'Inactive'}
                        title={
                          isManager && empStatusValue === 'Inactive'
                            ? 'Only Owner / Admin can re-enable a disabled employee account'
                            : undefined
                        }
                        onChange={(e) =>
                          void handleStatusChange(emp, e.target.value as EmployeeStatus)
                        }
                        className="px-2.5 py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F8EEEB] text-xs font-semibold cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                      >
                        {EMPLOYEE_STATUS_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                      {isOwner && (
                        <button
                          type="button"
                          disabled={deletingEmp}
                          onClick={() => setDeleteEmpTarget(emp)}
                          title={`Delete ${emp.fullName}`}
                          className="p-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {filteredEmployees.length === 0 && (
            <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-10 text-center text-xs text-[#1D1717]/60">
              No employees match your current search or filter criteria.
            </div>
          )}
        </>
      )}

      {mode === 'scheduling' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {canManage && (
            <form
              onSubmit={handleSaveSchedule}
              className="lg:col-span-4 bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4 h-fit"
            >
              <h3 className="text-base font-bold">Assign Shift / Day Off</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Stylist</label>
                  <select
                    value={schEmpId}
                    onChange={(e) => setSchEmpId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                  >
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={schDate}
                    onChange={(e) => setSchDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schDayOff}
                    onChange={(e) => setSchDayOff(e.target.checked)}
                  />
                  <span>Mark as Day Off (blocks booking on this date)</span>
                </label>
                {!schDayOff && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold mb-1">Shift Start</label>
                      <input
                        type="time"
                        value={schStart}
                        onChange={(e) => setSchStart(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Shift End</label>
                      <input
                        type="time"
                        value={schEnd}
                        onChange={(e) => setSchEnd(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                      />
                    </div>
                  </div>
                )}
                <input
                  value={schNotes}
                  onChange={(e) => setSchNotes(e.target.value)}
                  placeholder="Shift or break notes"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                >
                  Save Schedule Override
                </button>
              </div>
            </form>
          )}

          <div
            className={`${
              canManage ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4`}
          >
            <h3 className="text-base font-bold">Default Weekly Shifts &amp; Schedule Overrides</h3>
            <div className="divide-y divide-[#1D1717]/10 text-xs">
              {employees.map((e) => (
                <div key={e.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-sm">{e.fullName}</div>
                    <div className="text-[#1D1717]/60">Working Days: {e.workingDays.join(', ')}</div>
                  </div>
                  <div className="font-mono font-semibold text-[#E83B84]">
                    {e.defaultShiftStart} – {e.defaultShiftEnd}
                  </div>
                </div>
              ))}
            </div>

            {schedules.length > 0 && (
              <div className="pt-4 border-t border-[#1D1717]/10">
                <h4 className="text-xs font-bold text-[#1D1717]/70 mb-2">Specific Date Overrides</h4>
                <div className="space-y-1.5 text-xs">
                  {schedules.map((s) => {
                    const emp = employees.find((e) => e.id === s.employeeId);
                    return (
                      <div key={s.id} className="flex justify-between p-2.5 rounded-xl bg-[#F8EEEB]">
                        <span className="font-semibold">
                          {emp?.fullName || s.employeeId} &middot; <span className="font-mono">{s.date}</span>
                        </span>
                        <span className="font-mono">
                          {s.isDayOff ? 'DAY OFF' : `${s.shiftStart} – ${s.shiftEnd}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'attendance' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {canLogAttendance && (
            <form
              onSubmit={handleSaveAttendance}
              className="lg:col-span-4 bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4 h-fit"
            >
              <h3 className="text-base font-bold flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#E83B84]" /> Record Attendance
              </h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold mb-1">Employee</label>
                  <select
                    value={attEmpId}
                    onChange={(e) => setAttEmpId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                  >
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    value={attDate}
                    onChange={(e) => setAttDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Status</label>
                  <select
                    value={attStatus}
                    onChange={(e) => setAttStatus(e.target.value as typeof attStatus)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                  >
                    <option value="Present">Present</option>
                    <option value="Late">Late</option>
                    <option value="Absent">Absent</option>
                    <option value="Approved Leave">Approved Leave</option>
                  </select>
                </div>
                {attStatus !== 'Absent' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold mb-1">Clock In</label>
                      <input
                        type="time"
                        value={attIn}
                        onChange={(e) => setAttIn(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Clock Out</label>
                      <input
                        type="time"
                        value={attOut}
                        onChange={(e) => setAttOut(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                      />
                    </div>
                  </div>
                )}
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                >
                  Save Attendance Log
                </button>
              </div>
            </form>
          )}

          <div
            className={`${
              canLogAttendance ? 'lg:col-span-8' : 'lg:col-span-12'
            } bg-white border border-[#1D1717]/10 rounded-2xl p-6`}
          >
            <h3 className="text-base font-bold mb-4">Attendance &amp; Working Hours Log</h3>
            {attendance.length === 0 ? (
              <p className="text-xs text-[#1D1717]/60 py-8 text-center">No attendance records logged yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Employee</th>
                      <th className="py-2.5 px-3">Clock In / Out</th>
                      <th className="py-2.5 px-3 text-right">Hours</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1D1717]/10">
                    {attendance.map((a) => {
                      const emp = employees.find((e) => e.id === a.employeeId);
                      return (
                        <tr key={a.id}>
                          <td className="py-2.5 px-3 font-mono">{a.date}</td>
                          <td className="py-2.5 px-3 font-semibold">{emp?.fullName || a.employeeId}</td>
                          <td className="py-2.5 px-3 font-mono">
                            {a.clockIn || '—'} – {a.clockOut || '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">{a.hoursWorked}h</td>
                          <td className="py-2.5 px-3 font-semibold text-[#E83B84]">{a.status}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add / Edit Employee Modal */}
      {showEmpModal && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSaveEmployee}
            className="w-full max-w-2xl bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-5 my-8 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#1D1717]/10 pb-3">
              <div>
                <h3 className="text-lg font-bold">
                  {editingEmpId ? `Edit Employee Profile — ${empName}` : 'Register Salon Employee'}
                </h3>
                <p className="text-xs text-[#1D1717]/60">
                  Capture profile photo, National ID (NIN), contact numbers, residential address, and shift setup
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEmpModal(false)}
                className="p-1.5 rounded-lg hover:bg-[#F8EEEB] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Profile Picture Uploader */}
            <div className="bg-[#F8EEEB] rounded-2xl p-4 flex flex-col sm:flex-row items-center gap-4">
              {empAvatarUrl ? (
                <img
                  src={empAvatarUrl}
                  alt={empName || 'Employee preview'}
                  className="w-20 h-20 rounded-2xl object-cover border-2 border-white shadow-sm shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-[#F3BFD3]/60 border-2 border-white flex items-center justify-center text-xl font-bold text-[#E83B84] shrink-0">
                  {empName ? empName[0].toUpperCase() : <UserRound className="w-8 h-8" />}
                </div>
              )}

              <div className="flex-1 w-full space-y-2 text-xs">
                <div className="font-semibold text-[#1D1717]">Employee Profile Picture</div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handlePhotoFileSelected}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={uploadingPhoto}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer disabled:opacity-60"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {uploadingPhoto ? 'Processing...' : empAvatarUrl ? 'Change Photo' : 'Upload Photo'}
                  </button>
                  {empAvatarUrl && (
                    <button
                      type="button"
                      onClick={() => setEmpAvatarUrl('')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-[#1D1717]/15 text-red-700 font-semibold cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </div>
                <input
                  value={empAvatarUrl.startsWith('data:') ? '' : empAvatarUrl}
                  onChange={(e) => setEmpAvatarUrl(e.target.value)}
                  placeholder="Or paste an image URL (https://...)"
                  className="w-full px-3 py-1.5 rounded-xl border border-[#1D1717]/15 bg-white text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Full Name *</label>
                <input
                  required
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  placeholder="e.g. Beatrice Okello"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Role / Position Title *</label>
                <input
                  required
                  value={empRole}
                  onChange={(e) => setEmpRole(e.target.value)}
                  placeholder="e.g. Senior Hair Braider"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">National ID (NIN)</label>
                <input
                  value={empNationalId}
                  onChange={(e) => setEmpNationalId(e.target.value.toUpperCase())}
                  placeholder="e.g. CF94012104821K"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono uppercase"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Hire Date</label>
                <input
                  type="date"
                  value={empHireDate}
                  onChange={(e) => setEmpHireDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>

              {/* Upload National ID Document (Front & Back) */}
              <div className="sm:col-span-2 bg-[#F8EEEB]/80 border border-[#1D1717]/10 rounded-2xl p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#1D1717] flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-[#E83B84]" />
                    Upload National ID Copy (Front &amp; Back)
                  </span>
                  <span className="text-[11px] text-[#1D1717]/60 flex items-center gap-1">
                    <Cloud className="w-3 h-3 text-[#E83B84]" />
                    {googleConnected
                      ? 'Auto-uploads to Google Drive on save'
                      : 'Connect Google Drive to sync copies to Drive'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Front Side */}
                  <div className="bg-white rounded-xl border border-[#1D1717]/10 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">Front of National ID</span>
                      {empIdFrontUrl && (
                        <button
                          type="button"
                          onClick={() => setEmpIdFrontUrl('')}
                          className="text-[11px] text-red-700 font-semibold hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {empIdFrontUrl ? (
                      empIdFrontUrl.startsWith('data:application/pdf') ? (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8EEEB]">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[11px]">
                            <FileText className="w-4 h-4 text-[#E83B84]" /> PDF Document Uploaded
                          </span>
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ title: 'National ID — Front', url: empIdFrontUrl })}
                            className="text-[11px] font-semibold text-[#E83B84] hover:underline cursor-pointer"
                          >
                            View
                          </button>
                        </div>
                      ) : (
                        <div className="relative group">
                          <img
                            src={empIdFrontUrl}
                            alt="National ID Front"
                            className="w-full h-24 object-cover rounded-lg border border-[#1D1717]/10"
                          />
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ title: 'National ID — Front', url: empIdFrontUrl })}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#E83B84] hover:underline cursor-pointer"
                          >
                            <Eye className="w-3 h-3" /> Preview Full Size
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="text-[11px] text-[#1D1717]/50 py-2">No front scan uploaded</div>
                    )}

                    <input
                      ref={idFrontInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      onChange={(e) => void handleNationalIdFileSelected('front', e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingIdSide === 'front'}
                      onClick={() => idFrontInputRef.current?.click()}
                      className="w-full py-1.5 px-3 rounded-lg border border-[#1D1717]/15 bg-[#F8EEEB] hover:bg-[#F3BFD3]/50 font-semibold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <Upload className="w-3 h-3 text-[#E83B84]" />
                      {uploadingIdSide === 'front'
                        ? 'Uploading...'
                        : empIdFrontUrl
                          ? 'Replace Front ID'
                          : 'Upload Front ID'}
                    </button>
                  </div>

                  {/* Back Side */}
                  <div className="bg-white rounded-xl border border-[#1D1717]/10 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[11px]">Back of National ID (Optional)</span>
                      {empIdBackUrl && (
                        <button
                          type="button"
                          onClick={() => setEmpIdBackUrl('')}
                          className="text-[11px] text-red-700 font-semibold hover:underline cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    {empIdBackUrl ? (
                      empIdBackUrl.startsWith('data:application/pdf') ? (
                        <div className="flex items-center justify-between p-2 rounded-lg bg-[#F8EEEB]">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[11px]">
                            <FileText className="w-4 h-4 text-[#E83B84]" /> PDF Document Uploaded
                          </span>
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ title: 'National ID — Back', url: empIdBackUrl })}
                            className="text-[11px] font-semibold text-[#E83B84] hover:underline cursor-pointer"
                          >
                            View
                          </button>
                        </div>
                      ) : (
                        <div className="relative group">
                          <img
                            src={empIdBackUrl}
                            alt="National ID Back"
                            className="w-full h-24 object-cover rounded-lg border border-[#1D1717]/10"
                          />
                          <button
                            type="button"
                            onClick={() => setPreviewDoc({ title: 'National ID — Back', url: empIdBackUrl })}
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#E83B84] hover:underline cursor-pointer"
                          >
                            <Eye className="w-3 h-3" /> Preview Full Size
                          </button>
                        </div>
                      )
                    ) : (
                      <div className="text-[11px] text-[#1D1717]/50 py-2">No back scan uploaded</div>
                    )}

                    <input
                      ref={idBackInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf"
                      onChange={(e) => void handleNationalIdFileSelected('back', e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={uploadingIdSide === 'back'}
                      onClick={() => idBackInputRef.current?.click()}
                      className="w-full py-1.5 px-3 rounded-lg border border-[#1D1717]/15 bg-[#F8EEEB] hover:bg-[#F3BFD3]/50 font-semibold text-[11px] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      <Upload className="w-3 h-3 text-[#E83B84]" />
                      {uploadingIdSide === 'back'
                        ? 'Uploading...'
                        : empIdBackUrl
                          ? 'Replace Back ID'
                          : 'Upload Back ID'}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold mb-1">Primary Contact Phone *</label>
                <input
                  required
                  value={empPhone}
                  onChange={(e) => setEmpPhone(e.target.value)}
                  placeholder="+256 772 ..."
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Secondary / WhatsApp Phone</label>
                <input
                  value={empSecondaryPhone}
                  onChange={(e) => setEmpSecondaryPhone(e.target.value)}
                  placeholder="+256 701 ..."
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Email Address</label>
                <input
                  type="email"
                  value={empEmail}
                  onChange={(e) => setEmpEmail(e.target.value)}
                  placeholder="stylist@trendysalon.ug"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Home Address</label>
                <input
                  value={empHomeAddress}
                  onChange={(e) => setEmpHomeAddress(e.target.value)}
                  placeholder="Village / Cell, Ward, District (e.g. Madibira 'A', Busia)"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Emergency Contact / Next of Kin Name</label>
                <input
                  value={empEmergencyName}
                  onChange={(e) => setEmpEmergencyName(e.target.value)}
                  placeholder="Full name of next of kin"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Emergency Contact Phone</label>
                <input
                  value={empEmergencyPhone}
                  onChange={(e) => setEmpEmergencyPhone(e.target.value)}
                  placeholder="+256 ..."
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">Service Specialties (comma-separated)</label>
                <input
                  value={empSpecialties}
                  onChange={(e) => setEmpSpecialties(e.target.value)}
                  placeholder="e.g. Hair Plaiting, Blow Dry, Haircuts, Nails"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
              </div>

              <div>
                <label className="block font-semibold mb-1">Default Shift Start</label>
                <input
                  type="time"
                  value={empShiftStart}
                  onChange={(e) => setEmpShiftStart(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Default Shift End</label>
                <input
                  type="time"
                  value={empShiftEnd}
                  onChange={(e) => setEmpShiftEnd(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1.5">Working Days</label>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_DAYS.map((day) => {
                    const selected = empWorkingDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleWorkingDay(day)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border ${
                          selected
                            ? 'bg-[#E83B84] text-white border-[#E83B84]'
                            : 'bg-white text-[#1D1717]/70 border-[#1D1717]/15 hover:bg-[#F8EEEB]'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center pt-1">
                <div>
                  <label className="block font-semibold mb-1">Employment Status</label>
                  <select
                    value={empStatus}
                    disabled={
                      Boolean(editingEmpId) &&
                      isManager &&
                      getEmployeeStatus(
                        employees.find((item) => item.id === editingEmpId) || {
                          active: true,
                          status: 'Active',
                        }
                      ) === 'Inactive'
                    }
                    onChange={(e) => setEmpStatus(e.target.value as EmployeeStatus)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white font-semibold disabled:opacity-55 disabled:cursor-not-allowed"
                  >
                    {EMPLOYEE_STATUS_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 font-semibold cursor-pointer sm:pt-5">
                  <input
                    type="checkbox"
                    checked={empLunchEligible}
                    onChange={(e) => setEmpLunchEligible(e.target.checked)}
                  />
                  <span>Eligible for daily UGX 2,500 lunch deduction</span>
                </label>
              </div>
              {editingEmpId && (
                <div className="sm:col-span-2 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F8EEEB] text-[11px] text-[#1D1717]/75">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <FileClock className="w-3.5 h-3.5 text-[#E83B84]" />
                    Last Document Update
                  </span>
                  <span className="font-mono">
                    {formatLastDocumentUpdate(empLastDocUpdatedAt)}
                    {empLastDocUpdatedBy ? ` · by ${empLastDocUpdatedBy}` : ''}
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-[#1D1717]/10">
              <button
                type="button"
                onClick={() => setShowEmpModal(false)}
                className="px-4 py-2 rounded-xl border border-[#1D1717]/15 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEmp}
                className="px-5 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12f74] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {savingEmp ? 'Saving...' : editingEmpId ? 'Save Changes' : 'Register Employee'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Employee Full Profile / HR Card Modal */}
      {profileEmp && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-2xl border border-[#1D1717]/15 overflow-hidden my-8 max-h-[92vh] overflow-y-auto">
            <div className="bg-[#1D1717] text-white p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                {profileEmp.avatarUrl ? (
                  <img
                    src={profileEmp.avatarUrl}
                    alt={profileEmp.fullName}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-[#E83B84]"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-[#E83B84] flex items-center justify-center text-xl font-bold text-white">
                    {profileEmp.fullName[0]}
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-bold">{profileEmp.fullName}</h3>
                    {(() => {
                      const pStatus = getEmployeeStatus(profileEmp);
                      const pBadge = STATUS_BADGE_MAP[pStatus];
                      return (
                        <span
                          className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${pBadge.darkBadgeClass}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${pBadge.dotClass}`} />
                          {pStatus}
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-xs text-[#F3BFD3]">{profileEmp.roleTitle}</p>
                  <p className="text-[11px] font-mono text-white/60 mt-0.5">
                    {profileEmp.id} &middot; Hired {profileEmp.hireDate}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setProfileEmp(null)}
                className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-[#F8EEEB]">
                  <div className="text-[#1D1717]/55">National ID (NIN)</div>
                  <div className="font-mono font-bold mt-0.5">{profileEmp.nationalId || 'Not recorded'}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F8EEEB]">
                  <div className="text-[#1D1717]/55">Primary Contact</div>
                  <div className="font-mono font-bold mt-0.5">{profileEmp.phone}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F8EEEB]">
                  <div className="text-[#1D1717]/55">Secondary / WhatsApp</div>
                  <div className="font-mono font-bold mt-0.5">{profileEmp.secondaryPhone || '—'}</div>
                </div>
                <div className="p-3 rounded-xl bg-[#F8EEEB]">
                  <div className="text-[#1D1717]/55">Email Address</div>
                  <div className="font-semibold mt-0.5 truncate">{profileEmp.email || '—'}</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/55">Home Address</div>
                <div className="font-semibold mt-0.5">{profileEmp.homeAddress || 'Not recorded'}</div>
              </div>

              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/55">Emergency Contact / Next of Kin</div>
                <div className="font-semibold mt-0.5">
                  {profileEmp.emergencyContactName || profileEmp.emergencyContactPhone
                    ? [profileEmp.emergencyContactName, profileEmp.emergencyContactPhone].filter(Boolean).join(' · ')
                    : 'Not recorded'}
                </div>
              </div>

              {(profileEmp.nationalIdDocumentUrl ||
                profileEmp.nationalIdBackUrl ||
                profileEmp.nationalIdFrontDriveFileId ||
                profileEmp.nationalIdBackDriveFileId) && (
                <div className="p-3 rounded-xl bg-[#F8EEEB] space-y-2">
                  <div className="text-[#1D1717]/55 font-semibold flex items-center justify-between">
                    <span>Uploaded National ID Document(s)</span>
                    {(profileEmp.nationalIdFrontDriveLink || profileEmp.nationalIdBackDriveLink) && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-[#E83B84]">
                        <Cloud className="w-3 h-3" /> Stored on Drive
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(profileEmp.nationalIdDocumentUrl || profileEmp.nationalIdFrontDriveFileId) && (
                      <div className="bg-white rounded-xl p-2 border border-[#1D1717]/10 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold">
                          <span>Front Side</span>
                          {profileEmp.nationalIdFrontDriveLink && (
                            <a
                              href={profileEmp.nationalIdFrontDriveLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] text-[#E83B84] hover:underline"
                            >
                              Drive <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        {profileEmp.nationalIdDocumentUrl ? (
                          profileEmp.nationalIdDocumentUrl.startsWith('data:application/pdf') ? (
                            <button
                              type="button"
                              onClick={() =>
                                void openDocumentPreview(
                                  `${profileEmp.fullName} — National ID Front`,
                                  profileEmp.nationalIdDocumentUrl,
                                  profileEmp.nationalIdFrontDriveFileId,
                                  profileEmp.nationalIdFrontDriveLink
                                )
                              }
                              className="w-full py-5 rounded-lg bg-[#F8EEEB] text-center text-[11px] font-semibold text-[#E83B84] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <FileText className="w-4 h-4" /> PDF Document Attached
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                void openDocumentPreview(
                                  `${profileEmp.fullName} — National ID Front`,
                                  profileEmp.nationalIdDocumentUrl,
                                  profileEmp.nationalIdFrontDriveFileId,
                                  profileEmp.nationalIdFrontDriveLink
                                )
                              }
                              className="block w-full cursor-pointer group"
                            >
                              <img
                                src={profileEmp.nationalIdDocumentUrl}
                                alt="National ID Front"
                                className="w-full h-28 object-cover rounded-lg border border-[#1D1717]/10 group-hover:border-[#E83B84] transition-colors"
                              />
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void openDocumentPreview(
                                `${profileEmp.fullName} — National ID Front`,
                                undefined,
                                profileEmp.nationalIdFrontDriveFileId,
                                profileEmp.nationalIdFrontDriveLink
                              )
                            }
                            className="w-full py-5 rounded-lg bg-[#F8EEEB] text-center text-[11px] font-semibold text-[#E83B84] flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Cloud className="w-4 h-4" /> Preview from Google Drive
                          </button>
                        )}
                        <div className="flex items-center justify-between text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              void openDocumentPreview(
                                `${profileEmp.fullName} — National ID Front`,
                                profileEmp.nationalIdDocumentUrl,
                                profileEmp.nationalIdFrontDriveFileId,
                                profileEmp.nationalIdFrontDriveLink
                              )
                            }
                            className="font-semibold text-[#E83B84] hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" /> View
                          </button>
                          {profileEmp.nationalIdDocumentUrl && (
                            <a
                              href={profileEmp.nationalIdDocumentUrl}
                              download={`${profileEmp.fullName.replace(/\s+/g, '_')}_National_ID_Front`}
                              className="font-semibold text-[#1D1717]/75 hover:underline"
                            >
                              Download
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                    {(profileEmp.nationalIdBackUrl || profileEmp.nationalIdBackDriveFileId) && (
                      <div className="bg-white rounded-xl p-2 border border-[#1D1717]/10 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-semibold">
                          <span>Back Side</span>
                          {profileEmp.nationalIdBackDriveLink && (
                            <a
                              href={profileEmp.nationalIdBackDriveLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-0.5 text-[10px] text-[#E83B84] hover:underline"
                            >
                              Drive <ExternalLink className="w-2.5 h-2.5" />
                            </a>
                          )}
                        </div>
                        {profileEmp.nationalIdBackUrl ? (
                          profileEmp.nationalIdBackUrl.startsWith('data:application/pdf') ? (
                            <button
                              type="button"
                              onClick={() =>
                                void openDocumentPreview(
                                  `${profileEmp.fullName} — National ID Back`,
                                  profileEmp.nationalIdBackUrl,
                                  profileEmp.nationalIdBackDriveFileId,
                                  profileEmp.nationalIdBackDriveLink
                                )
                              }
                              className="w-full py-5 rounded-lg bg-[#F8EEEB] text-center text-[11px] font-semibold text-[#E83B84] flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <FileText className="w-4 h-4" /> PDF Document Attached
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                void openDocumentPreview(
                                  `${profileEmp.fullName} — National ID Back`,
                                  profileEmp.nationalIdBackUrl,
                                  profileEmp.nationalIdBackDriveFileId,
                                  profileEmp.nationalIdBackDriveLink
                                )
                              }
                              className="block w-full cursor-pointer group"
                            >
                              <img
                                src={profileEmp.nationalIdBackUrl}
                                alt="National ID Back"
                                className="w-full h-28 object-cover rounded-lg border border-[#1D1717]/10 group-hover:border-[#E83B84] transition-colors"
                              />
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void openDocumentPreview(
                                `${profileEmp.fullName} — National ID Back`,
                                undefined,
                                profileEmp.nationalIdBackDriveFileId,
                                profileEmp.nationalIdBackDriveLink
                              )
                            }
                            className="w-full py-5 rounded-lg bg-[#F8EEEB] text-center text-[11px] font-semibold text-[#E83B84] flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Cloud className="w-4 h-4" /> Preview from Google Drive
                          </button>
                        )}
                        <div className="flex items-center justify-between text-[11px]">
                          <button
                            type="button"
                            onClick={() =>
                              void openDocumentPreview(
                                `${profileEmp.fullName} — National ID Back`,
                                profileEmp.nationalIdBackUrl,
                                profileEmp.nationalIdBackDriveFileId,
                                profileEmp.nationalIdBackDriveLink
                              )
                            }
                            className="font-semibold text-[#E83B84] hover:underline inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" /> View
                          </button>
                          {profileEmp.nationalIdBackUrl && (
                            <a
                              href={profileEmp.nationalIdBackUrl}
                              download={`${profileEmp.fullName.replace(/\s+/g, '_')}_National_ID_Back`}
                              className="font-semibold text-[#1D1717]/75 hover:underline"
                            >
                              Download
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="p-3 rounded-xl bg-[#F8EEEB] flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[#1D1717]/65 font-semibold">
                  <FileClock className="w-3.5 h-3.5 text-[#E83B84]" />
                  Last Document Update
                </span>
                <span className="font-mono font-bold text-[#1D1717]">
                  {formatLastDocumentUpdate(profileEmp.lastDocumentUpdatedAt)}
                  {profileEmp.lastDocumentUpdatedBy ? (
                    <span className="font-sans font-normal text-[#1D1717]/60">
                      {' '}
                      · by {profileEmp.lastDocumentUpdatedBy}
                    </span>
                  ) : null}
                </span>
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-[#1D1717]/10">
                <div className="text-[#1D1717]/70">
                  Shift: <span className="font-mono font-semibold">{profileEmp.defaultShiftStart}–{profileEmp.defaultShiftEnd}</span> ({profileEmp.workingDays.join(', ')})
                </div>
                {canManage && (
                  <button
                    onClick={() => {
                      const target = profileEmp;
                      setProfileEmp(null);
                      openEditEmployeeModal(target);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit Details
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* National ID Document Lightbox Modal */}
      {previewDoc && (
        <div className="fixed inset-0 z-[60] bg-[#1D1717]/75 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl border border-[#1D1717]/20 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#1D1717] text-white">
              <h4 className="text-sm font-bold">{previewDoc.title}</h4>
              <div className="flex items-center gap-2">
                {previewDoc.driveLink && (
                  <a
                    href={previewDoc.driveLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white"
                  >
                    Open in Drive <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <a
                  href={previewDoc.url}
                  download={previewDoc.title.replace(/[^a-z0-9]+/gi, '_')}
                  className="text-xs font-semibold px-3 py-1 rounded-lg bg-[#E83B84] text-white"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={closePreviewModal}
                  className="p-1 rounded-lg hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 bg-[#F8EEEB] flex items-center justify-center max-h-[80vh] overflow-auto">
              {previewDoc.isPdf || previewDoc.url.startsWith('data:application/pdf') ? (
                <iframe
                  src={previewDoc.url}
                  title={previewDoc.title}
                  className="w-full h-[70vh] rounded-xl border border-[#1D1717]/15 bg-white"
                />
              ) : (
                <img
                  src={previewDoc.url}
                  alt={previewDoc.title}
                  className="max-w-full max-h-[72vh] rounded-xl object-contain border border-[#1D1717]/15 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Individual Employee Statement Modal */}
      {statement && (
        <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-3xl bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-5 my-8">
            <div className="flex items-start justify-between border-b border-[#1D1717]/10 pb-4">
              <div>
                <h3 className="text-lg font-bold">
                  Employee Financial Statement — {statement.employee.fullName}
                </h3>
                <p className="text-xs text-[#1D1717]/60">
                  {statement.employee.roleTitle}
                  {statement.employee.nationalId ? ` · NIN: ${statement.employee.nationalId}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    exportReportToPdf(
                      `Employee Statement - ${statement.employee.fullName}`,
                      statement.employee.roleTitle,
                      ['Date', 'Ref', 'Service', 'Gross', 'Lunch Alloc', 'Net Comm.', 'Rate', 'Commission'],
                      statement.ledger.map((l) => [
                        l.date,
                        l.transactionReference,
                        l.serviceName,
                        formatUGX(l.grossEarnings),
                        formatUGX(l.lunchAllocation),
                        formatUGX(l.netCommissionableEarnings),
                        `${Math.round(l.commissionRate * 100)}%`,
                        formatUGX(l.employeeCommission),
                      ]),
                      [
                        `Total Gross: ${formatUGX(statement.summary.grossEarnings)} | Lunch Deducted: ${formatUGX(statement.summary.totalLunchDeducted)} | Total Commission: ${formatUGX(statement.summary.totalCommissionEarned)}`,
                        `Total Paid: ${formatUGX(statement.summary.totalPaid)} | Outstanding Balance: ${formatUGX(statement.summary.outstandingBalance)}`,
                      ]
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1D1717] text-white text-xs font-semibold cursor-pointer"
                >
                  <FileDown className="w-3.5 h-3.5" /> PDF Statement
                </button>
                <button
                  onClick={() => setStatement(null)}
                  className="p-1.5 rounded-lg hover:bg-[#F8EEEB] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Gross Earnings</div>
                <div className="font-mono font-bold mt-1">{formatUGX(statement.summary.grossEarnings)}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Lunch Deducted</div>
                <div className="font-mono font-bold mt-1">{formatUGX(statement.summary.totalLunchDeducted)}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Net Commission</div>
                <div className="font-mono font-bold mt-1">{formatUGX(statement.summary.totalCommissionEarned)}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#F8EEEB]">
                <div className="text-[#1D1717]/60">Paid to Date</div>
                <div className="font-mono font-bold mt-1">{formatUGX(statement.summary.totalPaid)}</div>
              </div>
              <div className="p-3 rounded-xl bg-[#1D1717] text-white">
                <div className="text-[#F3BFD3]">Outstanding</div>
                <div className="font-mono font-bold mt-1">{formatUGX(statement.summary.outstandingBalance)}</div>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-2 px-2">Date</th>
                    <th className="py-2 px-2">Service</th>
                    <th className="py-2 px-2 text-right">Gross</th>
                    <th className="py-2 px-2 text-right">Lunch Alloc</th>
                    <th className="py-2 px-2 text-right">Net Base</th>
                    <th className="py-2 px-2 text-right">Rate</th>
                    <th className="py-2 px-2 text-right">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {statement.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 px-2 font-mono">{l.date}</td>
                      <td className="py-2 px-2">{l.serviceName}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatUGX(l.grossEarnings)}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatUGX(l.lunchAllocation)}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatUGX(l.netCommissionableEarnings)}</td>
                      <td className="py-2 px-2 text-right font-mono">{Math.round(l.commissionRate * 100)}%</td>
                      <td className="py-2 px-2 text-right font-mono font-bold text-[#E83B84]">
                        {formatUGX(l.employeeCommission)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={showSyncDriveConfirm}
        title="Sync Staff Photos & National IDs to Google Drive?"
        description="Uploads all staff profile pictures and National ID scans that are not yet backed up into organized folders inside your Google Drive ('Trendy Unisex Salon - Records & Media')."
        confirmLabel="Upload to Google Drive"
        onCancel={() => setShowSyncDriveConfirm(false)}
        onConfirm={() => void handleSyncStaffMediaToDrive()}
      />

      <ConfirmModal
        open={Boolean(deleteEmpTarget)}
        title={`Delete Employee ${deleteEmpTarget?.fullName || ''}?`}
        description="Permanently deletes this employee profile and any linked employee login account. Employees with historical POS, commission, or payout records cannot be deleted and should be disabled (Inactive) instead."
        confirmLabel="Delete Employee"
        destructive
        onCancel={() => setDeleteEmpTarget(null)}
        onConfirm={() => void handleConfirmDeleteEmployee()}
      />
    </div>
  );
};
