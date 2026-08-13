import { supabase } from '../api/supabase/client';
import { resolveDatabaseUserId } from './profile/api/profile.api';
import { logAppError, logAppEvent } from '../utils/appErrors';

export const DONOR_PERMISSION_REASONS = {
  profileIncomplete: 'PROFILE_INCOMPLETE',
  guardianConsentRequired: 'GUARDIAN_CONSENT_REQUIRED',
  databaseFailure: 'DATABASE_FAILURE',
};

export const GUARDIAN_CONSENT_TEXT = 'I confirm that I am the parent or legal guardian of this minor donor. I allow the minor donor to participate in the hair donation process through Donivra. I understand that the system may collect and process the minor donor’s profile information, hair donation details, and submitted hair images for AI-assisted initial screening, donation tracking, and coordination with authorized personnel. I understand that final acceptance of donated hair will still be reviewed by authorized personnel.';

const legalDocumentTypeAliases = {
  'terms of service': ['Terms of Service', 'Terms and Conditions', 'Terms and Condition', 'Terms & Conditions', 'Terms'],
  'privacy policy': ['Privacy Policy', 'Data Privacy Policy', 'Privacy Notice', 'Privacy'],
  'terms and conditions': ['Terms and Conditions', 'Terms and Condition', 'Terms of Service', 'Terms & Conditions', 'Terms'],
};
const activeLegalDocumentTypes = ['Terms of Service', 'Privacy Policy'];
const fallbackLegalDocumentTypes = ['Terms and Conditions'];
const legalDocumentsTable = 'legal_documents';
const userLegalAgreementsTable = 'user_legal_agreements';
const guardianConsentsTable = 'guardian_consents';
const legalDocumentsBucket = 'legal-documents';
const legalDocumentBucketCandidates = ['legal-documents', 'legal_documents'];

const normalizeStoragePath = (path = '', bucket = '') => {
  const normalizedPath = String(path || '').trim().replace(/^\/+/, '');
  const normalizedBucket = String(bucket || '').trim();

  if (normalizedBucket && normalizedPath.startsWith(`${normalizedBucket}/`)) {
    return normalizedPath.slice(normalizedBucket.length + 1);
  }

  return normalizedPath;
};

const normalizeLegalDocument = (row = null) => {
  if (!row) return null;
  const fileUrl = row.Document_File_URL || row.document_file_url || row.File_URL || row.file_url || row.Pdf_URL || row.pdf_url || '';
  const rawFilePath = row.File_Path || row.file_path || row.Document_File_Path || row.document_file_path || row.Pdf_Path || row.pdf_path || '';
  const fileBucket = row.Document_File_Bucket || row.document_file_bucket || row.File_Bucket || row.file_bucket || row.Pdf_Bucket || row.pdf_bucket || legalDocumentsBucket;

  return {
    legal_document_id: row.Legal_Document_ID || row.legal_document_id || null,
    document_type: row.Document_Type || row.document_type || '',
    title: row.Title || row.title || '',
    version: row.Version || row.version || '',
    summary: row.Summary || row.summary || '',
    content: row.Content || row.content || '',
    file_url: fileUrl,
    file_path: normalizeStoragePath(rawFilePath, fileBucket),
    file_bucket: fileBucket,
    is_active: row.Is_Active ?? row.is_active ?? false,
  };
};

const isFilled = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return Boolean(value);
};

const normalizeLegalDocumentTypeKey = (value = '') => (
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\s+/g, ' ')
);

const getLegalDocumentTypeCandidates = (documentType = 'Terms and Conditions') => {
  const key = normalizeLegalDocumentTypeKey(documentType);
  const aliases = legalDocumentTypeAliases[key] || [documentType];
  return [...new Set([documentType, ...aliases].map((type) => String(type || '').trim()).filter(Boolean))];
};

const fetchActiveLegalDocumentRows = async (columns = '*') => {
  const result = await supabase
    .from(legalDocumentsTable)
    .select(columns)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (result.error) throw result.error;
  return result.data || [];
};

