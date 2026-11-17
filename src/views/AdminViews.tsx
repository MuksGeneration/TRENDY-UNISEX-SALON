import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Bell,
  Check,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Plus,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, fetchDriveMediaBlobUrl } from '../lib/api';
import { ConfirmModal } from '../components/ConfirmModal';
import type {
  DriveDocumentCategory,
  DriveDocumentRecord,
  EmployeeRecord,
  SalonSettings,
  SessionUser,
  UserRole,
} from '../types';

async function resizeSalonLogoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid logo image file (PNG, JPG, or WebP).');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Selected logo file is too large (max 10 MB before compression).');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected logo file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted logo image.'));
      img.onload = () => {
        const maxDim = 512;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser canvas is unavailable for image processing.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const outMime = file.type === 'image/png' || file.type === 'image/webp' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(outMime, 0.9));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function readLicenceFileToDataUrl(file: File): Promise<string> {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) {
    throw new Error('Please upload a Trading Licence image (PNG, JPG, WebP) or PDF document.');
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
        const maxWidth = 1400;
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

interface AdminViewsProps {
  mode: 'notifications' | 'users' | 'settings' | 'audit-logs';
  user: SessionUser;
  googleConnected: boolean;
  onConnectGoogle: () => Promise<void>;
  onRefreshNotifications: () => void;
  onBrandingUpdated?: () => void;
}

export const AdminViews: React.FC<AdminViewsProps> = ({
  mode,
  user,
  googleConnected,
  onConnectGoogle,
  onRefreshNotifications,
  onBrandingUpdated,
}) => {
  const isOwner = user.role === 'owner';
  const isManager = user.role === 'manager';
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingLicence, setUploadingLicence] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Notifications
  const [notifications, setNotifications] = useState<
    Array<{ id: string; type: string; title: string; message: string; severity: string; read: boolean; createdAt: string }>
  >([]);

  // Users
  const [users, setUsers] = useState<
    Array<{ id: string; name: string; email: string; role: UserRole; employeeId?: string; active: boolean; lastLoginAt?: string }>
  >([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [showUserModal, setShowUserModal] = useState(false);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uRole, setURole] = useState<UserRole>('employee');
  const [uEmpId, setUEmpId] = useState('');
  const [uPass, setUPass] = useState('');

  // Audit logs
  const [logs, setLogs] = useState<
    Array<{ id: string; timestamp: string; userName: string; userRole: string; action: string; entityType: string; details: string }>
  >([]);
  const [migrations, setMigrations] = useState<
    Array<{ id: string; fileName: string; migratedAt: string; migratedBy: string; backupId: string; recordsImported: number; sheetsImported: string[] }>
  >([]);

  // Settings & Workspace
  const [settingsTab, setSettingsTab] = useState<'general' | 'workspace' | 'migration' | 'backups'>('general');
  const [settings, setSettings] = useState<SalonSettings | null>(null);
  const [appsScriptCode, setAppsScriptCode] = useState('');
  const [sheetPreview, setSheetPreview] = useState<{
    availableTabs: string[];
    activeTab: string;
    rows: string[][];
  } | null>(null);
  const [driveFiles, setDriveFiles] = useState<
    Array<{ id: string; name: string; modifiedTime: string; webViewLink?: string }>
  >([]);
  const [driveDocs, setDriveDocs] = useState<DriveDocumentRecord[]>([]);
  const [driveRootFolderId, setDriveRootFolderId] = useState('');
  const [docCategoryFilter, setDocCategoryFilter] = useState<'All' | DriveDocumentCategory>('All');
  const [uploadCategory, setUploadCategory] = useState<DriveDocumentCategory>('Expense Receipt');
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadDataUrl, setUploadDataUrl] = useState('');
  const [uploadRelatedEmpId, setUploadRelatedEmpId] = useState('');
  const [uploadNotes, setUploadNotes] = useState('');
  const [uploadingDriveDoc, setUploadingDriveDoc] = useState(false);
  const [loadingDrivePreviewId, setLoadingDrivePreviewId] = useState<string | null>(null);
  const [previewDriveDoc, setPreviewDriveDoc] = useState<{
    name: string;
    blobUrl: string;
    mimeType: string;
    webViewLink?: string;
  } | null>(null);
  const [backups, setBackups] = useState<
    Array<{ id: string; label: string; createdAt: string; createdBy: string; recordCount: number; driveFileId?: string }>
  >([]);

  // Confirm dialogs for Workspace mutations & restore/reset
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
    run: () => Promise<void>;
  } | null>(null);

  // Excel Migration Wizard state
  const [excelFileName, setExcelFileName] = useState('');
  const [parsedSheets, setParsedSheets] = useState<Record<string, Record<string, unknown>[]>>({});
  const [ownerApprovedMigration, setOwnerApprovedMigration] = useState(false);

  const load = async () => {
    setError('');
    try {
      if (mode === 'notifications') {
        const res = await apiFetch<{ notifications: typeof notifications }>('/api/notifications');
        setNotifications(res.notifications);
      } else if (mode === 'users') {
        const [uRes, eRes] = await Promise.all([
          apiFetch<{ users: typeof users }>('/api/users'),
          apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
        ]);
        setUsers(uRes.users);
        setEmployees(eRes.employees);
      } else if (mode === 'audit-logs') {
        const res = await apiFetch<{ logs: typeof logs; migrations: typeof migrations }>('/api/audit-logs');
        setLogs(res.logs);
        setMigrations(res.migrations);
      } else if (mode === 'settings') {
        const [sRes, gsRes, bkpRes, drvRes, empRes] = await Promise.all([
          apiFetch<{ settings: SalonSettings }>('/api/settings'),
          apiFetch<{ code: string }>('/api/workspace/apps-script'),
          apiFetch<{ backups: typeof backups }>('/api/backups'),
          apiFetch<{
            documents: DriveDocumentRecord[];
            googleDriveFolderId: string;
            driveFiles: typeof driveFiles;
          }>('/api/workspace/drive/documents'),
          apiFetch<{ employees: EmployeeRecord[] }>('/api/employees'),
        ]);
        setSettings(sRes.settings);
        setAppsScriptCode(gsRes.code);
        setBackups(bkpRes.backups);
        setDriveDocs(drvRes.documents);
        setDriveRootFolderId(drvRes.googleDriveFolderId || '');
        if (drvRes.driveFiles?.length) {
          setDriveFiles(drvRes.driveFiles);
        }
        setEmployees(empRes.employees);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load view data.');
    }
  };

  useEffect(() => {
    void load();
  }, [mode, googleConnected]);

  const handleDriveFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (file.size > 4.5 * 1024 * 1024) {
      setError('Selected file is too large (maximum 4.5 MB for Drive vault uploads).');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError('Could not read the selected file.');
    reader.onload = () => {
      setUploadDataUrl(String(reader.result));
      setUploadFileName(file.name);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadDocToDrive = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadDataUrl || !uploadFileName.trim()) {
      setError('Please choose a file to upload to Google Drive.');
      return;
    }
    setUploadingDriveDoc(true);
    setError('');
    setMsg('');
    try {
      const res = await apiFetch<{ document: DriveDocumentRecord; driveFolderId: string }>(
        '/api/workspace/drive/upload',
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: uploadFileName.trim(),
            dataUrl: uploadDataUrl,
            category: uploadCategory,
            relatedEmployeeId: uploadRelatedEmpId || undefined,
            notes: uploadNotes.trim() || undefined,
          }),
        }
      );
      setMsg(
        `Stored "${res.document.name}" in Google Drive (${res.document.folderName || res.document.category}).`
      );
      setUploadFileName('');
      setUploadDataUrl('');
      setUploadNotes('');
      setUploadRelatedEmpId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Drive upload failed.');
    } finally {
      setUploadingDriveDoc(false);
    }
  };

  const handlePreviewDriveDoc = async (doc: DriveDocumentRecord) => {
    setError('');
    setLoadingDrivePreviewId(doc.driveFileId);
    try {
      const fetched = await fetchDriveMediaBlobUrl(doc.driveFileId);
      setPreviewDriveDoc({
        name: doc.name,
        blobUrl: fetched.blobUrl,
        mimeType: fetched.mimeType || doc.mimeType,
        webViewLink: doc.webViewLink,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to preview Drive document.');
    } finally {
      setLoadingDrivePreviewId(null);
    }
  };

  const handleDownloadDriveDoc = async (doc: DriveDocumentRecord) => {
    setError('');
    setLoadingDrivePreviewId(doc.driveFileId);
    try {
      const fetched = await fetchDriveMediaBlobUrl(doc.driveFileId);
      const a = document.createElement('a');
      a.href = fetched.blobUrl;
      a.download = doc.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(fetched.blobUrl), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download Drive document.');
    } finally {
      setLoadingDrivePreviewId(null);
    }
  };

  const closeDrivePreviewModal = () => {
    if (previewDriveDoc?.blobUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewDriveDoc.blobUrl);
    }
    setPreviewDriveDoc(null);
  };

  const handleMarkRead = async (id: string) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    onRefreshNotifications();
    await load();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: uName,
          email: uEmail,
          role: uRole,
          employeeId: uRole === 'employee' ? uEmpId || undefined : undefined,
          password: uPass,
        }),
      });
      setShowUserModal(false);
      setUName('');
      setUEmail('');
      setUPass('');
      setMsg('User account created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    }
  };

  const handleToggleUser = (u: typeof users[number]) => {
    setError('');
    setMsg('');
    if (u.active) {
      setConfirmAction({
        title: `Disable Account for ${u.name}?`,
        description: isManager
          ? `Disabling ${u.email} (${u.role}) will immediately block their sign-in access. Only the Owner / Admin can re-enable or delete accounts.`
          : `Disabling ${u.email} (${u.role}) will immediately prevent them from signing in until re-enabled.`,
        confirmLabel: 'Disable Account',
        destructive: true,
        run: async () => {
          await apiFetch(`/api/users/${u.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ active: false }),
          });
          setMsg(`Disabled account ${u.email}.`);
          await load();
        },
      });
      return;
    }

    if (!isOwner) return;
    void (async () => {
      try {
        await apiFetch(`/api/users/${u.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: true }),
        });
        setMsg(`Re-enabled account ${u.email}.`);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update account.');
      }
    })();
  };

  const handleDeleteUser = (u: typeof users[number]) => {
    if (!isOwner) return;
    setError('');
    setMsg('');
    setConfirmAction({
      title: `Permanently Delete ${u.name}'s Account?`,
      description: `This permanently deletes the login account ${u.email} (${u.role}). Historical transactions and audit logs remain intact.`,
      confirmLabel: 'Delete Account',
      destructive: true,
      run: async () => {
        await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
        setMsg(`Deleted user account ${u.email}.`);
        await load();
      },
    });
  };

  const handleLogoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    setUploadingLogo(true);
    setError('');
    try {
      const dataUrl = await resizeSalonLogoToDataUrl(file);
      setSettings({ ...settings, salonLogoUrl: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process salon logo.');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleTradingLicencePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !settings) return;
    setUploadingLicence(true);
    setError('');
    try {
      const dataUrl = await readLicenceFileToDataUrl(file);
      setSettings({ ...settings, tradingLicenceUrl: dataUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process trading licence.');
    } finally {
      setUploadingLicence(false);
      e.target.value = '';
    }
  };

  const handlePreviewLicence = async () => {
    if (!settings) return;
    setError('');
    if (settings.tradingLicenceUrl) {
      setPreviewDriveDoc({
        name: `${settings.businessName} — Trading Licence${settings.tradingLicenceNumber ? ` (${settings.tradingLicenceNumber})` : ''}`,
        blobUrl: settings.tradingLicenceUrl,
        mimeType: settings.tradingLicenceUrl.startsWith('data:application/pdf')
          ? 'application/pdf'
          : 'image/jpeg',
        webViewLink: settings.tradingLicenceDriveLink,
      });
      return;
    }
    if (settings.tradingLicenceDriveFileId) {
      setLoadingDrivePreviewId(settings.tradingLicenceDriveFileId);
      try {
        const fetched = await fetchDriveMediaBlobUrl(settings.tradingLicenceDriveFileId);
        setPreviewDriveDoc({
          name: `${settings.businessName} — Trading Licence`,
          blobUrl: fetched.blobUrl,
          mimeType: fetched.mimeType,
          webViewLink: settings.tradingLicenceDriveLink,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load trading licence from Drive.');
      } finally {
        setLoadingDrivePreviewId(null);
      }
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setError('');
    setMsg('');
    setSavingSettings(true);
    try {
      const res = await apiFetch<{ settings: SalonSettings; driveWarning?: string }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      setSettings(res.settings);
      onBrandingUpdated?.();
      if (res.driveWarning) {
        setError(res.driveWarning);
      }
      setMsg(
        googleConnected && !res.driveWarning
          ? 'Salon settings, branding & trading licence saved (synced to Google Drive).'
          : 'Salon settings updated and recorded in audit log.'
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleExcelFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setMsg('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const extracted: Record<string, Record<string, unknown>[]> = {};
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        extracted[sheetName] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      }
      setExcelFileName(file.name);
      setParsedSheets(extracted);
      setOwnerApprovedMigration(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse Excel workbook.');
    }
  };

  const handleExecuteMigration = async () => {
    setError('');
    setMsg('');
    try {
      const res = await apiFetch<{
        backupId: string;
        importedCount: number;
        sheetsImported: string[];
      }>('/api/migration/import', {
        method: 'POST',
        body: JSON.stringify({
          fileName: excelFileName,
          sheets: parsedSheets,
          approvedByOwner: ownerApprovedMigration,
        }),
      });
      setMsg(
        `Migration complete! Imported ${res.importedCount} historical records across ${res.sheetsImported.length} worksheets. Pre-migration backup saved: ${res.backupId}.`
      );
      setParsedSheets({});
      setExcelFileName('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Migration failed.');
    }
  };

  return (
    <div className="space-y-6">
      {error && <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">{error}</div>}
      {msg && <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{msg}</div>}

      {/* NOTIFICATIONS */}
      {mode === 'notifications' && (
        <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-[#E83B84]" />
            <h2 className="text-lg font-bold">Notifications &amp; Reminders Center</h2>
          </div>
          {notifications.length === 0 ? (
            <p className="text-xs text-[#1D1717]/60 py-8 text-center">No notifications at this time.</p>
          ) : (
            <div className="divide-y divide-[#1D1717]/10">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`py-3.5 flex items-start justify-between gap-4 text-xs ${
                    n.read ? 'opacity-60' : ''
                  }`}
                >
                  <div>
                    <div className="font-bold text-[#1D1717]">{n.title}</div>
                    <div className="text-[#1D1717]/75 mt-0.5">{n.message}</div>
                    <div className="text-[11px] font-mono text-[#1D1717]/50 mt-1">
                      {new Date(n.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {!n.read && (
                    <button
                      onClick={() => void handleMarkRead(n.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] shrink-0 cursor-pointer"
                    >
                      <Check className="w-3 h-3" /> Mark Read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* USERS */}
      {mode === 'users' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[#E83B84]" /> System Users &amp; Role-Based Access
              </h2>
              <p className="text-xs text-[#1D1717]/60 mt-0.5">
                {isOwner
                  ? 'Owner / Admin can create, disable, re-enable, and permanently delete user accounts.'
                  : 'Manager Access: You can only disable active employee accounts. Creating, re-enabling, or deleting accounts requires Owner / Admin permissions.'}
              </p>
            </div>
            {isOwner && (
              <button
                onClick={() => setShowUserModal(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Add System User
              </button>
            )}
          </div>
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                  <th className="py-3 px-3">Name</th>
                  <th className="py-3 px-3">Email</th>
                  <th className="py-3 px-3">Role</th>
                  <th className="py-3 px-3">Last Login</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1D1717]/10">
                {users.map((u) => {
                  const isSelf = u.id === user.userId;
                  const canDisableAsManager = isManager && u.role === 'employee' && u.active;
                  return (
                    <tr key={u.id}>
                      <td className="py-3 px-3 font-semibold">{u.name}</td>
                      <td className="py-3 px-3 font-mono">{u.email}</td>
                      <td className="py-3 px-3 capitalize font-semibold text-[#E83B84]">
                        {u.role === 'owner' ? 'Owner / Admin' : u.role}
                      </td>
                      <td className="py-3 px-3 font-mono text-[#1D1717]/60">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                            u.active
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-stone-100 text-stone-600 border-stone-200'
                          }`}
                        >
                          {u.active ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {isSelf ? (
                          <span className="text-[11px] text-[#1D1717]/45 font-medium">Current Session</span>
                        ) : isOwner ? (
                          <div className="inline-flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleToggleUser(u)}
                              className={`px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${
                                u.active
                                  ? 'border-amber-200 text-amber-800 hover:bg-amber-50'
                                  : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                              }`}
                            >
                              {u.active ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(u)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold cursor-pointer"
                              title={`Delete ${u.email}`}
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        ) : canDisableAsManager ? (
                          <button
                            type="button"
                            onClick={() => handleToggleUser(u)}
                            className="px-2.5 py-1 rounded-lg border border-amber-200 text-amber-800 hover:bg-amber-50 text-xs font-semibold cursor-pointer"
                          >
                            Disable
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#1D1717]/45">Admin Only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {isOwner && showUserModal && (
            <div className="fixed inset-0 z-50 bg-[#1D1717]/45 flex items-center justify-center p-4">
              <form
                onSubmit={handleCreateUser}
                className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 p-6 space-y-3 text-xs"
              >
                <h3 className="text-base font-bold">Create Salon User Account</h3>
                <input
                  required
                  value={uName}
                  onChange={(e) => setUName(e.target.value)}
                  placeholder="Full Name *"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
                <input
                  type="email"
                  required
                  value={uEmail}
                  onChange={(e) => setUEmail(e.target.value)}
                  placeholder="Email (matches Google Sign-In email if used) *"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
                <select
                  value={uRole}
                  onChange={(e) => setURole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                >
                  <option value="owner">Owner / Admin</option>
                  <option value="manager">Manager</option>
                  <option value="employee">Employee (Self-Service Only)</option>
                </select>
                {uRole === 'employee' && (
                  <select
                    value={uEmpId}
                    onChange={(e) => setUEmpId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                  >
                    <option value="">Link to Employee Profile...</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.fullName}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="password"
                  required
                  minLength={6}
                  value={uPass}
                  onChange={(e) => setUPass(e.target.value)}
                  placeholder="Password (min 6 chars) *"
                  className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowUserModal(false)}
                    className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                  >
                    Create User
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* AUDIT LOGS */}
      {mode === 'audit-logs' && (
        <div className="space-y-6">
          <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-3">
            <h3 className="text-base font-bold">Immutable Audit Trail</h3>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#1D1717]/10 text-[#1D1717]/60">
                    <th className="py-2.5 px-3">Timestamp</th>
                    <th className="py-2.5 px-3">User (Role)</th>
                    <th className="py-2.5 px-3">Action</th>
                    <th className="py-2.5 px-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1D1717]/10">
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 px-3 font-mono whitespace-nowrap">
                        {new Date(l.timestamp).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {l.userName} ({l.userRole})
                      </td>
                      <td className="py-2 px-3 font-mono font-semibold text-[#E83B84]">{l.action}</td>
                      <td className="py-2 px-3 text-[#1D1717]/80">{l.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {migrations.length > 0 && (
            <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-3">
              <h3 className="text-base font-bold">Excel Historical Migration Logs</h3>
              {migrations.map((m) => (
                <div key={m.id} className="p-3 rounded-xl bg-[#F8EEEB] text-xs flex justify-between">
                  <div>
                    <strong>{m.fileName}</strong> &middot; {m.recordsImported} records imported ({m.sheetsImported.join(', ')})
                  </div>
                  <div className="font-mono text-[#1D1717]/65">Backup: {m.backupId}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SYSTEM SETTINGS, GOOGLE SHEETS / DRIVE SYNC & EXCEL MIGRATION */}
      {mode === 'settings' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2 p-1 bg-white border border-[#1D1717]/10 rounded-xl w-fit">
            {[
              { id: 'general', label: 'Salon Settings' },
              { id: 'workspace', label: 'Google Sheets & Drive Sync' },
              { id: 'migration', label: 'Import Excel Records' },
              { id: 'backups', label: 'Backups & Reset' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setSettingsTab(t.id as typeof settingsTab)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                  settingsTab === t.id ? 'bg-[#E83B84] text-white' : 'text-[#1D1717]/70'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {settingsTab === 'general' && settings && (
            <form
              onSubmit={handleSaveSettings}
              className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-6 text-xs max-w-4xl"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold">Trendy Unisex Salon Configuration</h3>
                  <p className="text-[#1D1717]/60 mt-0.5">
                    Manage official salon branding, logo, trading licence, tax rules, and customer loyalty configuration.
                  </p>
                </div>
                {googleConnected &&
                  ((settings.salonLogoUrl?.startsWith('data:') && !settings.salonLogoDriveFileId) ||
                    (settings.tradingLicenceUrl?.startsWith('data:') && !settings.tradingLicenceDriveFileId)) && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmAction({
                          title: 'Sync Salon Logo & Trading Licence to Google Drive?',
                          description:
                            'Uploads your saved salon logo and trading licence copy into organized folders inside Google Drive.',
                          confirmLabel: 'Sync to Google Drive',
                          run: async () => {
                            const res = await apiFetch<{
                              syncedCount: number;
                              errors: string[];
                              settings: SalonSettings;
                            }>('/api/workspace/drive/sync-branding', { method: 'POST' });
                            setSettings(res.settings);
                            if (res.errors.length > 0) {
                              setError(res.errors.join(' | '));
                            }
                            setMsg(`Synced ${res.syncedCount} file(s) to Google Drive.`);
                            await load();
                          },
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E83B84]/40 bg-[#F3BFD3]/30 hover:bg-[#F3BFD3]/50 font-semibold cursor-pointer"
                    >
                      <Cloud className="w-3.5 h-3.5 text-[#E83B84]" /> Sync Logo &amp; Licence to Drive
                    </button>
                  )}
              </div>

              {/* Salon Logo & Trading Licence Uploads */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Salon Logo Card */}
                <div className="p-4 rounded-2xl bg-[#F8EEEB]/80 border border-[#1D1717]/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1D1717] flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5 text-[#E83B84]" /> Salon Logo
                    </span>
                    {settings.salonLogoDriveFileId && (
                      <a
                        href={settings.salonLogoDriveLink || `https://drive.google.com/file/d/${settings.salonLogoDriveFileId}/view`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-[#E83B84]/30 text-[#E83B84] hover:underline"
                      >
                        <Cloud className="w-2.5 h-2.5" /> On Drive <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-4">
                    {settings.salonLogoUrl ? (
                      <img
                        src={settings.salonLogoUrl}
                        alt="Salon Logo Preview"
                        className="w-20 h-20 rounded-2xl object-contain bg-white border border-[#1D1717]/10 p-1.5 shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-2xl bg-[#E83B84] text-white flex items-center justify-center shrink-0">
                        <Scissors className="w-7 h-7" />
                      </div>
                    )}

                    <div className="flex-1 space-y-2 min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E83B84] hover:bg-[#d12f74] text-white font-semibold cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          {uploadingLogo ? 'Processing...' : settings.salonLogoUrl ? 'Change Logo' : 'Upload Logo'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => void handleLogoPicked(e)}
                            className="hidden"
                          />
                        </label>
                        {settings.salonLogoUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setSettings({
                                ...settings,
                                salonLogoUrl: '',
                                salonLogoDriveFileId: undefined,
                                salonLogoDriveLink: undefined,
                              })
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white border border-[#1D1717]/15 text-red-700 font-semibold cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" /> Remove
                          </button>
                        )}
                      </div>
                      <input
                        value={settings.salonLogoUrl?.startsWith('data:') ? '' : settings.salonLogoUrl || ''}
                        onChange={(e) => setSettings({ ...settings, salonLogoUrl: e.target.value })}
                        placeholder="Or paste logo image URL (https://...)"
                        className="w-full px-3 py-1.5 rounded-xl border border-[#1D1717]/15 bg-white"
                      />
                      <p className="text-[11px] text-[#1D1717]/55">
                        Displays on sidebar &amp; sign-in screen. {googleConnected ? 'Auto-syncs to Google Drive on save.' : ''}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Trading Licence Card */}
                <div className="p-4 rounded-2xl bg-[#F8EEEB]/80 border border-[#1D1717]/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1D1717] flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#E83B84]" /> Trading Licence
                    </span>
                    {settings.tradingLicenceDriveFileId && (
                      <a
                        href={
                          settings.tradingLicenceDriveLink ||
                          `https://drive.google.com/file/d/${settings.tradingLicenceDriveFileId}/view`
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-white border border-[#E83B84]/30 text-[#E83B84] hover:underline"
                      >
                        <Cloud className="w-2.5 h-2.5" /> On Drive <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-semibold mb-1 text-[11px]">Licence Number</label>
                      <input
                        value={settings.tradingLicenceNumber || ''}
                        onChange={(e) =>
                          setSettings({ ...settings, tradingLicenceNumber: e.target.value.toUpperCase() })
                        }
                        placeholder="e.g. BUS/TL/2026/104"
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[#1D1717]/15 bg-white font-mono uppercase"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold mb-1 text-[11px]">Expiry Date</label>
                      <input
                        type="date"
                        value={settings.tradingLicenceExpiry || ''}
                        onChange={(e) => setSettings({ ...settings, tradingLicenceExpiry: e.target.value })}
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[#1D1717]/15 bg-white font-mono"
                      />
                    </div>
                  </div>

                  {(settings.tradingLicenceUrl || settings.tradingLicenceDriveFileId) && (
                    <div className="bg-white rounded-xl border border-[#1D1717]/10 p-2 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void handlePreviewLicence()}
                        className="flex items-center gap-2.5 min-w-0 text-left cursor-pointer group"
                      >
                        {settings.tradingLicenceUrl ? (
                          settings.tradingLicenceUrl.startsWith('data:application/pdf') ? (
                            <div className="w-12 h-12 rounded-lg bg-[#F8EEEB] flex items-center justify-center text-[#E83B84] shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                          ) : (
                            <img
                              src={settings.tradingLicenceUrl}
                              alt="Trading Licence Thumbnail"
                              className="w-16 h-12 rounded-lg object-cover border border-[#1D1717]/10 shrink-0"
                            />
                          )
                        ) : (
                          <div className="w-12 h-12 rounded-lg bg-[#F8EEEB] flex items-center justify-center text-[#E83B84] shrink-0">
                            <Cloud className="w-5 h-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold text-[#1D1717] group-hover:text-[#E83B84] truncate">
                            {settings.tradingLicenceUrl?.startsWith('data:application/pdf')
                              ? 'Trading Licence (PDF)'
                              : 'Trading Licence Attached'}
                          </div>
                          <div className="text-[11px] text-[#E83B84] inline-flex items-center gap-1">
                            <Eye className="w-3 h-3" /> Preview Full Size
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setSettings({
                            ...settings,
                            tradingLicenceUrl: '',
                            tradingLicenceDriveFileId: undefined,
                            tradingLicenceDriveLink: undefined,
                          })
                        }
                        className="text-[11px] font-semibold text-red-700 hover:underline px-2 py-1 shrink-0 cursor-pointer"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1D1717] hover:bg-[#1D1717]/85 text-white font-semibold cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      {uploadingLicence
                        ? 'Processing...'
                        : settings.tradingLicenceUrl || settings.tradingLicenceDriveFileId
                          ? 'Replace Trading Licence'
                          : 'Upload Trading Licence'}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,application/pdf"
                        onChange={(e) => void handleTradingLicencePicked(e)}
                        className="hidden"
                      />
                    </label>
                    <span className="text-[11px] text-[#1D1717]/55">PNG, JPG, WebP, or PDF</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold mb-1">Business Name</label>
                  <input
                    value={settings.businessName}
                    onChange={(e) => setSettings({ ...settings, businessName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Tagline</label>
                  <input
                    value={settings.tagline}
                    onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold mb-1">Location Address</label>
                  <input
                    value={settings.location}
                    onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Phone</label>
                  <input
                    value={settings.phone}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Operating Hours</label>
                  <input
                    value={settings.operatingHours}
                    onChange={(e) => setSettings({ ...settings, operatingHours: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Loyalty Points per UGX 10,000</label>
                  <input
                    type="number"
                    value={settings.loyaltyPointsPer10k}
                    onChange={(e) =>
                      setSettings({ ...settings, loyaltyPointsPer10k: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold mb-1">Tax Rate (%) — Enable below if applicable</label>
                  <input
                    type="number"
                    value={settings.taxRate}
                    onChange={(e) => setSettings({ ...settings, taxRate: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-[#1D1717]/10">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.taxEnabled}
                    onChange={(e) => setSettings({ ...settings, taxEnabled: e.target.checked })}
                  />
                  <span>Enable tax calculation on POS receipts</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.allowNegativeStockWithApproval}
                    onChange={(e) =>
                      setSettings({ ...settings, allowNegativeStockWithApproval: e.target.checked })
                    }
                  />
                  <span>Allow negative stock override with Owner/Manager approval</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.whatsappProviderConfigured}
                    onChange={(e) =>
                      setSettings({ ...settings, whatsappProviderConfigured: e.target.checked })
                    }
                  />
                  <span>External WhatsApp Reminder Provider Connected</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.smsProviderConfigured}
                    onChange={(e) =>
                      setSettings({ ...settings, smsProviderConfigured: e.target.checked })
                    }
                  />
                  <span>External SMS Reminder Provider Connected</span>
                </label>
              </div>

              <button
                type="submit"
                disabled={savingSettings}
                className="px-5 py-2.5 rounded-xl bg-[#E83B84] hover:bg-[#d12f74] text-white font-semibold cursor-pointer disabled:opacity-60"
              >
                {savingSettings ? 'Saving Settings...' : 'Save Salon Settings'}
              </button>
            </form>
          )}

          {settingsTab === 'workspace' && settings && (
            <div className="space-y-6">
              <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-base font-bold flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-[#E83B84]" /> Google Sheets &amp; Google Drive Integration
                    </h3>
                    <p className="text-xs text-[#1D1717]/65 mt-0.5">
                      {googleConnected
                        ? 'Google Workspace connected. You can create, sync, inspect Sheets tabs, and upload backups to Google Drive.'
                        : 'Authorize Google Workspace to create and synchronize your live salon Google Sheet and Drive backups.'}
                    </p>
                  </div>
                  {!googleConnected && (
                    <button
                      onClick={() => void onConnectGoogle()}
                      className="px-4 py-2 rounded-xl bg-[#E83B84] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Connect Google Workspace
                    </button>
                  )}
                </div>

                {settings.googleSpreadsheetId && (
                  <div className="p-3.5 rounded-xl bg-[#F8EEEB] text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <strong>Linked Spreadsheet ID:</strong>{' '}
                      <span className="font-mono">{settings.googleSpreadsheetId}</span>
                      {settings.lastSheetsSyncAt && (
                        <span className="text-[#1D1717]/60 ml-2">
                          &middot; Last synced {new Date(settings.lastSheetsSyncAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2.5 text-xs">
                  <button
                    disabled={!googleConnected}
                    onClick={() =>
                      setConfirmAction({
                        title: 'Create New Salon Google Spreadsheet?',
                        description:
                          'This will create a new Google Sheet in your Google Drive with 18 structured Trendy Unisex Salon worksheets and populate your current salon records.',
                        confirmLabel: 'Create & Populate Sheet',
                        run: async () => {
                          const res = await apiFetch<{ spreadsheetId: string; sheetCount: number }>(
                            '/api/workspace/sheets/create',
                            { method: 'POST' }
                          );
                          setMsg(`Created Google Spreadsheet (${res.spreadsheetId}) with ${res.sheetCount} tabs.`);
                          await load();
                        },
                      })
                    }
                    className="px-4 py-2 rounded-xl bg-[#E83B84] text-white font-semibold disabled:opacity-45 cursor-pointer"
                  >
                    Create Salon Google Sheet
                  </button>

                  <button
                    disabled={!googleConnected || !settings.googleSpreadsheetId}
                    onClick={() =>
                      setConfirmAction({
                        title: 'Overwrite Google Sheet Tabs with Current Salon Records?',
                        description: `This will update all 18 worksheet tabs in Spreadsheet ${settings.googleSpreadsheetId} with the current salon database.`,
                        confirmLabel: 'Sync to Google Sheets',
                        run: async () => {
                          const res = await apiFetch<{ updatedCells: number; sheetTabs: string[] }>(
                            '/api/workspace/sheets/sync',
                            { method: 'POST', body: JSON.stringify({}) }
                          );
                          setMsg(`Synced ${res.updatedCells} cells across ${res.sheetTabs.length} tabs.`);
                          await load();
                        },
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#1D1717]/15 bg-white font-semibold disabled:opacity-45 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Sync All Tabs Now
                  </button>

                  <button
                    disabled={!googleConnected || !settings.googleSpreadsheetId}
                    onClick={async () => {
                      try {
                        const res = await apiFetch<NonNullable<typeof sheetPreview>>('/api/workspace/sheets/read');
                        setSheetPreview(res);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Read failed.');
                      }
                    }}
                    className="px-4 py-2 rounded-xl border border-[#1D1717]/15 bg-white font-semibold disabled:opacity-45 cursor-pointer"
                  >
                    Inspect Live Sheet Tab
                  </button>

                  <button
                    disabled={!googleConnected}
                    onClick={() =>
                      setConfirmAction({
                        title: 'Upload Full Database Backup to Google Drive?',
                        description:
                          'Uploads a complete JSON snapshot of Trendy Unisex Salon records into your Google Drive.',
                        confirmLabel: 'Upload Backup',
                        run: async () => {
                          const res = await apiFetch<{ file: { name: string } }>('/api/workspace/drive/backup', {
                            method: 'POST',
                            body: JSON.stringify({ label: 'Trendy Salon Drive Backup' }),
                          });
                          setMsg(`Uploaded ${res.file.name} to Google Drive.`);
                          const list = await apiFetch<{ files: typeof driveFiles }>('/api/workspace/drive/files');
                          setDriveFiles(list.files);
                          await load();
                        },
                      })
                    }
                    className="px-4 py-2 rounded-xl bg-[#1D1717] text-white font-semibold disabled:opacity-45 cursor-pointer"
                  >
                    Backup to Google Drive
                  </button>
                </div>

                {sheetPreview && (
                  <div className="pt-4 border-t border-[#1D1717]/10 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <strong>Live Google Sheet Preview: {sheetPreview.activeTab}</strong>
                      <select
                        value={sheetPreview.activeTab}
                        onChange={async (e) => {
                          const res = await apiFetch<NonNullable<typeof sheetPreview>>(
                            `/api/workspace/sheets/read?tab=${encodeURIComponent(e.target.value)}`
                          );
                          setSheetPreview(res);
                        }}
                        className="px-2.5 py-1 rounded-lg border border-[#1D1717]/15 bg-white"
                      >
                        {sheetPreview.availableTabs.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="overflow-x-auto max-h-56 border border-[#1D1717]/10 rounded-xl">
                      <table className="w-full text-left border-collapse">
                        <tbody>
                          {sheetPreview.rows.slice(0, 20).map((row, i) => (
                            <tr key={i} className={i === 0 ? 'bg-[#F8EEEB] font-bold' : 'border-t border-[#1D1717]/10'}>
                              {row.map((cell, j) => (
                                <td key={j} className="py-1.5 px-2.5 whitespace-nowrap">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {driveFiles.length > 0 && (
                  <div className="pt-4 border-t border-[#1D1717]/10 text-xs space-y-1.5">
                    <div className="font-bold">Google Drive Backup Files</div>
                    {driveFiles.slice(0, 8).map((f) => (
                      <div key={f.id} className="flex justify-between py-1">
                        <span className="font-mono truncate">{f.name}</span>
                        <span className="text-[#1D1717]/60 shrink-0 ml-2">
                          {new Date(f.modifiedTime).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Google Drive Documents & Images Vault */}
              <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-[#E83B84]" /> Google Drive Documents &amp; Images Vault
                    </h3>
                    <p className="text-xs text-[#1D1717]/65 mt-0.5">
                      Store staff profile photos, National IDs, expense receipts, contracts, supplier invoices, and salon lookbook photos in organized Google Drive folders.
                    </p>
                    {driveRootFolderId && (
                      <a
                        href={`https://drive.google.com/drive/folders/${driveRootFolderId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#E83B84] hover:underline mt-1"
                      >
                        Open Salon Drive Folder <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!googleConnected}
                    onClick={() =>
                      setConfirmAction({
                        title: 'Sync All Staff Photos & National IDs to Google Drive?',
                        description:
                          'Uploads any staff profile photos and National ID front/back scans that are not yet stored on Google Drive into organized subfolders.',
                        confirmLabel: 'Sync Staff Media',
                        run: async () => {
                          const res = await apiFetch<{
                            syncedCount: number;
                            skippedCount: number;
                            errors: string[];
                          }>('/api/workspace/drive/sync-employee-media', { method: 'POST' });
                          if (res.errors.length > 0) {
                            setError(`Some uploads failed: ${res.errors.join(' | ')}`);
                          }
                          setMsg(
                            res.syncedCount > 0
                              ? `Synced ${res.syncedCount} staff photo/ID file(s) to Google Drive.`
                              : `All staff photos and National IDs are already synced (${res.skippedCount} files).`
                          );
                          await load();
                        },
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#E83B84]/40 bg-[#F3BFD3]/30 hover:bg-[#F3BFD3]/50 text-[#1D1717] text-xs font-semibold disabled:opacity-45 cursor-pointer shrink-0"
                  >
                    <Cloud className="w-3.5 h-3.5 text-[#E83B84]" /> Sync Staff Photos &amp; IDs
                  </button>
                </div>

                {/* Upload Document or Image Form */}
                <form
                  onSubmit={handleUploadDocToDrive}
                  className="bg-[#F8EEEB]/80 border border-[#1D1717]/10 rounded-2xl p-4 space-y-3 text-xs"
                >
                  <div className="font-bold text-[#1D1717]">Upload New Document or Image to Google Drive</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <label className="block font-semibold mb-1">Choose File *</label>
                      <label className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white hover:bg-[#F3BFD3]/20 cursor-pointer font-semibold truncate">
                        <Upload className="w-3.5 h-3.5 text-[#E83B84] shrink-0" />
                        <span className="truncate">
                          {uploadFileName ? uploadFileName : 'Select image / PDF / doc'}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                          onChange={handleDriveFilePicked}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Drive Folder Category *</label>
                      <select
                        value={uploadCategory}
                        onChange={(e) => setUploadCategory(e.target.value as DriveDocumentCategory)}
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                      >
                        <option value="Expense Receipt">Expense Receipt</option>
                        <option value="Trading Licence">Trading Licence</option>
                        <option value="Supplier Invoice">Supplier Invoice</option>
                        <option value="Staff Contract">Staff Contract</option>
                        <option value="National ID">National ID</option>
                        <option value="Employee Photo">Employee Photo</option>
                        <option value="Salon Media">Salon Media / Logo</option>
                        <option value="Other">Other Document</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Related Staff (Optional)</label>
                      <select
                        value={uploadRelatedEmpId}
                        onChange={(e) => setUploadRelatedEmpId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                      >
                        <option value="">General Salon File</option>
                        {employees.map((emp) => (
                          <option key={emp.id} value={emp.id}>
                            {emp.fullName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold mb-1">Document Name *</label>
                      <input
                        value={uploadFileName}
                        onChange={(e) => setUploadFileName(e.target.value)}
                        placeholder="e.g. UMEME_Receipt_May.pdf"
                        className="w-full px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                    <input
                      value={uploadNotes}
                      onChange={(e) => setUploadNotes(e.target.value)}
                      placeholder="Optional description or receipt reference..."
                      className="flex-1 px-3 py-2 rounded-xl border border-[#1D1717]/15 bg-white"
                    />
                    <button
                      type="submit"
                      disabled={!googleConnected || !uploadDataUrl || uploadingDriveDoc}
                      className="px-4 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12f74] text-white font-semibold disabled:opacity-45 cursor-pointer whitespace-nowrap"
                    >
                      {uploadingDriveDoc ? 'Uploading to Drive...' : 'Upload to Google Drive'}
                    </button>
                  </div>
                </form>

                {/* Category Filter */}
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(
                    [
                      'All',
                      'Trading Licence',
                      'Employee Photo',
                      'National ID',
                      'Expense Receipt',
                      'Staff Contract',
                      'Salon Media',
                      'Supplier Invoice',
                      'Backup',
                      'Other',
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setDocCategoryFilter(cat)}
                      className={`px-3 py-1 rounded-xl font-semibold cursor-pointer ${
                        docCategoryFilter === cat
                          ? 'bg-[#1D1717] text-white'
                          : 'bg-[#F8EEEB] text-[#1D1717]/75 hover:bg-[#F3BFD3]/50'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Documents List */}
                <div className="divide-y divide-[#1D1717]/10 text-xs">
                  {driveDocs
                    .filter((d) => docCategoryFilter === 'All' || d.category === docCategoryFilter)
                    .map((doc) => {
                      const isImage = doc.mimeType.startsWith('image/');
                      const isPdf = doc.mimeType === 'application/pdf';
                      return (
                        <div
                          key={doc.id}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-xl bg-[#F3BFD3]/40 flex items-center justify-center shrink-0 text-[#E83B84]">
                              {isImage ? <ImageIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold text-[#1D1717] truncate">{doc.name}</div>
                              <div className="text-[11px] text-[#1D1717]/65 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                <span className="px-1.5 py-0.5 rounded bg-[#F8EEEB] font-semibold text-[#E83B84]">
                                  {doc.category}
                                </span>
                                {doc.relatedEmployeeName && <span>Staff: {doc.relatedEmployeeName}</span>}
                                {doc.sizeBytes && (
                                  <span className="font-mono">{Math.round(doc.sizeBytes / 1024)} KB</span>
                                )}
                                <span>
                                  Uploaded by {doc.uploadedBy} &middot;{' '}
                                  {new Date(doc.uploadedAt).toLocaleString()}
                                </span>
                              </div>
                              {doc.notes && <div className="text-[11px] text-[#1D1717]/55 mt-0.5">{doc.notes}</div>}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {(isImage || isPdf) && (
                              <button
                                type="button"
                                disabled={!googleConnected || loadingDrivePreviewId === doc.driveFileId}
                                onClick={() => void handlePreviewDriveDoc(doc)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] font-semibold disabled:opacity-45 cursor-pointer"
                              >
                                <Eye className="w-3 h-3 text-[#E83B84]" />
                                {loadingDrivePreviewId === doc.driveFileId ? 'Loading...' : 'Preview'}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={!googleConnected || loadingDrivePreviewId === doc.driveFileId}
                              onClick={() => void handleDownloadDriveDoc(doc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] font-semibold disabled:opacity-45 cursor-pointer"
                            >
                              <Download className="w-3 h-3" /> Download
                            </button>
                            {doc.webViewLink && (
                              <a
                                href={doc.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] font-semibold"
                              >
                                Drive <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            <button
                              type="button"
                              disabled={!googleConnected}
                              onClick={() =>
                                setConfirmAction({
                                  title: `Delete "${doc.name}" from Google Drive?`,
                                  description:
                                    'This permanently removes the file from your Google Drive and unlinks it from Trendy Unisex Salon records.',
                                  confirmLabel: 'Delete from Drive',
                                  destructive: true,
                                  run: async () => {
                                    await apiFetch(
                                      `/api/workspace/drive/files/${encodeURIComponent(doc.driveFileId)}`,
                                      { method: 'DELETE' }
                                    );
                                    setMsg(`Deleted "${doc.name}" from Google Drive.`);
                                    await load();
                                  },
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 font-semibold disabled:opacity-45 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" /> Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}

                  {driveDocs.filter((d) => docCategoryFilter === 'All' || d.category === docCategoryFilter)
                    .length === 0 && (
                    <p className="py-8 text-center text-[#1D1717]/55">
                      No documents or images stored in this Drive category yet. Upload files above or sync employee photos &amp; IDs.
                    </p>
                  )}
                </div>
              </div>

              {/* Google Apps Script Code.gs Export */}
              <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold">Google Apps Script Backend (Code.gs)</h3>
                    <p className="text-xs text-[#1D1717]/60">
                      Deploy directly in script.google.com bound to your Trendy Unisex Salon Spreadsheet.
                    </p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(appsScriptCode);
                        setMsg('Copied Code.gs to clipboard.');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] font-semibold cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </button>
                    <button
                      onClick={() => {
                        const blob = new Blob([appsScriptCode], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'Code.gs';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1D1717] text-white font-semibold cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" /> Download Code.gs
                    </button>
                  </div>
                </div>
                <pre className="p-4 rounded-xl bg-[#1D1717] text-[#F8EEEB] text-[11px] font-mono overflow-x-auto max-h-64">
                  {appsScriptCode}
                </pre>
              </div>
            </div>
          )}

          {settingsTab === 'migration' && (
            <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#E83B84]" /> Historical Excel Workbook Inspection &amp; Migration
                </h3>
                <p className="text-xs text-[#1D1717]/65 mt-1">
                  Import <span className="font-mono">Trendy_Unisex_Salon_Records.xlsx</span> safely. Existing historical sales, commissions, expenses, and stock records are preserved with{' '}
                  <span className="font-mono">isHistorical=true</span> and never recalculated under new commission or lunch deduction policies.
                </p>
              </div>

              <label className="flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-[#E83B84]/40 bg-[#F8EEEB]/60 hover:bg-[#F3BFD3]/20 cursor-pointer text-xs">
                <Upload className="w-6 h-6 text-[#E83B84] mb-2" />
                <span className="font-semibold text-[#1D1717]">
                  {excelFileName ? `Selected: ${excelFileName}` : 'Choose Trendy_Unisex_Salon_Records.xlsx'}
                </span>
                <span className="text-[#1D1717]/55 mt-1">Supports .xlsx and .xls workbooks</span>
                <input type="file" accept=".xlsx,.xls" onChange={handleExcelFileSelected} className="hidden" />
              </label>

              {Object.keys(parsedSheets).length > 0 && (
                <div className="space-y-4 text-xs">
                  <div className="p-4 rounded-xl bg-[#F8EEEB] space-y-2">
                    <div className="font-bold text-sm">Step 1–3: Workbook Structure &amp; Migration Plan</div>
                    {Object.entries(parsedSheets).map(([name, rows]) => (
                      <div key={name} className="flex justify-between py-1 border-b border-[#1D1717]/10">
                        <span className="font-semibold">{name}</span>
                        <span className="font-mono">
                          {rows.length} rows &middot; Columns: {Object.keys(rows[0] || {}).slice(0, 5).join(', ') || 'Empty'}
                        </span>
                      </div>
                    ))}
                  </div>

                  <label className="flex items-start gap-2.5 p-3.5 rounded-xl border border-[#E83B84]/35 bg-[#F3BFD3]/20 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ownerApprovedMigration}
                      onChange={(e) => setOwnerApprovedMigration(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      <strong>Owner Approval:</strong> I confirm this migration plan. Create an automatic pre-migration backup snapshot first, preserve all imported historical financial values unchanged, and apply new commission/lunch rules only to transactions from the effective date forward.
                    </span>
                  </label>

                  <button
                    disabled={!ownerApprovedMigration}
                    onClick={() => void handleExecuteMigration()}
                    className="px-5 py-2.5 rounded-xl bg-[#E83B84] text-white font-semibold disabled:opacity-45 cursor-pointer"
                  >
                    Create Backup &amp; Import Historical Records
                  </button>
                </div>
              )}
            </div>
          )}

          {settingsTab === 'backups' && (
            <div className="bg-white border border-[#1D1717]/10 rounded-2xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#E83B84]" /> Local Snapshots &amp; Recovery
                  </h3>
                  <p className="text-xs text-[#1D1717]/60">
                    Create instant restore points or reset sample transactions for clean production go-live.
                  </p>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    onClick={async () => {
                      await apiFetch('/api/backups', {
                        method: 'POST',
                        body: JSON.stringify({ label: 'Manual Local Snapshot' }),
                      });
                      setMsg('Local backup snapshot created.');
                      await load();
                    }}
                    className="px-3.5 py-2 rounded-xl bg-[#E83B84] text-white font-semibold cursor-pointer"
                  >
                    Create Snapshot Now
                  </button>
                  <button
                    onClick={() =>
                      setConfirmAction({
                        title: 'Reset Transactions to Clean Production State?',
                        description:
                          'Creates an automatic backup first, then clears sample/test transactions, appointments, and expenses while preserving staff accounts, service catalog, and salon settings.',
                        confirmLabel: 'Reset Clean Slate',
                        destructive: true,
                        run: async () => {
                          await apiFetch('/api/system/reset-clean', { method: 'POST' });
                          setMsg('Database reset to clean production state (pre-reset backup saved).');
                          await load();
                        },
                      })
                    }
                    className="px-3.5 py-2 rounded-xl border border-red-200 text-red-700 font-semibold hover:bg-red-50 cursor-pointer"
                  >
                    Reset to Clean Production Slate
                  </button>
                </div>
              </div>

              <div className="divide-y divide-[#1D1717]/10 text-xs">
                {backups.length === 0 ? (
                  <p className="text-[#1D1717]/60 py-6">No backup snapshots created yet.</p>
                ) : (
                  backups.map((b) => (
                    <div key={b.id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <div className="font-semibold">{b.label}</div>
                        <div className="text-[#1D1717]/55 font-mono">
                          {b.id} &middot; {new Date(b.createdAt).toLocaleString()} &middot; {b.recordCount} records
                        </div>
                      </div>
                      <button
                        onClick={() =>
                          setConfirmAction({
                            title: `Restore Backup ${b.id}?`,
                            description: `Restores all salon records to snapshot "${b.label}". A pre-restore backup of current data will be saved automatically.`,
                            confirmLabel: 'Restore Snapshot',
                            destructive: true,
                            run: async () => {
                              await apiFetch(`/api/backups/${b.id}/restore`, { method: 'POST' });
                              setMsg(`Restored snapshot ${b.id}.`);
                              await load();
                            },
                          })
                        }
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#1D1717]/15 hover:bg-[#F8EEEB] font-semibold cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" /> Restore
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmAction)}
        title={confirmAction?.title || ''}
        description={confirmAction?.description || ''}
        confirmLabel={confirmAction?.confirmLabel}
        destructive={confirmAction?.destructive}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          const act = confirmAction;
          setConfirmAction(null);
          if (act) {
            try {
              await act.run();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Action failed.');
            }
          }
        }}
      />

      {previewDriveDoc && (
        <div className="fixed inset-0 z-[60] bg-[#1D1717]/75 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl border border-[#1D1717]/20 overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#1D1717] text-white">
              <h4 className="text-sm font-bold truncate pr-3">{previewDriveDoc.name}</h4>
              <div className="flex items-center gap-2 shrink-0">
                {previewDriveDoc.webViewLink && (
                  <a
                    href={previewDriveDoc.webViewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-semibold px-3 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white"
                  >
                    Open in Drive <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <a
                  href={previewDriveDoc.blobUrl}
                  download={previewDriveDoc.name}
                  className="text-xs font-semibold px-3 py-1 rounded-lg bg-[#E83B84] text-white"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={closeDrivePreviewModal}
                  className="p-1 rounded-lg hover:bg-white/10 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 bg-[#F8EEEB] flex items-center justify-center max-h-[80vh] overflow-auto">
              {previewDriveDoc.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewDriveDoc.blobUrl}
                  title={previewDriveDoc.name}
                  className="w-full h-[70vh] rounded-xl border border-[#1D1717]/15 bg-white"
                />
              ) : (
                <img
                  src={previewDriveDoc.blobUrl}
                  alt={previewDriveDoc.name}
                  className="max-w-full max-h-[72vh] rounded-xl object-contain border border-[#1D1717]/15 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
