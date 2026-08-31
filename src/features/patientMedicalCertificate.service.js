import { invokeEdgeFunction } from '../api/supabase/client';
import { uploadPatientOnboardingMedia, updatePatientDetails } from './profile/api/profile.api';
import { logAppError, logAppEvent } from '../utils/appErrors';

export const medicalCertificateVerificationFunctionName =
  process.env.EXPO_PUBLIC_MEDICAL_CERTIFICATE_VERIFICATION_FUNCTION
  || 'verify-medical-certificate';

const VERIFICATION_REQUEST_TIMEOUT_MS = 18000;
const DATABASE_MEDICAL_VERIFICATION_STATUSES = new Set([
  'not_submitted',
  'ocr_failed',
  'ocr_passed_prc_pending',
  'prc_verified',
  'rejected',
  'verified',
]);

const base64ToArrayBuffer = (base64Value = '') => {
  const base64 = String(base64Value || '').replace(/\s/g, '');
  const binary = typeof globalThis.atob === 'function'
    ? globalThis.atob(base64)
    : '';
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const normalizeComparableText = (value = '') => normalizeText(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const MONTH_NUMBER_BY_NAME = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const toCanonicalDate = (year, month, day) => {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (!Number.isInteger(numericYear) || numericYear < 1900 || numericYear > 2200) return '';
  if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) return '';
  const daysInMonth = new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate();
  if (!Number.isInteger(numericDay) || numericDay < 1 || numericDay > daysInMonth) return '';
  return `${numericYear}-${String(numericMonth).padStart(2, '0')}-${String(numericDay).padStart(2, '0')}`;
};

const getComparableDateCandidates = (value = '') => {
  const normalized = normalizeText(value).replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1');
  if (!normalized) return [];

  const yearFirstMatch = normalized.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (yearFirstMatch) {
    return [toCanonicalDate(yearFirstMatch[1], yearFirstMatch[2], yearFirstMatch[3])].filter(Boolean);
  }

  const monthNameMatch = normalized.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i)
    || normalized.match(/^(\d{1,2})\s+([a-z]+),?\s+(\d{4})$/i);
  if (monthNameMatch) {
    const isMonthFirst = /^[a-z]/i.test(monthNameMatch[1]);
    const monthName = isMonthFirst ? monthNameMatch[1] : monthNameMatch[2];
    const day = isMonthFirst ? monthNameMatch[2] : monthNameMatch[1];
    const year = monthNameMatch[3];
    const canonical = toCanonicalDate(year, MONTH_NUMBER_BY_NAME[monthName.toLowerCase()], day);
    return canonical ? [canonical] : [];
  }

  const numericMatch = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (numericMatch) {
    const [, first, second, rawYear] = numericMatch;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return Array.from(new Set([
      toCanonicalDate(year, first, second),
      toCanonicalDate(year, second, first),
    ].filter(Boolean)));
  }

  return [];
};

const normalizeComparableDate = (value = '') => (
  getComparableDateCandidates(value)[0] || normalizeComparableText(value)
);

const doDatesMatch = (firstValue, secondValue) => {
  const firstCandidates = getComparableDateCandidates(firstValue);
  const secondCandidates = getComparableDateCandidates(secondValue);
  if (!firstCandidates.length || !secondCandidates.length) return false;
  return firstCandidates.some((candidate) => secondCandidates.includes(candidate));
};

const getMeaningfulTokens = (value, { type = 'generic' } = {}) => {
  const aliases = type === 'condition'
    ? { carcinoma: 'cancer', tumour: 'tumor' }
    : {};
  const ignoredTokens = type === 'condition'
    ? new Set(['of', 'the', 'and', 'with', 'disease', 'condition'])
    : new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'jr', 'sr', 'ii', 'iii', 'iv']);
  return normalizeComparableText(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => aliases[token] || token)
    .filter((token) => !ignoredTokens.has(token));
};

const doTokenSetsMatch = (firstValue, secondValue, options = {}) => {
  const firstTokens = Array.from(new Set(getMeaningfulTokens(firstValue, options)));
  const secondTokens = Array.from(new Set(getMeaningfulTokens(secondValue, options)));
  if (!firstTokens.length || !secondTokens.length) return false;
  const firstSet = new Set(firstTokens);
  const secondSet = new Set(secondTokens);
  const sharedCount = firstTokens.filter((token) => secondSet.has(token)).length;
  const shorterLength = Math.min(firstTokens.length, secondTokens.length);
  const unionSize = new Set([...firstSet, ...secondSet]).size;
  return sharedCount === shorterLength || sharedCount / unionSize >= 0.72;
};