const isMissingStorageObjectError = (error) => {
  const errorMessage = String(error?.message || '').toLowerCase();
  const errorCode = String(error?.code || '').toLowerCase();
  return (
    errorMessage.includes('object not found')
    || errorCode === 'not_found'
    || errorCode === '404'
  );
};

const getLegalDocumentPathCandidates = (document) => {
  const rawPath = String(document?.file_path || '').trim();
  if (!rawPath) return [];

  const candidates = new Set([rawPath]);
  if (!rawPath.toLowerCase().endsWith('.pdf')) {
    candidates.add(`${rawPath}.pdf`);
  }

  const content = String(document?.content || '');
  const pdfNameMatch = content.match(/[A-Za-z0-9._-]+\.pdf/i);
  if (pdfNameMatch?.[0]) {
    candidates.add(pdfNameMatch[0]);
  }

  return [...candidates];
};

const extractPdfFileName = (document = null) => {
  const content = String(document?.content || '');
  const contentMatch = content.match(/[A-Za-z0-9._-]+\.pdf/i);
  if (contentMatch?.[0]) return contentMatch[0];

  const rawPath = String(document?.file_path || '').trim();
  if (!rawPath) return '';
  const baseName = rawPath.split('/').pop() || '';
  return /\.pdf$/i.test(baseName) ? baseName : '';
};

const isUuid = (value = '') => (
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
);

const resolveStorageObjectFromId = async (objectId = '') => {
  const normalizedId = String(objectId || '').trim();
  if (!isUuid(normalizedId)) return null;

  const lookupResult = await supabase
    .from('storage.objects')
    .select('id, bucket_id, name')
    .eq('id', normalizedId)
    .maybeSingle();

  if (lookupResult.error || !lookupResult.data?.name) return null;

  return {
    bucket_id: lookupResult.data.bucket_id || '',
    name: lookupResult.data.name || '',
  };
};

