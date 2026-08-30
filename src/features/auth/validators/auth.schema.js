import { z } from 'zod';
import {
  hasMinimumSignupEmailLocalPart,
  normalizeEmailAddress,
  signupEmailLocalPartMessage,
} from '../../../utils/emailRules';
import { isCommonPassword, normalizePasswordComparable, passwordRules } from '../../../utils/passwordRules';

const normalizeEmailValue = normalizeEmailAddress;

const hasObviousEmailIssues = (value) => {
  const normalizedValue = normalizeEmailValue(value);
  const [localPart = '', domainPart = ''] = normalizedValue.split('@');

  if (!localPart || !domainPart) return true;
  if (normalizedValue.includes('..')) return true;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return true;
  if (domainPart.startsWith('-') || domainPart.endsWith('-')) return true;
  if (!domainPart.includes('.')) return true;

  const domainLabels = domainPart.split('.');
  if (domainLabels.some((label) => !label || label.startsWith('-') || label.endsWith('-'))) {
    return true;
  }

  const topLevelDomain = domainLabels[domainLabels.length - 1] || '';
  if (topLevelDomain.length < 2) return true;

  return false;
};

export const calculateAgeFromBirthdate = (birthdate) => {
  if (!birthdate) return null;

  const parsedDate = new Date(`${birthdate}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - parsedDate.getFullYear();
  const monthDifference = today.getMonth() - parsedDate.getMonth();

  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < parsedDate.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
};

// Shared Field Rules
export const emailField = z.string()
  .trim()
  .min(1, 'Please enter your email.')
  .max(254, 'Email is too long')
  .email('Please enter a valid email address.')
  .refine((value) => !hasObviousEmailIssues(value), {
    message: 'Please enter a valid email address.',
  })
  .transform(normalizeEmailValue);

export const signupEmailField = emailField.refine(hasMinimumSignupEmailLocalPart, {
  message: signupEmailLocalPartMessage,
});

export const passwordField = z.string()
  .min(passwordRules.minLength, `Password must be at least ${passwordRules.minLength} characters`)
  .regex(passwordRules.hasUppercase, 'Password must contain at least one uppercase letter')
  .regex(passwordRules.hasLowercase, 'Password must contain at least one lowercase letter')
  .regex(passwordRules.hasNumber, 'Password must contain at least one number')
  .regex(passwordRules.hasSpecialChar, 'Password must contain at least one special character')
  .refine((value) => !value.toLowerCase().includes('password'), {
    message: 'Password cannot contain the word "password"',
  })
  .refine((value) => !isCommonPassword(value), {
    message: 'This password is too common. Choose a more unique password',
  });

export const nameField = z.string().min(2, 'Must be at least 2 characters').max(50, 'Max 50 characters allowed');
export const phoneField = z.string()
  .trim()
  .regex(/^09\d{9}$/, 'Enter a valid PH mobile number');
export const addressField = z.string().trim().min(2, 'This field is required').max(120, 'Max 120 characters allowed');
export const birthdateField = z.string()
  .trim()
  .min(1, 'Birthdate is required')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format')
  .refine((value) => calculateAgeFromBirthdate(value) !== null, {
    message: 'Enter a valid birthdate',
  });
export const coordinateField = z.string()
  .trim()
  .optional()
  .or(z.literal(''))
  .refine((value) => !value || !Number.isNaN(Number(value)), {
    message: 'Must be a valid coordinate',
  });

const passwordMatchesUserContext = (password, values = []) => {
  const normalizedPassword = normalizePasswordComparable(password);
  if (!normalizedPassword) return false;

  return values.some((value) => {
    const normalizedValue = normalizePasswordComparable(value);
    return normalizedValue.length >= 3 && normalizedPassword.includes(normalizedValue);
  });
};

export const signupDefaultValues = {
  email: '',
  password: '',
  confirmPassword: '',
  acceptedLegal: false,
};

// Login Schemas
export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Please enter your password.'),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z.object({
  password: passwordField,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Password do not match',
  path: ["confirmPassword"],
});

// Shared Base Signup Schema
export const baseSignupSchema = z.object({
  email: signupEmailField,
  password: passwordField,
  confirmPassword: z.string(),
  acceptedLegal: z.boolean().refine((value) => value === true, {
    message: 'Please accept the Terms and Conditions to continue.',
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Password do not match',
  path: ['confirmPassword'],
}).superRefine((data, ctx) => {
  if (passwordMatchesUserContext(data.password, [data.email])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Password cannot contain your email address.',
      path: ['password'],
    });
  }
});

// Role-Specific Signup Schemas (can add role-specific fields here later)
export const patientSignupSchema = baseSignupSchema; // Patients might need extra medical consent fields later
export const donorSignupSchema = baseSignupSchema; // Donors might need hair history fields later
export const unifiedSignupSchema = baseSignupSchema;

export const verifyEmailSchema = z.object({
  otp: z.string().length(6, 'OTP must be exactly 6 digits').regex(/^\d+$/, 'OTP must only contain numbers'),
});
