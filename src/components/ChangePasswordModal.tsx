import React, { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  userEmail?: string;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  open,
  onClose,
  userEmail,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!open) return null;

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccessMsg('');
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (currentPassword === newPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; message?: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setSuccessMsg(res.message || 'Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#1D1717]/55 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Change account password"
    >
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#1D1717]/15 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1D1717]/10 bg-[#F8EEEB]/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#1D1717] text-[#F3BFD3] flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#1D1717]">Change Password</h3>
              {userEmail && <p className="text-[11px] text-[#1D1717]/60">{userEmail}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-[#1D1717]/10 text-[#1D1717]/70 cursor-pointer"
            aria-label="Close change password modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div>
            <label className="block font-semibold text-[#1D1717] mb-1">Current Password *</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full px-3 py-2.5 pr-9 rounded-xl border border-[#1D1717]/15 focus:outline-none focus:border-[#E83B84]"
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#1D1717]/45 hover:text-[#1D1717] cursor-pointer"
                aria-label="Toggle current password visibility"
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#1D1717] mb-1">
              New Password * <span className="font-normal text-[#1D1717]/55">(min 6 chars)</span>
            </label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full px-3 py-2.5 pr-9 rounded-xl border border-[#1D1717]/15 focus:outline-none focus:border-[#E83B84]"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#1D1717]/45 hover:text-[#1D1717] cursor-pointer"
                aria-label="Toggle new password visibility"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-[#1D1717] mb-1">Confirm New Password *</label>
            <input
              type={showNew ? 'text' : 'password'}
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              className="w-full px-3 py-2.5 rounded-xl border border-[#1D1717]/15 focus:outline-none focus:border-[#E83B84]"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[#1D1717]/10">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl border border-[#1D1717]/15 font-semibold text-[#1D1717] hover:bg-[#F8EEEB] cursor-pointer"
            >
              {successMsg ? 'Done' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-[#E83B84] hover:bg-[#d12f74] text-white font-semibold cursor-pointer disabled:opacity-60"
            >
              {saving ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
