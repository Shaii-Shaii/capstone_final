import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { logAppError, logAppEvent } from '../utils/appErrors';
import {
    buildDonationCertificatePayload,
    buildDonationSubmittedNotification,
    validateQrCodeScan,
} from './donationLogisticsFlow.service';
import {
    buildDonationNotification,
    buildDonationTrackingQrPayload,
    buildQrImageUrl,
    recordNotifications,
    sendDonorQrEmail,
} from './donorDonations.service';
import {
    createHairBundleTrackingEntry,
    createHairSubmission,
    createHairSubmissionDetail,
    createHairSubmissionImages,
    createHairSubmissionLogistics,
    fetchHairSubmissionForEventByUserId,
    fetchLatestEligibleAiScreeningByUserId,
    updateHairSubmissionById,
    uploadHairSubmissionImage,
} from './hairSubmission.api';
import { hairSubmissionStorageBucket } from './hairSubmission.constants';
import { notificationTypes } from './notification.constants';

const QR_IMAGE_SIZE = 512;
const SCAN_STAGE_METADATA = {
  event_rsvp: {
    title: 'RSVP / Event check-in scanned',
    description: 'Staff scanned the RSVP QR and confirmed donor participation.',
  },
  waybill_ready: {
    title: 'Waybill issued',
    description: 'Staff issued the waybill QR for bundle attachment.',
  },
  cut_and_shipped: {
    title: 'Cut & shipped',
    description: 'Staff scanned the waybill after cut and marked the parcel as shipped.',
  },
  sent_by_donor: {
    title: 'Sent by donor',
    description: 'Staff confirmed the donor parcel has been shipped with the waybill.',
  },
  received_by_company: {
    title: 'Received by Hair for Hope',
    description: 'Staff scanned the waybill upon receiving the parcel at destination.',
  },
  qa_assessment: {
    title: 'QA Assessment',
    description: 'QA Stylist scanned and recorded hair quality assessment result.',
  },
  bundling: {
    title: 'For bundling',
    description: 'Hair passed QA and is queued for bundling.',
  },
  wig_production: {
    title: 'Wig production',
    description: 'Bundled hair entered wig production workflow.',
  },
  wig_completed: {
    title: 'Wig completed',
    description: 'Wig production completed for this donation lineage.',
  },
  assigned_to_patient: {
    title: 'Assigned to patient',
    description: 'Completed wig was assigned to a patient.',
  },
  received_by_patient: {
    title: 'Received by patient',
    description: 'The patient has received the wig from this donation lineage.',
  },
};

/**
 * Complete Donation Submission Process
 * 
 * This handles:
 * 1. Creating submission record with logistics
 * 2. Uploading hair photo
 * 3. Generating QR code
 * 4. Notifying staff
 * 5. Creating tracking entry
 */
