export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export type PasswordStrengthLabel = 'Empty' | 'Weak' | 'Fair' | 'Good' | 'Strong';

export interface PasswordValidationResult {
  isValid: boolean;
  errorMessage: string | null;
  passedCount: number;
  strengthLevel: 0 | 1 | 2 | 3 | 4;
  strengthLabel: PasswordStrengthLabel;
  checks: {
    minLength: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
    maxLength: boolean;
  };
}

export function evaluatePasswordStrength(password: string): PasswordValidationResult {
  const checks = {
    minLength: password.length >= MIN_PASSWORD_LENGTH,
    maxLength: password.length <= MAX_PASSWORD_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9\s]/.test(password),
  };

  const ruleFlags = [
    checks.minLength,
    checks.uppercase,
    checks.lowercase,
    checks.number,
    checks.special,
  ];
  const passedCount = ruleFlags.filter(Boolean).length;

  let strengthLevel: 0 | 1 | 2 | 3 | 4 = 0;
  let strengthLabel: PasswordStrengthLabel = 'Empty';

  if (password.length > 0) {
    if (passedCount <= 2) {
      strengthLevel = 1;
      strengthLabel = 'Weak';
    } else if (passedCount === 3) {
      strengthLevel = 2;
      strengthLabel = 'Fair';
    } else if (passedCount === 4) {
      strengthLevel = 3;
      strengthLabel = 'Good';
    } else {
      strengthLevel = 4;
      strengthLabel = 'Strong';
    }
  }

  let errorMessage: string | null = null;
  if (!checks.minLength) {
    errorMessage = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  } else if (!checks.maxLength) {
    errorMessage = `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  } else if (!checks.uppercase) {
    errorMessage = 'Password must include at least one uppercase letter (A-Z).';
  } else if (!checks.lowercase) {
    errorMessage = 'Password must include at least one lowercase letter (a-z).';
  } else if (!checks.number) {
    errorMessage = 'Password must include at least one number (0-9).';
  } else if (!checks.special) {
    errorMessage = 'Password must include at least one special character (e.g. !@#$%^&*).';
  }

  return {
    isValid: errorMessage === null,
    errorMessage,
    passedCount,
    strengthLevel,
    strengthLabel,
    checks,
  };
}
