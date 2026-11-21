import React from 'react';
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import { evaluatePasswordStrength } from '../lib/passwordPolicy';

interface PasswordStrengthMeterProps {
  password: string;
  confirmPassword?: string;
}

const STRENGTH_COLORS: Record<0 | 1 | 2 | 3 | 4, { bar: string; badge: string }> = {
  0: {
    bar: 'bg-[#1D1717]/15',
    badge: 'bg-[#F8EEEB] text-[#1D1717]/55 border-[#1D1717]/10',
  },
  1: {
    bar: 'bg-red-500',
    badge: 'bg-red-50 text-red-700 border-red-200',
  },
  2: {
    bar: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  3: {
    bar: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  4: {
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
};

export const PasswordStrengthMeter: React.FC<PasswordStrengthMeterProps> = ({
  password,
  confirmPassword,
}) => {
  const result = evaluatePasswordStrength(password);
  const style = STRENGTH_COLORS[result.strengthLevel];

  const criteria = [
    { key: 'minLength', label: 'At least 8 characters', met: result.checks.minLength },
    { key: 'uppercase', label: 'Uppercase letter (A–Z)', met: result.checks.uppercase },
    { key: 'lowercase', label: 'Lowercase letter (a–z)', met: result.checks.lowercase },
    { key: 'number', label: 'Number (0–9)', met: result.checks.number },
    { key: 'special', label: 'Special character (!@#$...)', met: result.checks.special },
  ];

  const showConfirmCheck = confirmPassword !== undefined && confirmPassword.length > 0;
  const passwordsMatch = showConfirmCheck && password === confirmPassword;

  return (
    <div className="rounded-xl border border-[#1D1717]/10 bg-[#F8EEEB]/75 p-3 space-y-2.5 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#1D1717]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#E83B84]" />
          Password Strength
        </span>
        <span className={`px-2 py-0.5 rounded-md border font-semibold ${style.badge}`}>
          {result.strengthLevel === 0 ? 'Not entered' : result.strengthLabel}
        </span>
      </div>

      {/* 4-segment progress bar */}
      <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={`h-1.5 rounded-full transition-colors duration-200 ${
              result.strengthLevel >= segment ? style.bar : 'bg-[#1D1717]/10'
            }`}
          />
        ))}
      </div>

      {/* Validation checklist */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 pt-0.5">
        {criteria.map((item) => (
          <div
            key={item.key}
            className={`flex items-center gap-1.5 ${
              item.met ? 'text-emerald-700 font-medium' : 'text-[#1D1717]/60'
            }`}
          >
            {item.met ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-[#1D1717]/30 shrink-0" />
            )}
            <span>{item.label}</span>
          </div>
        ))}
        {showConfirmCheck && (
          <div
            className={`flex items-center gap-1.5 ${
              passwordsMatch ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'
            }`}
          >
            {passwordsMatch ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            )}
            <span>{passwordsMatch ? 'Passwords match' : 'Passwords do not match'}</span>
          </div>
        )}
      </div>
    </div>
  );
};