export const submitDonation = async ({
  userId = '',
  userProfile = {},
  donationDetails = {},
  hairPhotoPath = '',
  hairPhotoFileName = '',
  sourceType = 'independent_donation',
  driveId = null,
  organizationId = null,
} = {}) => {
  try {
    logAppEvent('donation_logistics', 'Starting donation submission');

    // Validate inputs
    if (!userId || !donationDetails.hairLengthValue || !hairPhotoPath) {
      throw new Error('Missing required donation information');
    }

    const screeningResult = await fetchLatestEligibleAiScreeningByUserId(userId);
    if (screeningResult.error || !screeningResult.data?.ai_screening_id) {
      throw screeningResult.error || new Error('Pass Hair Analysis before starting a donation.');
    }

    // Event submissions are created by the database only after staff check-in.
    // Logistics submissions begin here because this action confirms the method.
    const submissionResult = driveId
      ? await fetchHairSubmissionForEventByUserId({
          userId,
          eventRequestId: driveId,
        })
      : await createHairSubmission({
          user_id: userId,
          ai_screening_id: screeningResult.data.ai_screening_id,
          donation_drive_id: null,
          donation_reference: null,
          donation_source: sourceType,
          donor_notes: `Donation from logistics flow - ${donationDetails.hairLengthValue}${donationDetails.hairLengthUnit}`,
          status: 'Pending',
        });

    if (submissionResult.error || !submissionResult.data?.submission_id) {
      throw submissionResult.error || new Error(
        driveId
          ? 'Event donation starts only after staff checks in the donor as present.'
          : 'Unable to create donation submission'
      );
    }

    const createdSubmission = submissionResult.data;
    const donationReference = createdSubmission.donation_reference || `DON-${createdSubmission.submission_id}`;
    const syncedSubmissionResult = createdSubmission.donation_reference
      ? { data: createdSubmission, error: null }
      : await updateHairSubmissionById(createdSubmission.submission_id, {
          donation_reference: donationReference,
          qr_status: 'Generated',
          qr_generated_at: new Date().toISOString(),
        });
    const qrSubmission = syncedSubmissionResult.data || {
      ...createdSubmission,
      donation_reference: donationReference,
      qr_status: 'Generated',
    };

    logAppEvent('donation_logistics', 'Hair submission created', { donationReference, submissionId: createdSubmission.submission_id });

    // Create submission detail
    const detailResult = await createHairSubmissionDetail({
      submission_id: createdSubmission.submission_id,
      declared_length: donationDetails.hairLengthValue || null,
      declared_color: donationDetails.detectedColor || null,
      declared_texture: donationDetails.detectedTexture || null,
      declared_density: donationDetails.detectedDensity || null,
      declared_condition: 'Pending review',
      is_chemically_treated: donationDetails.isChemicallyTreated || false,
      is_colored: donationDetails.isColored || false,
      is_bleached: donationDetails.isBeached || false,
      is_rebonded: donationDetails.isRebonded || false,
      detail_notes: donationDetails.recentAssessmentMetadata ? 'Auto-filled from recent assessment' : 'Donor provided details',
      status: 'Pending',
    });

    if (detailResult.error || !detailResult.data?.submission_detail_id) {
      throw detailResult.error || new Error('Unable to create submission detail');
    }

    const createdDetail = detailResult.data;
    const qrPayload = buildDonationTrackingQrPayload({
      submission: qrSubmission,
      detail: createdDetail,
    });
    const qrCodeUrl = buildQrImageUrl(qrPayload, QR_IMAGE_SIZE);
    const donorName = `${userProfile?.first_name || ''} ${userProfile?.last_name || ''}`.trim();

    // Upload hair photo if path provided
    if (hairPhotoPath) {
      try {
        // Read file into ArrayBuffer
        const response = await fetch(hairPhotoPath);
        if (!response.ok) throw new Error('Failed to read hair photo');
        const fileBody = await response.arrayBuffer();
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const fileName = hairPhotoFileName || `donation_${Date.now()}.jpg`;
        const filePath = `${userId}/${createdSubmission.submission_id}/donation-${createdDetail.submission_detail_id}-${Date.now()}.${fileName.split('.').pop()}`;

        const uploadResult = await uploadHairSubmissionImage({
          path: filePath,
          fileBody,
          contentType,
          bucket: hairSubmissionStorageBucket,
        });

        if (uploadResult.error) {
          logAppError('donation_logistics', uploadResult.error);
        } else {
          await createHairSubmissionImages([{
            submission_detail_id: createdDetail.submission_detail_id,
            file_path: filePath,
            image_type: 'donation_hair_photo',
          }]);
        }
      } catch (photoErr) {
        logAppError('donation_logistics', photoErr);
        // Continue even if photo upload fails
      }
    }

    // Event donations already happen at the event and must never receive a
    // logistics extension. Independent donations keep exactly one child row.
    const logisticsRecord = driveId
      ? { data: null, error: null }
      : await createHairSubmissionLogistics({
          submission_id: createdSubmission.submission_id,
          logistics_type: 'Courier',
          shipment_status: 'Pending',
          notes: 'Donation submitted via logistics flow. QR attached.',
        });

    if (logisticsRecord.error) {
      throw logisticsRecord.error;
    }

    if (logisticsRecord.data) {
      logAppEvent('donation_logistics', 'Logistics record saved', {
        donationReference,
        logisticsId: logisticsRecord.data.submission_logistics_id,
      });
    }

    // Create bundle tracking entry
    try {
      await createHairBundleTrackingEntry({
        user_id: userId,
        submission_id: createdSubmission.submission_id,
        submission_detail_id: createdDetail.submission_detail_id,
        status: 'donation_submitted',
        title: 'Donation submitted',
        description: 'Donation submitted. QR generated from Hair_Submissions for staff scanning.',
        changed_by: userId,
      });

      logAppEvent('donation_logistics', 'Bundle tracking entry created');
    } catch (trackErr) {
      logAppError('donation_logistics', trackErr);
    }

    // Build notification for staff
    const staffNotification = buildDonationSubmittedNotification({
      donorId: userId,
      donorName,
      donationReference,
      donationDetails,
      qrCodeUrl,
    });

    // Record notification
    try {
      await recordNotifications({
        userId,
        role: 'donor',
        notifications: [
          buildDonationNotification({
            dedupeKey: `donation_submitted_${donationReference}`,
            type: notificationTypes.logisticsUpdated,
            title: staffNotification.title,
            message: staffNotification.message,
            referenceId: createdSubmission.submission_id,
          }),
        ],
      });

      logAppEvent('donation_logistics', 'Staff notification recorded');
    } catch (notifErr) {
      logAppError('donation_logistics', notifErr);
    }

    try {
      await sendDonorQrEmail({
        donorName,
        submission: qrSubmission,
        details: [createdDetail],
        titlePrefix: 'Donation logistics QR',
      });
      logAppEvent('donation_logistics', 'Donor QR email requested');
    } catch (emailErr) {
      logAppError('donation_logistics/qr_email', emailErr);
    }

    return {
      success: true,
      donationReference,
      qrCodeUrl,
      logisticsRecord,
      staffNotification,
    };
  } catch (err) {
    logAppError('submitDonation', err);
    throw err;
  }
};

