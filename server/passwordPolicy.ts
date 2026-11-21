export interface PasswordCheckResult {
  isValid: boolean;
  errorMessage: string | null;
  checks: {
    minLength: boolean;
    uppercase: boolean;
    lowercase: boolean;
    number: boolean;
    special: boolean;
    maxLength: boolean;
  };
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function validatePasswordPolicy(password: string): PasswordCheckResult {
  const checks = {
    minLength: password.length >= MIN_PASSWORD_LENGTH,
    maxLength: password.length <= MAX_PASSWORD_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9\s]/.test(password),
  };

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
    checks,
  };
}