const extractDoctorName = (text = '') => {
  const normalized = normalizeText(text);
  const patterns = [
    /\bdr\.?\s+([a-z][a-z\s.,-]{2,80})/i,
    /(?:doctor|physician)\s*(?:name)?\s*[:#-]?\s*(?:dr\.?\s*)?([a-z][a-z\s.,-]{2,80})/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const doctorName = match?.[1]
      ?.replace(/\b(prc|license|lic|ptr|md|medical oncolog(?:y|ist))\b.*$/i, '')
      .trim()
      .replace(/[,:;.-]+$/, '')
      .trim();
    if (doctorName && !/^name$/i.test(doctorName)) return doctorName;
  }
  return '';
};

const extractLicenseNumber = (text = '') => {
  const normalized = normalizeText(text);
  const patterns = [
    /\b(?:prc|license|lic\.?|registration)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([a-z0-9-]{0,20}\d[a-z0-9-]{0,20})/i,
    /\b(?:medical\s+license)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([a-z0-9-]{0,20}\d[a-z0-9-]{0,20})/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].replace(/[^a-z0-9-]/gi, '').toUpperCase();
  }
  return '';
};

const extractMedicalCondition = (text = '') => {
  const normalized = normalizeText(text);
  const knownConditionPatterns = [
    /\b(?:stage\s+[0-9ivx]+[a-c]?\s+)?(?:[a-z]+\s+){0,3}cancer(?:\s*\([^)]+\))?/i,
    /\b(?:androgenetic|androgenic|traction|cicatricial|scarring)?\s*alopecia(?:\s+(?:areata|totalis|universalis))?/i,
    /\b(?:acute|chronic)?\s*(?:lymphocytic|lymphoblastic|myeloid|myelogenous)?\s*leukemia\b/i,
    /\b(?:hodgkin'?s?|non-hodgkin'?s?)?\s*lymphoma\b/i,
  ];
  const patterns = [
    /\b(?:diagnosis\s*\/\s*medical condition|diagnosis|medical condition|condition|assessment)\s*(?:is|:|-)?\s*([a-z][a-z0-9 ,()./'-]{2,160}?)(?=\s+(?:treatment status|treatment|date|diagnosed|doctor|physician|prc|license|recommendation|remarks|certified|$))/i,
    /\bdiagnosed\s+with\s+([a-z][a-z0-9 ,()./'-]{2,100}?)(?=\s+(?:on|date|doctor|physician|prc|license|treatment|recommendation|remarks|$))/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      const captured = match[1].replace(/[,:;.-]+$/, '').trim();
      for (const conditionPattern of knownConditionPatterns) {
        const conditionMatch = captured.match(conditionPattern);
        if (conditionMatch?.[0]) return conditionMatch[0].trim();
      }
      return captured;
    }
  }
  for (const conditionPattern of knownConditionPatterns) {
    const conditionMatch = normalized.match(conditionPattern);
    if (conditionMatch?.[0]) return conditionMatch[0].trim();
  }
  return '';
};

const extractDiagnosisDate = (text = '') => {
  const normalized = normalizeText(text);
  const dateValue = '(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\\s+\\d{4})';
  const patterns = [
    new RegExp(`\\b(?:date of diagnosis|diagnosis date|diagnosed on)\\s*[:#-]?\\s*(${dateValue})`, 'i'),
    new RegExp(`\\b(?:date of examination|examination date|certificate date|date issued|issued on)\\s*[:#-]?\\s*(${dateValue})`, 'i'),
    new RegExp(`\\bdate\\s*[:#-]\\s*(${dateValue})`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  const genericMatch = normalized.match(new RegExp(`\\b(${dateValue})\\b`, 'i'));
  return genericMatch?.[1]?.trim() || '';
};

const extractHospitalName = (text = '') => {
  const normalized = normalizeText(text);
  const facilitySuffix = '(?:hospital|medical cent(?:er|re)|health cent(?:er|re)|clinic|infirmary|oncology cent(?:er|re))';
  const labelledMatch = normalized.match(new RegExp(`\\b(?:hospital|facility|clinic)\\s*(?:name)?\\s*[:#-]\\s*([a-z0-9&.,' -]{3,100}?\\b${facilitySuffix})`, 'i'));
  if (labelledMatch?.[1]) return labelledMatch[1].trim();

  const leadingMatch = normalized.match(new RegExp(`^([a-z0-9&.,' -]{3,100}?\\b${facilitySuffix})\\b`, 'i'));
  return leadingMatch?.[1]?.trim() || '';
};

const extractPatientIdentity = (text = '') => {
  const normalized = normalizeText(text);
  const dateValue = '(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?),?\\s+\\d{4})';
  const reorderedIdentity = normalized.match(/\b(?:diagnosis\s*\/\s*medical condition|medical condition)\s*[:#-]?\s*([a-z][a-z .,'-]{3,80}?)\s+(\d{1,3})\s*(?:years?\s*old|y\/?o)\s*[\/-]\s*(male|female|non-binary|nonbinary|man|woman|m|f)\b/i);
  const labelledName = normalized.match(/\bpatient\s*(?:full\s*)?name\s*[:#-]\s*([a-z][a-z .,'-]{2,80}?)(?=\s+(?:age|sex|gender|birth(?:date|\s*date)|date of birth|diagnosis|medical condition|$))/i);
  const ageMatch = reorderedIdentity
    || normalized.match(/\bage(?:\s*\/\s*sex)?\s*[:#-]?\s*(\d{1,3})(?:\s*(?:years?\s*old|y\/?o))?/i)
    || normalized.match(/\b(\d{1,3})\s*(?:years?\s*old|y\/?o)\b/i);
  const genderValue = reorderedIdentity?.[3]
    || normalized.match(/\b(?:sex|gender)\s*[:#-]?\s*(male|female|non-binary|nonbinary|man|woman|m|f)\b/i)?.[1]
    || normalized.match(/\b(?:years?\s*old|y\/?o)\s*[\/-]\s*(male|female|non-binary|nonbinary|man|woman|m|f)\b/i)?.[1]
    || '';
  const birthdate = normalized.match(new RegExp(`\\b(?:date of birth|birthdate|birth date|dob)\\s*[:#-]?\\s*(${dateValue})`, 'i'))?.[1] || '';
  const patientName = (reorderedIdentity?.[1] || labelledName?.[1] || '')
    .replace(/[,:;.-]+$/, '')
    .trim();
  const ageValue = reorderedIdentity?.[2] || ageMatch?.[2] || ageMatch?.[1] || '';

  return {
    patientName,
    patientAge: ageValue ? Number(ageValue) : null,
    patientGender: /^(?:female|woman|f)$/i.test(genderValue)
      ? 'Female'
      : /^(?:male|man|m)$/i.test(genderValue)
        ? 'Male'
        : genderValue
          ? 'Non-binary'
          : '',
    patientBirthdate: birthdate.trim(),
  };
};

const calculateAgeOnDate = (birthdate, referenceDate) => {
  const birth = normalizeComparableDate(birthdate).split('-').map(Number);
  const reference = normalizeComparableDate(referenceDate || new Date().toISOString().slice(0, 10)).split('-').map(Number);
  if (birth.length !== 3 || reference.length !== 3 || birth.some(Number.isNaN) || reference.some(Number.isNaN)) return null;
  let age = reference[0] - birth[0];
  const beforeBirthday = reference[1] < birth[1]
    || (reference[1] === birth[1] && reference[2] < birth[2]);
  if (beforeBirthday) age -= 1;
  return age;
};

export const compareMedicalCertificateToPatientInput = ({
  verification,
  patientName,
  birthdate,
  gender,
  medicalCondition,
  diagnosisDate,
}) => {
  const enteredPatientName = normalizeText(patientName || '');
  const detectedPatientName = normalizeText(verification?.patientName || '');
  const enteredPatientNameComparable = normalizeComparableText(enteredPatientName);
  const detectedPatientNameComparable = normalizeComparableText(detectedPatientName);
  const enteredPatientNameParts = enteredPatientNameComparable.split(' ').filter(Boolean);
  const detectedPatientNameParts = detectedPatientNameComparable.split(' ').filter(Boolean);
  const firstAndLastNameMatch = enteredPatientNameParts.length >= 2
    && detectedPatientNameParts.length >= 2
    && enteredPatientNameParts[0] === detectedPatientNameParts[0]
    && enteredPatientNameParts[enteredPatientNameParts.length - 1]
      === detectedPatientNameParts[detectedPatientNameParts.length - 1];
  const patientNameMatches = Boolean(enteredPatientNameComparable && detectedPatientNameComparable)
    && (
      enteredPatientNameComparable === detectedPatientNameComparable
      || enteredPatientNameComparable.includes(detectedPatientNameComparable)
      || detectedPatientNameComparable.includes(enteredPatientNameComparable)
      || firstAndLastNameMatch
      || doTokenSetsMatch(enteredPatientNameComparable, detectedPatientNameComparable, { type: 'name' })
    );
  const enteredGender = normalizeComparableText(gender);
  const detectedGender = normalizeComparableText(verification?.patientGender);
  const genderMatches = Boolean(enteredGender && detectedGender) && enteredGender === detectedGender;
  const detectedBirthdate = normalizeText(verification?.patientBirthdate || '');
  const hasDetectedAge = verification?.patientAge !== null
    && verification?.patientAge !== undefined
    && verification?.patientAge !== '';
  const detectedAge = hasDetectedAge && Number.isFinite(Number(verification.patientAge))
    ? Number(verification.patientAge)
    : null;
  const expectedAge = birthdate
    ? calculateAgeOnDate(birthdate, normalizeComparableDate(verification?.diagnosisDate) || new Date())
    : null;
  const birthdateMatches = detectedBirthdate
    ? doDatesMatch(detectedBirthdate, birthdate)
    : detectedAge !== null && expectedAge !== null && Math.abs(detectedAge - expectedAge) <= 1;
  const detectedCondition = normalizeText(verification?.medicalCondition || '');
  const enteredCondition = normalizeText(medicalCondition || '');
  const detectedConditionComparable = normalizeComparableText(detectedCondition);
  const enteredConditionComparable = normalizeComparableText(enteredCondition);
  const conditionMatches = Boolean(detectedConditionComparable && enteredConditionComparable)
    && (
      detectedConditionComparable.includes(enteredConditionComparable)
      || enteredConditionComparable.includes(detectedConditionComparable)
      || doTokenSetsMatch(detectedConditionComparable, enteredConditionComparable, { type: 'condition' })
    );

  const detectedDate = normalizeText(verification?.diagnosisDate || '');
  const enteredDate = normalizeText(diagnosisDate || '');
  const dateMatches = Boolean(detectedDate && enteredDate)
    && doDatesMatch(detectedDate, enteredDate);
  const mismatches = [];

  if (!patientNameMatches) {
    mismatches.push({
      step: 1,
      field: 'Patient name',
      entered: enteredPatientName || 'Not provided',
      detected: detectedPatientName || 'Not detected in document',
    });
  }
  if (!birthdateMatches) {
    mismatches.push({
      step: 1,
      field: detectedBirthdate ? 'Birthdate' : 'Birthdate / age',
      entered: birthdate || 'Not provided',
      detected: detectedBirthdate || (detectedAge !== null ? `${detectedAge} years old` : 'Not detected in document'),
    });
  }
  if (!genderMatches) {
    mismatches.push({
      step: 1,
      field: 'Gender',
      entered: gender || 'Not provided',
      detected: verification?.patientGender || 'Not detected in document',
    });
  }

  if (!conditionMatches) {
    mismatches.push({
      step: 2,
      field: 'Medical condition',
      entered: enteredCondition || 'Not provided',
      detected: detectedCondition || 'Not detected in document',
    });
  }
  if (!dateMatches) {
    mismatches.push({
      step: 2,
      field: 'Diagnosis date',
      entered: enteredDate || 'Not provided',
      detected: detectedDate || 'Not detected in document',
    });
  }

  return {
    matches: mismatches.length === 0,
    patientNameMatches,
    birthdateMatches,
    genderMatches,
    conditionMatches,
    dateMatches,
    mismatches,
  };
};

const validateCertificateText = (text = '') => {
  const normalized = normalizeText(text);
  const doctorName = extractDoctorName(normalized);
  const licenseNumber = extractLicenseNumber(normalized);
  const medicalCondition = extractMedicalCondition(normalized);
  const diagnosisDate = extractDiagnosisDate(normalized);
  const hospitalName = extractHospitalName(normalized);
  const patientIdentity = extractPatientIdentity(normalized);
  const hasCertificateKeyword = /\b(medical certificate|certificate|certification|clinical abstract|doctor'?s certificate)\b/i.test(normalized);
  const hasDiagnosisKeyword = /\b(cancer|oncology|chemotherapy|alopecia|diagnosis|diagnosed|medical condition|patient)\b/i.test(normalized);
  const missing = [];

  if (!hasCertificateKeyword) missing.push('medical certificate label');
  if (!doctorName) missing.push('doctor name');
  if (!licenseNumber) missing.push('PRC/license number');
  if (!hasDiagnosisKeyword || !medicalCondition) missing.push('medical condition detail');
  if (!diagnosisDate) missing.push('diagnosis date');

  return {
    passed: missing.length === 0,
    status: missing.length === 0 ? 'ocr_passed_prc_pending' : 'ocr_failed',
    missing,
    doctorName,
    licenseNumber,
    medicalCondition,
    diagnosisDate,
    hospitalName,
    ...patientIdentity,
    extractedText: normalized,
  };
};

const normalizeVerifierResponse = (payload = {}, fallbackText = '') => {
  const extractedText = normalizeText(
    payload.extracted_text
    || payload.extractedText
    || payload.text
    || fallbackText
  );
  const local = validateCertificateText(extractedText);
  const medicalCondition = payload.medical_condition || payload.medicalCondition || local.medicalCondition;
  const diagnosisDate = payload.diagnosis_date || payload.diagnosisDate || local.diagnosisDate;
  const hospitalName = payload.hospital_name || payload.hospitalName || local.hospitalName;
  const patientName = payload.patient_name || payload.patientName || local.patientName;
  const patientGender = payload.patient_gender || payload.patientGender || local.patientGender;
  const patientBirthdate = payload.patient_birthdate || payload.patientBirthdate || local.patientBirthdate;
  const patientAgeValue = payload.patient_age ?? payload.patientAge ?? local.patientAge;
  const patientAge = patientAgeValue === '' || patientAgeValue === null || patientAgeValue === undefined
    ? null
    : Number(patientAgeValue);
  const missing = Array.from(new Set([
    ...local.missing,
    ...(Array.isArray(payload.missing) ? payload.missing : []),
  ])).filter((item) => {
    if (item === 'medical condition detail' && medicalCondition) return false;
    if (item === 'diagnosis date' && diagnosisDate) return false;
    if (item === 'patient name' && patientName) return false;
    if (item === 'patient gender' && patientGender) return false;
    if (item === 'patient birthdate or age' && (patientBirthdate || patientAge !== null)) return false;
    return true;
  });
  const remotePassed = Boolean(payload.passed ?? payload.valid ?? local.passed);
  const passed = remotePassed && missing.length === 0;
  const status = passed
    ? (payload.status || payload.verification_status || local.status)
    : 'ocr_failed';
  return {
    ...local,
    passed,
    status,
    missing,
    provider: payload.provider || 'edge_function',
    documentLegitimacy: payload.document_legitimacy || payload.documentLegitimacy || 'requires_prc_staff_review',
    doctorName: payload.doctor_name || payload.doctorName || local.doctorName,
    licenseNumber: payload.license_number || payload.licenseNumber || local.licenseNumber,
    medicalCondition,
    diagnosisDate,
    hospitalName,
    patientName,
    patientGender,
    patientBirthdate,
    patientAge,
    extractedText,
    raw: payload,
  };
};

const withTimeout = async (promise, timeoutMs, timeoutMessage) => {
  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        error: new Error(timeoutMessage),
        data: null,
      });
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

const readResponseMessage = async (response) => {
  if (!response) return '';

  try {
    const clonedResponse = typeof response.clone === 'function' ? response.clone() : response;
    const payload = await clonedResponse.json();
    return normalizeText(
      payload?.error
      || payload?.message
      || payload?.details
      || ''
    );
  } catch (_) {
    try {
      const clonedResponse = typeof response.clone === 'function' ? response.clone() : response;
      return normalizeText(await clonedResponse.text());
    } catch (__) {
      return '';
    }
  }
};

const getEdgeFunctionErrorMessage = async (error, fallback = 'Medical certificate verifier is unavailable.') => {
  const responseMessage = await readResponseMessage(error?.context);
  const status = error?.context?.status ? `HTTP ${error.context.status}` : '';
  const technicalMessage = normalizeText(error?.message || '');

  return responseMessage
    || [status, technicalMessage].filter(Boolean).join(': ')
    || fallback;
};

export const verifyMedicalCertificateAsset = async ({
  authUserId,
  patientId,
  asset,
  expectedMedicalCondition,
  expectedDiagnosisDate,
  expectedPatientName,
  expectedBirthdate,
  expectedGender,
}) => {
  if (!authUserId) {
    return { success: false, error: 'Your session is not ready.' };
  }
  if (!asset?.uri) {
    return { success: false, error: 'Select or scan the medical certificate first.' };
  }

  const contentType = asset.mimeType || asset.mime || asset.contentType || 'image/jpeg';
  const fileName = asset.fileName || `medical-certificate-${Date.now()}.${contentType.includes('pdf') ? 'pdf' : 'jpg'}`;
  let documentUrl = asset.publicUrl || asset.documentUrl || '';

  if (!documentUrl) {
    let fileBody = asset.fileBody || null;
    if (!fileBody && asset.base64) {
      fileBody = base64ToArrayBuffer(asset.base64);
    }
    if (!fileBody) {
      const response = await fetch(asset.uri);
      fileBody = await response.arrayBuffer();
    }

    const uploadResult = await uploadPatientOnboardingMedia({
      authUserId,
      fileBody,
      contentType,
      fileName,
      documentType: 'patient-medical-certificate',
    });

    if (uploadResult.error || !uploadResult.data?.publicUrl) {
      return {
        success: false,
        error: uploadResult.error?.message || 'Unable to upload the medical certificate.',
      };
    }

    documentUrl = uploadResult.data.publicUrl;
  }
  let verification = validateCertificateText(asset.ocrText || '');
  let verificationErrorMessage = '';
  try {
    const edgeResult = await withTimeout(
      invokeEdgeFunction(medicalCertificateVerificationFunctionName, {
        body: {
          document_url: documentUrl,
          mime_type: contentType,
          file_name: fileName,
          patient_id: patientId || null,
        },
      }),
      VERIFICATION_REQUEST_TIMEOUT_MS,
      'Document verification timed out. Please try scanning a clearer photo.'
    );

    if (!edgeResult.error && edgeResult.data) {
      verification = normalizeVerifierResponse(edgeResult.data, asset.ocrText || '');
    } else if (edgeResult.error) {
      verificationErrorMessage = await getEdgeFunctionErrorMessage(edgeResult.error);
      logAppEvent('patient.medical_certificate.verify.edge_unavailable', 'Medical certificate verifier returned an error.', {
        message: verificationErrorMessage,
        status: edgeResult.error?.context?.status || null,
      }, 'warn');
    }
  } catch (error) {
    verificationErrorMessage = await getEdgeFunctionErrorMessage(
      error,
      error?.message || 'Medical certificate verifier failed.'
    );
    logAppError('patient.medical_certificate.verify.edge_failed', error);
  }

  const shouldComparePatientInput = Boolean(
    normalizeText(expectedPatientName)
    && normalizeText(expectedBirthdate)
    && normalizeText(expectedGender)
    && normalizeText(expectedMedicalCondition)
    && normalizeText(expectedDiagnosisDate)
  );
  const patientInputComparison = shouldComparePatientInput
    ? compareMedicalCertificateToPatientInput({
      verification,
      patientName: expectedPatientName,
      birthdate: expectedBirthdate,
      gender: expectedGender,
      medicalCondition: expectedMedicalCondition,
      diagnosisDate: expectedDiagnosisDate,
    })
    : {
      matches: true,
      patientNameMatches: true,
      birthdateMatches: true,
      genderMatches: true,
      conditionMatches: true,
      dateMatches: true,
      mismatches: [],
      skipped: true,
    };
  const hasComparableDocumentData = Boolean(
    verification.patientName
    || verification.patientGender
    || verification.patientBirthdate
    || (verification.patientAge !== null && verification.patientAge !== undefined)
    || verification.medicalCondition
    || verification.diagnosisDate
  );
  if (shouldComparePatientInput && hasComparableDocumentData && !patientInputComparison.matches) {
    verification = {
      ...verification,
      passed: false,
      status: 'patient_details_mismatch',
      patientInputComparison,
    };
  } else {
    verification = { ...verification, patientInputComparison };
  }

  await updatePatientDetails(authUserId, {
    medical_document: documentUrl,
    medical_document_verification_status: DATABASE_MEDICAL_VERIFICATION_STATUSES.has(verification.status)
      ? verification.status
      : verification.passed
        ? 'ocr_passed_prc_pending'
        : 'ocr_failed',
    doctor_name: verification.doctorName || null,
    doctor_license_number: verification.licenseNumber || null,
    medical_document_ocr_text: verification.extractedText || null,
    medical_document_verified_at: new Date().toISOString(),
  });

  return {
    success: verification.passed,
    documentUrl,
    verification,
    error: verification.passed
      ? ''
      : verification.status === 'patient_details_mismatch'
        ? 'The certificate does not match the patient information entered in Step 1 or Step 2.'
        : verificationErrorMessage || `Certificate OCR validation failed. Missing: ${verification.missing.join(', ')}.`,
  };
};