/**
 * Generate printable QR code PDF
 */
export const generateDonationQrPdf = async ({
  donationReference = '',
  qrCodeUrl = '',
  donorName = '',
  hairLength = 0,
  bundleQuantity = 0,
} = {}) => {
  try {
    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .container { max-width: 600px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 30px; }
            .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
            .qr-section { text-align: center; margin: 30px 0; }
            .qr-image { max-width: 300px; margin: 20px 0; }
            .details { margin: 20px 0; font-size: 14px; }
            .detail-row { margin: 10px 0; padding: 5px; border-bottom: 1px solid #eee; }
            .label { font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="title">Donation QR Code</div>
              <p>Attach this to your hair donation package</p>
            </div>
            
            <div class="qr-section">
              <img src="${qrCodeUrl}" class="qr-image" alt="Donation QR Code" />
            </div>
            
            <div class="details">
              <div class="detail-row">
                <span class="label">Donation reference:</span> ${donationReference}
              </div>
              <div class="detail-row">
                <span class="label">Donor Name:</span> ${donorName || 'Anonymous'}
              </div>
              <div class="detail-row">
                <span class="label">Hair Length:</span> ${hairLength} inches
              </div>
              <div class="detail-row">
                <span class="label">Bundle Quantity:</span> ${bundleQuantity}
              </div>
              <div class="detail-row">
                <span class="label">Generated:</span> ${new Date().toLocaleDateString()}
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const result = await Print.printToFileAsync({
      html: htmlContent,
      fileName: `donation_qr_${donationReference}`,
    });

    logAppEvent('donation_logistics', 'QR PDF generated');
    return result;
  } catch (err) {
    logAppError('generateDonationQrPdf', err);
    throw err;
  }
};

/**
 * Share QR code PDF
 */
export const shareDonationQrPdf = async (pdfUri) => {
  try {
    if (!pdfUri) throw new Error('No PDF URI provided');

    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share Donation QR Code',
      UTI: 'com.adobe.pdf',
    });

    logAppEvent('donation_logistics', 'QR PDF shared');
  } catch (err) {
    logAppError('shareDonationQrPdf', err);
    throw err;
  }
};

/**
 * Staff: Scan and validate QR code
 */
export const processDonationQrScan = async ({
  qrData = '',
  staffId = '',
  scanTimestamp = null,
  scanStage = '',
  qaDecision = '',
} = {}) => {
  try {
    logAppEvent('donation_logistics', 'Processing QR scan');

    if (!qrData) {
      throw new Error('No QR data to process');
    }

    // Parse QR payload
    let qrPayload;
    try {
      qrPayload = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
    } catch {
      throw new Error('Invalid QR code format');
    }

    // Validate QR code
    const validation = validateQrCodeScan({
      qrPayload: {
        ...qrPayload,
        donationReference: qrPayload.donationReference || qrPayload.donation_reference,
      },
    });
    if (!validation.isValid) {
      return {
        success: false,
        errors: validation.errors,
        validationTimestamp: validation.validationTimestamp,
      };
    }

    try {
      const normalizedStage = String(scanStage || '').trim().toLowerCase();
      const stageMeta = SCAN_STAGE_METADATA[normalizedStage] || null;
      const submissionId = Number(qrPayload?.submissionId || qrPayload?.submission_id || 0) || null;
      const submissionDetailId = Number(qrPayload?.submissionDetailId || qrPayload?.submission_detail_id || 0) || null;

      if (submissionId && stageMeta) {
        const qaText = String(qaDecision || '').trim();
        const description = normalizedStage === 'qa_assessment' && qaText
          ? `${stageMeta.description} Decision: ${qaText}.`
          : stageMeta.description;

        await createHairBundleTrackingEntry({
          submission_id: submissionId,
          submission_detail_id: submissionDetailId,
          status: normalizedStage,
          title: stageMeta.title,
          description,
          changed_by: staffId || null,
        });
      }

      logAppEvent('donation_logistics', 'QR scan processed', { donationReference: qrPayload.donationReference });
    } catch (updateErr) {
      logAppError('donation_logistics', updateErr);
    }

    return {
      success: true,
      qrPayload,
      processingTimestamp: validation.validationTimestamp,
      message: 'Donation received successfully',
    };
  } catch (err) {
    logAppError('processDonationQrScan', err);
    return {
      success: false,
      errors: [err.message || 'Failed to process QR scan'],
    };
  }
};

