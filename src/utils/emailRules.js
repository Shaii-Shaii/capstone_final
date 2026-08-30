export const MIN_SIGNUP_EMAIL_LOCAL_PART_LENGTH = 3;

export const signupEmailLocalPartMessage =
  `Email must have at least ${MIN_SIGNUP_EMAIL_LOCAL_PART_LENGTH} characters before @.`;

export const normalizeEmailAddress = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const hasMinimumSignupEmailLocalPart = (value) => {
  const normalizedValue = normalizeEmailAddress(value);
  const separatorIndex = normalizedValue.indexOf('@');

  if (separatorIndex < 0) return false;

  return normalizedValue.slice(0, separatorIndex).length >= MIN_SIGNUP_EMAIL_LOCAL_PART_LENGTH;
};