const resolveStorageObjectFromFileName = async (fileName = '', bucketCandidates = []) => {
  const normalizedName = String(fileName || '').trim();
  if (!normalizedName) return null;

  for (const bucketId of [...new Set(bucketCandidates.filter(Boolean))]) {
    const lookupResult = await supabase
      .from('storage.objects')
      .select('bucket_id, name, created_at')
      .eq('bucket_id', bucketId)
      .ilike('name', `%${normalizedName}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lookupResult.error && lookupResult.data?.name) {
      return {
        bucket_id: lookupResult.data.bucket_id || bucketId,
        name: lookupResult.data.name,
      };
    }
  }

  return null;
};

const listExistingBucketNames = async () => {
  const bucketResult = await supabase.storage.listBuckets();
  if (bucketResult.error) return [];
  return (bucketResult.data || []).map((bucket) => String(bucket?.name || '').trim()).filter(Boolean);
};

const resolveLegalDocumentPdfUrl = async (document) => {
  if (!document) return '';
  if (document.file_url) return document.file_url;
  if (!document.file_bucket || !document.file_path) return '';

  const configuredCandidates = [document.file_bucket, ...legalDocumentBucketCandidates].filter(Boolean);
  const existingBuckets = await listExistingBucketNames();
  const bucketCandidates = [...new Set(
    configuredCandidates.filter((bucket) => !existingBuckets.length || existingBuckets.includes(bucket))
  )];
  const pathCandidates = getLegalDocumentPathCandidates(document);
  const objectFromId = await resolveStorageObjectFromId(document.file_path);
  if (objectFromId?.name) {
    pathCandidates.unshift(objectFromId.name);
  }
  if (objectFromId?.bucket_id) {
    bucketCandidates.unshift(objectFromId.bucket_id);
  }
  const fileName = extractPdfFileName(document);
  const objectFromFileName = await resolveStorageObjectFromFileName(fileName, bucketCandidates);
  if (objectFromFileName?.name) {
    pathCandidates.unshift(objectFromFileName.name);
  }
  if (objectFromFileName?.bucket_id) {
    bucketCandidates.unshift(objectFromFileName.bucket_id);
  }
  let lastError = null;

  for (const bucket of bucketCandidates) {
    for (const path of pathCandidates) {
      const signedResult = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 10);

      if (!signedResult.error && signedResult.data?.signedUrl) {
        return signedResult.data.signedUrl;
      }

      if (signedResult.error && !isMissingStorageObjectError(signedResult.error)) {
        lastError = signedResult.error;
      }
    }
  }

  if (lastError) throw lastError;

  return '';
};

export const fetchActiveLegalDocuments = async () => {
  try {
    const rows = await fetchActiveLegalDocumentRows('*');
    const documents = rows
      .map((row) => normalizeLegalDocument(row))
      .filter((document) => document?.legal_document_id);
    const documentsWithPdfUrls = await Promise.all(
      documents.map(async (document) => ({
        ...document,
        pdf_url: await resolveLegalDocumentPdfUrl(document),
      }))
    );

    return { data: documentsWithPdfUrls, error: null };
  } catch (error) {
    logAppError('legal_document.fetch_all_active', error, {});
    return {
      data: [],
      error: new Error('Legal documents could not be loaded. Please try again.'),
    };
  }
};

const pickLegalDocumentByType = (rows = [], documentType = 'Terms and Conditions') => {
  const candidateKeys = new Set(
    getLegalDocumentTypeCandidates(documentType).map(normalizeLegalDocumentTypeKey)
  );

  return rows.find((row) => candidateKeys.has(normalizeLegalDocumentTypeKey(row?.document_type || row?.Document_Type))) || null;
};

const normalizeDatabaseUserId = async (userIdentifier) => {
  if (!userIdentifier) {
    return { data: null, error: new Error('User account is required.') };
  }

  if (typeof userIdentifier === 'number' || /^\d+$/.test(String(userIdentifier))) {
    return { data: Number(userIdentifier), error: null };
  }

  const result = await resolveDatabaseUserId(userIdentifier, { ensure: false });
  return { data: result.data || null, error: result.error || null };
};

export const calculateAge = (birthdate) => {
  if (!birthdate) return null;

  const parsedDate = new Date(`${String(birthdate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - parsedDate.getFullYear();
  const monthDelta = today.getMonth() - parsedDate.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < parsedDate.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : null;
};

export const getDonorCategory = (age) => {
  if (!Number.isFinite(Number(age))) return null;
  if (Number(age) >= 18) return 'Adult';
  if (Number(age) >= 13) return 'Minor';
  return 'Guardian-Managed Minor';
};

export const getDonorProfileBadge = ({ birthdate, guardianConsent = null }) => {
  if (!String(birthdate || '').trim()) {
    return null;
  }

  const age = calculateAge(birthdate);
  const category = getDonorCategory(age);
  const hasConsent = Boolean(guardianConsent?.guardian_consent_id || guardianConsent?.Guardian_Consent_ID);

  if (!category) return null;
  if (category === 'Adult') return { label: 'Adult Donor', tone: 'success', age, category };
  if (category === 'Minor') {
    return {
      label: hasConsent ? 'Minor Donor - Guardian Consent Completed' : 'Minor Donor - Guardian Consent Required',
      tone: hasConsent ? 'success' : 'warning',
      age,
      category,
    };
  }

  return {
    label: hasConsent
      ? 'Guardian-Managed Minor - Guardian Consent Completed'
      : 'Guardian-Managed Minor - Guardian Consent Required',
    tone: hasConsent ? 'success' : 'warning',
    age,
    category,
  };
};

export const mapDonationPermissionError = (reason) => {
  if (reason === DONOR_PERMISSION_REASONS.profileIncomplete) {
    return 'Please complete your donor profile, including birthdate, before continuing.';
  }
  if (reason === DONOR_PERMISSION_REASONS.guardianConsentRequired) {
    return 'Since the donor is below 18 years old, parent or guardian consent is required before hair donation submission.';
  }
  return 'We could not verify donation permissions right now. Please try again.';
};

export const fetchActiveGuardianConsent = async (userIdentifier) => {
  try {
    const userIdResult = await normalizeDatabaseUserId(userIdentifier);
    if (userIdResult.error || !userIdResult.data) {
      throw userIdResult.error || new Error('User account is required.');
    }

    const result = await supabase
      .from(guardianConsentsTable)
      .select(`
        guardian_consent_id,
        user_id,
        guardian_full_name,
        guardian_relationship,
        guardian_email,
        guardian_contact_number,
        consent_status,
        consent_method,
        consent_text_snapshot,
        minor_donation_allowed,
        ai_image_processing_allowed,
        public_posting_allowed,
        consented_at,
        revoked_at,
        guardian_id_file_path,
        consent_document_file_path,
        guardian_id_verification_status,
        guardian_id_reviewed_by,
        guardian_id_reviewed_at
      `)
      .eq('user_id', userIdResult.data)
      .eq('consent_status', 'Active')
      .eq('minor_donation_allowed', true)
      .eq('ai_image_processing_allowed', true)
      .order('consented_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) throw result.error;

    return { data: result.data || null, error: null };
  } catch (error) {
    logAppError('guardian_consent.fetch_active', error, {
      userIdentifier: userIdentifier || null,
    });
    return { data: null, error };
  }
};

export const saveGuardianConsent = async ({
  userId,
  guardianFullName,
  guardianRelationship,
  guardianEmail = '',
  guardianContactNumber,
  publicPostingAllowed = false,
  consentTextSnapshot = GUARDIAN_CONSENT_TEXT,
}) => {
  try {
    const userIdResult = await normalizeDatabaseUserId(userId);
    if (userIdResult.error || !userIdResult.data) {
      throw userIdResult.error || new Error('User account is required.');
    }

    const payload = {
      user_id: userIdResult.data,
      guardian_full_name: String(guardianFullName || '').trim(),
      guardian_relationship: String(guardianRelationship || '').trim(),
      guardian_email: String(guardianEmail || '').trim() || null,
      guardian_contact_number: String(guardianContactNumber || '').trim(),
      consent_status: 'Active',
      consent_method: 'Electronic Checkbox',
      consent_text_snapshot: String(consentTextSnapshot || GUARDIAN_CONSENT_TEXT).trim(),
      minor_donation_allowed: true,
      ai_image_processing_allowed: true,
      public_posting_allowed: Boolean(publicPostingAllowed),
      consented_at: new Date().toISOString(),
    };

    const result = await supabase
      .from(guardianConsentsTable)
      .insert([payload])
      .select('guardian_consent_id')
      .single();

    if (result.error) throw result.error;

    logAppEvent('guardian_consent.save', 'Guardian consent saved.', {
      databaseUserId: userIdResult.data,
      guardianConsentId: result.data?.guardian_consent_id || null,
      publicPostingAllowed: Boolean(publicPostingAllowed),
    });

    return { data: result.data || null, error: null };
  } catch (error) {
    logAppError('guardian_consent.save', error, {
      databaseUserId: userId || null,
    });
    return { data: null, error: new Error('Guardian consent could not be saved. Please try again.') };
  }
};

export const recordAcceptedLegalAgreements = async ({ databaseUserId, authUserId = null }) => {
  try {
    if (!databaseUserId) {
      throw new Error('User account is required.');
    }

    const rows = await fetchActiveLegalDocumentRows(`
        legal_document_id,
        document_type,
        title,
        version,
        content
      `);

    let documents = activeLegalDocumentTypes
      .map((documentType) => pickLegalDocumentByType(rows, documentType))
      .filter(Boolean);
    if (documents.length < activeLegalDocumentTypes.length) {
      documents = fallbackLegalDocumentTypes
        .map((documentType) => pickLegalDocumentByType(rows, documentType))
        .filter(Boolean);
    }

    if (!documents.length && rows.length) documents = rows.slice(0, 1);

    if (!documents.length) {
      throw new Error('Legal documents are not ready. Please contact support.');
    }

    const acceptedAt = new Date().toISOString();
    const agreementLookup = await supabase
      .from(userLegalAgreementsTable)
      .select('legal_document_id')
      .eq('user_id', databaseUserId)
      .in('legal_document_id', documents.map((document) => document.legal_document_id));

    if (agreementLookup.error) throw agreementLookup.error;

    const acceptedDocumentIds = new Set((agreementLookup.data || []).map((row) => row.legal_document_id));
    const agreementRows = documents
      .filter((document) => !acceptedDocumentIds.has(document.legal_document_id))
      .map((document) => ({
      user_id: databaseUserId,
      legal_document_id: document.legal_document_id,
      is_accepted: true,
      accepted_at: acceptedAt,
      user_agent: authUserId ? `auth_user_id:${authUserId}` : null,
    }));

    if (!agreementRows.length) {
      return { success: true, error: null };
    }

    const insertResult = await supabase
      .from(userLegalAgreementsTable)
      .insert(agreementRows);

    if (insertResult.error) throw insertResult.error;

    return { success: true, error: null };
  } catch (error) {
    logAppError('legal_agreement.save', error, {
      databaseUserId: databaseUserId || null,
      authUserId: authUserId || null,
    });
    return { success: false, error: new Error('Legal agreement could not be saved. Please try again.') };
  }
};

export const fetchActiveLegalDocument = async (documentType = 'Terms and Conditions') => {
  try {
    const rows = await fetchActiveLegalDocumentRows('*');
    const matchedRow = pickLegalDocumentByType(rows, documentType);
    const document = normalizeLegalDocument(matchedRow || null);
    if (!document?.legal_document_id) {
      return {
        data: null,
        error: new Error(`${documentType} document is not available yet.`),
      };
    }

    let pdfUrl = document.file_url || '';
    if (!pdfUrl && document.file_bucket && document.file_path) {
      pdfUrl = await resolveLegalDocumentPdfUrl(document);
    }

    return {
      data: {
        ...document,
        pdf_url: pdfUrl,
      },
      error: null,
    };
  } catch (error) {
    logAppError('legal_document.fetch_active', error, {
      documentType,
    });
    return {
      data: null,
      error: new Error(`${documentType} document could not be loaded. Please try again.`),
    };
  }
};

export const canSubmitHairDonation = async (userId) => {
  try {
    const userIdResult = await normalizeDatabaseUserId(userId);
    if (userIdResult.error || !userIdResult.data) {
      return {
        allowed: false,
        reason: DONOR_PERMISSION_REASONS.profileIncomplete,
        donorAge: null,
        guardianConsentId: null,
        donorCategory: null,
      };
    }

    const detailsResult = await supabase
      .from('user_details')
      .select('user_id, first_name, last_name, birthdate, contact_number')
      .eq('user_id', userIdResult.data)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (detailsResult.error) throw detailsResult.error;

    const details = detailsResult.data || null;
    const age = calculateAge(details?.birthdate);
    const donorCategory = getDonorCategory(age);

    if (
      !details
      || !isFilled(details.first_name)
      || !isFilled(details.last_name)
      || !isFilled(details.contact_number)
      || age === null
    ) {
      return {
        allowed: false,
        reason: DONOR_PERMISSION_REASONS.profileIncomplete,
        donorAge: age,
        guardianConsentId: null,
        donorCategory,
      };
    }

    if (age >= 18) {
      return {
        allowed: true,
        reason: null,
        donorAge: age,
        guardianConsentId: null,
        donorCategory,
      };
    }

    const consentResult = await fetchActiveGuardianConsent(userIdResult.data);
    if (consentResult.error || !consentResult.data?.guardian_consent_id) {
      return {
        allowed: false,
        reason: DONOR_PERMISSION_REASONS.guardianConsentRequired,
        donorAge: age,
        guardianConsentId: null,
        donorCategory,
      };
    }

    return {
      allowed: true,
      reason: null,
      donorAge: age,
      guardianConsentId: consentResult.data.guardian_consent_id,
      donorCategory,
    };
  } catch (error) {
    logAppError('donor_permission.can_submit', error, {
      userId: userId || null,
    });

    return {
      allowed: false,
      reason: DONOR_PERMISSION_REASONS.databaseFailure,
      donorAge: null,
      guardianConsentId: null,
      donorCategory: null,
    };
  }
};