/**
 * Generate donation certificate after verification
 */
export const generateDonationCertificate = async ({
  donationReference = '',
  donorId = '',
  donorName = '',
  donationDate = '',
  bundleQuantity = 0,
  hairLength = 0,
  hairLengthUnit = 'in',
} = {}) => {
  try {
    const certificateData = buildDonationCertificatePayload({
      donorId,
      donorName,
      donationDate: donationDate || new Date().toISOString(),
      bundleQuantity,
      hairLength,
      hairLengthUnit,
    });

    const htmlContent = `
      <html>
        <head>
          <style>
            body {
              font-family: 'Georgia', serif;
              margin: 0;
              padding: 40px;
              background: linear-gradient(135deg, #f5e6e8 0%, #e8dfe5 100%);
            }
            .certificate {
              background: white;
              border: 3px solid #8b4a5f;
              border-radius: 20px;
              padding: 60px;
              text-align: center;
              box-shadow: 0 10px 30px rgba(0,0,0,0.1);
              max-width: 800px;
              margin: 0 auto;
            }
            .header {
              border-bottom: 2px solid #8b4a5f;
              padding-bottom: 20px;
              margin-bottom: 40px;
            }
            .title {
              font-size: 48px;
              color: #8b4a5f;
              font-weight: bold;
              margin: 0;
            }
            .subtitle {
              font-size: 18px;
              color: #666;
              margin-top: 10px;
            }
            .body {
              margin: 40px 0;
              font-size: 16px;
              line-height: 1.8;
              color: #333;
            }
            .donor-name {
              font-size: 32px;
              font-weight: bold;
              color: #8b4a5f;
              margin: 20px 0;
            }
            .details {
              margin: 30px 0;
              font-size: 14px;
              color: #666;
            }
            .detail-line {
              margin: 8px 0;
            }
            .footer {
              margin-top: 40px;
              border-top: 2px solid #8b4a5f;
              padding-top: 20px;
              font-size: 12px;
              color: #999;
            }
            .certificate-id {
              font-family: monospace;
              font-size: 11px;
              margin-top: 10px;
            }
          </style>
        </head>
        <body>
          <div class="certificate">
            <div class="header">
              <h1 class="title">Certificate of Donation</h1>
              <p class="subtitle">Hair for Wig Generation</p>
            </div>
            
            <div class="body">
              <p>This is to certify that</p>
              <div class="donor-name">${donorName || 'Anonymous Donor'}</div>
              <p>has generously contributed to our hair donation initiative</p>
            </div>
            
            <div class="details">
              <div class="detail-line">
                <strong>Donation Date:</strong> ${new Date(donationDate).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
              <div class="detail-line">
                <strong>Hair Length:</strong> ${hairLength} ${hairLengthUnit}
              </div>
              <div class="detail-line">
                <strong>Bundle Quantity:</strong> ${bundleQuantity}
              </div>
              <div class="detail-line">
                <strong>Donation reference:</strong> ${donationReference}
              </div>
            </div>
            
            <div class="footer">
              <p>Your generous donation will help provide quality wigs to those in need.</p>
              <div class="certificate-id">
                Certificate ID: ${certificateData.certificateId}
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const pdfResult = await Print.printToFileAsync({
      html: htmlContent,
      fileName: `certificate_${donationReference}`,
    });

    logAppEvent('donation_logistics', 'Certificate generated', { donationReference });

    return {
      certificateData,
      pdfUri: pdfResult.uri,
      fileName: pdfResult.fileName,
    };
  } catch (err) {
    logAppError('generateDonationCertificate', err);
    throw err;
  }
};

/**
 * Share certificate PDF
 */
export const shareDonationCertificate = async (pdfUri, certificateId = '') => {
  try {
    if (!pdfUri) throw new Error('No PDF URI provided');

    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share Your Donation Certificate',
      UTI: 'com.adobe.pdf',
    });

    logAppEvent('donation_logistics', 'Certificate shared');
  } catch (err) {
    logAppError('shareDonationCertificate', err);
    throw err;
  }
};

/**
 * Get donation summary for tracking
 */
export const getDonationSummary = async (donationReference = '') => {
  try {
    if (!donationReference) throw new Error('Donation reference required');

    // This would fetch from the database
    // const summary = await fetchDonationSummary(donationReference);

    return {
      donationReference,
      status: 'pending', // Would be actual status from DB
      createdAt: new Date().toISOString(),
      // Additional fields would come from DB
    };
  } catch (err) {
    logAppError('getDonationSummary', err);
    throw err;
  }
};
