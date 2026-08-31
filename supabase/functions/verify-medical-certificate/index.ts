const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OCR_PROVIDER_TIMEOUT_MS = 15000;

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

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
    patient_name: patientName,
    patient_age: ageValue ? Number(ageValue) : null,
    patient_gender: /^(?:female|woman|f)$/i.test(genderValue)
      ? 'Female'
      : /^(?:male|man|m)$/i.test(genderValue)
        ? 'Male'
        : genderValue
          ? 'Non-binary'
          : '',
    patient_birthdate: birthdate.trim(),
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
  const missing: string[] = [];

  if (!hasCertificateKeyword) missing.push('medical certificate label');
  if (!doctorName) missing.push('doctor name');
  if (!licenseNumber) missing.push('PRC/license number');
  if (!hasDiagnosisKeyword || !medicalCondition) missing.push('medical condition detail');
  if (!diagnosisDate) missing.push('diagnosis date');

  return {
    passed: missing.length === 0,
    status: missing.length === 0 ? 'ocr_passed_prc_pending' : 'ocr_failed',
    missing,
    doctor_name: doctorName,
    license_number: licenseNumber,
    medical_condition: medicalCondition,
    diagnosis_date: diagnosisDate,
    hospital_name: hospitalName,
    ...patientIdentity,
    extracted_text: normalized,
    document_legitimacy: 'requires_prc_staff_review',
  };
};

const runOcrSpace = async (documentUrl: string) => {
  const apiKey = Deno.env.get('OCR_SPACE_API_KEY') || '';
  if (!apiKey) {
    throw new Error('OCR_SPACE_API_KEY is not configured in edge function secrets.');
  }

  const formData = new FormData();
  formData.set('url', documentUrl);
  formData.set('language', 'eng');
  formData.set('isOverlayRequired', 'false');
  formData.set('OCREngine', '2');
  formData.set('scale', 'true');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_PROVIDER_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { apikey: apiKey },
      body: formData,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('OCR provider timed out. Please scan a clearer document or try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`OCR provider returned ${response.status}.`);
  }

  const payload = await response.json();
  if (payload?.IsErroredOnProcessing) {
    throw new Error(payload?.ErrorMessage?.[0] || 'OCR provider could not process the certificate.');
  }

  return (payload?.ParsedResults || [])
    .map((page: { ParsedText?: string }) => page?.ParsedText || '')
    .join('\n');
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const documentUrl = normalizeText(body?.document_url || body?.documentUrl || '');
    if (!documentUrl) {
      return new Response(JSON.stringify({ error: 'document_url is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const extractedText = await runOcrSpace(documentUrl);
    const validation = validateCertificateText(extractedText);

    return new Response(JSON.stringify({
      provider: 'ocr.space',
      ...validation,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Medical certificate OCR failed.',
    }), {
      status: 422,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
