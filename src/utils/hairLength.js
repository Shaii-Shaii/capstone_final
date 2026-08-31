const CM_PER_INCH = 2.54;

const toFinitePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const nearlyEqual = (left, right) => (
  Math.abs(left - right) <= Math.max(0.2, Math.abs(right) * 0.02)
);

const roundLengthCm = (value) => Math.round(value * 10) / 10;

export const hasUnmeasurableHairLengthEvidence = (value = '') => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;

  return [
    /\b(?:hair\s+(?:is|appears|looks)\s+)?(?:tied|pulled)\s+back\b/,
    /\b(?:ponytail|bun|updo)\b/,
    /\b(?:secured|held|fastened)\s+(?:back\s+)?with\s+(?:a\s+)?(?:claw\s+)?clip\b/,
    /\b(?:claw clip|hair clip|scrunchie|hair tie)\s+(?:is\s+)?(?:holding|securing|blocking|covering|obstructing)\b/,
    /\b(?:lowest\s+)?(?:hair\s+)?ends?\s+(?:are|is|remain|were)?\s*(?:not visible|hidden|blocked|covered|cropped|obstructed)\b/,
    /\b(?:cannot|can't|unable to|could not)\s+(?:clearly\s+)?(?:see|identify|confirm|measure)\s+(?:the\s+)?(?:lowest\s+)?(?:hair\s+)?ends?\b/,
    /\b(?:length|donation length)\s+(?:cannot|can't|could not|is not able to be)\s+(?:be\s+)?(?:measured|estimated|confirmed)\b/,
  ].some((pattern) => pattern.test(normalized));
};

const collectLengthEvidence = (screening = {}) => [
  screening?.length_assessment,
  screening?.donation_readiness_note,
  screening?.summary,
  ...(Array.isArray(screening?.per_view_notes)
    ? screening.per_view_notes.map((item) => item?.notes)
    : []),
  screening?.analysis_result?.length_assessment,
  screening?.analysis_result?.donation_readiness_note,
  screening?.analysis_result?.summary,
  ...(Array.isArray(screening?.analysis_result?.per_view_notes)
    ? screening.analysis_result.per_view_notes.map((item) => item?.notes)
    : []),
].filter(Boolean).join(' ');

/**
 * AI_Screenings.Estimated_Length is stored in centimeters. Some AI responses
 * have returned the inch value in that field while correctly describing the
 * same value as inches in Length_Assessment. Only correct that explicit,
 * verifiable mismatch so legitimate centimeter values are left unchanged.
 */
export const resolveEstimatedLengthCm = (screeningOrValue, evidence = '') => {
  const isScreening = screeningOrValue
    && typeof screeningOrValue === 'object'
    && !Array.isArray(screeningOrValue);
  const rawLength = toFinitePositiveNumber(
    isScreening ? screeningOrValue.estimated_length : screeningOrValue,
  );
  const evidenceText = String(
    evidence || (isScreening ? collectLengthEvidence(screeningOrValue) : ''),
  );

  if (hasUnmeasurableHairLengthEvidence(evidenceText)) return null;
  if (!rawLength || !evidenceText.trim()) return rawLength;

  const measurementPattern = /(\d+(?:\.\d+)?)\s*(inches?|in\.?|centimet(?:er|re)s?|cm)\b/gi;
  let match = measurementPattern.exec(evidenceText);

  while (match) {
    const describedLength = toFinitePositiveNumber(match[1]);
    const unit = String(match[2] || '').toLowerCase();

    if (describedLength) {
      const isInches = unit.startsWith('in');
      const describedLengthCm = isInches
        ? describedLength * CM_PER_INCH
        : describedLength;

      if (nearlyEqual(rawLength, describedLengthCm)) return roundLengthCm(rawLength);
      if (isInches && nearlyEqual(rawLength, describedLength)) {
        return roundLengthCm(describedLengthCm);
      }
    }

    match = measurementPattern.exec(evidenceText);
  }

  return roundLengthCm(rawLength);
};

export const formatEstimatedLengthInches = (screeningOrValue, evidence = '') => {
  const lengthCm = resolveEstimatedLengthCm(screeningOrValue, evidence);
  return lengthCm ? `${(lengthCm / CM_PER_INCH).toFixed(1)} inches` : 'Not detected';
};

const resolveMinimumLengthCm = (requirement = null) => {
  const explicitCm = toFinitePositiveNumber(requirement?.minimum_hair_length_cm);
  if (explicitCm) return explicitCm;

  const explicitInches = toFinitePositiveNumber(requirement?.minimum_hair_length_inches);
  return explicitInches ? roundLengthCm(explicitInches * CM_PER_INCH) : null;
};

/**
 * Prevents an AI-provided donation decision from contradicting the configured
 * minimum length. This is intentionally a one-way safety rule: it can reject a
 * too-short result, but it cannot approve hair based on length alone.
 */
export const alignScreeningWithMinimumLength = (screening = null, requirement = null) => {
  if (!screening || typeof screening !== 'object') return screening;

  const estimatedLengthCm = resolveEstimatedLengthCm(screening);
  const minimumLengthCm = resolveMinimumLengthCm(requirement);
  if (!estimatedLengthCm || !minimumLengthCm || estimatedLengthCm >= minimumLengthCm) {
    return screening;
  }

  const estimatedInches = (estimatedLengthCm / CM_PER_INCH).toFixed(1);
  const minimumInches = (minimumLengthCm / CM_PER_INCH).toFixed(1);
  const lengthMessage = `The estimated donation length is ${estimatedInches} inches, below the ${minimumInches}-inch requirement. Continue caring for and growing your hair before checking again.`;

  return {
    ...screening,
    estimated_length: estimatedLengthCm,
    decision: 'Not eligible for donation yet',
    donation_readiness_note: lengthMessage,
    improvement_tracking_status: 'Not eligible for donation yet',
    improvement_recommendation: lengthMessage,
    analysis_result: screening.analysis_result && typeof screening.analysis_result === 'object'
      ? {
          ...screening.analysis_result,
          estimated_length: estimatedLengthCm,
          decision: 'Not eligible for donation yet',
          donation_readiness_note: lengthMessage,
          improvement_tracking_status: 'Not eligible for donation yet',
          improvement_recommendation: lengthMessage,
        }
      : screening.analysis_result,
  };
};
