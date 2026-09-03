import {
  fetchHairSubmissionLogisticsBySubmissionId,
  fetchLatestHairSubmissionByUserId,
  fetchLatestHairSubmissionDetailBySubmissionId,
} from './hairSubmission.api';
import {
  fetchLatestWigAllocationTrackingByPatientId,
  fetchLatestWigRequestTrackingByPatientId,
} from './wigRequest.api';
import { fetchPatientDetailsByUserId } from './profile/api/profile.api';

const normalizeStatusLabel = (value, fallback = 'Pending') => {
  if (!value) return fallback;
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

const formatDateTime = (value) => {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return value;
  }
};

const getToneFromStatus = (value = '') => {
  const normalized = value.toLowerCase();

  if (['approved', 'eligible', 'completed', 'released', 'received', 'ready'].some((token) => normalized.includes(token))) {
    return 'success';
  }

  if (['failed', 'rejected', 'cancelled', 'error'].some((token) => normalized.includes(token))) {
    return 'error';
  }

  return 'info';
};

const getStepState = ({ index, currentIndex, highlightedIndex = null, hasData = true }) => {
  if (!hasData) return 'upcoming';
  if (highlightedIndex === index) return 'attention';
  if (index < currentIndex) return 'completed';
  if (index === currentIndex) return 'current';
  return 'upcoming';
};

const normalizeTrackingStatusKey = (value = '') => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

// eslint-disable-next-line no-unused-vars
const buildLegacyDonorTracker = ({ submission, detail, logistics, qaAssessment = null, history = [] }) => {
  if (!submission?.submission_id) {
    return {
      tracker: null,
      error: null,
    };
  }

  const latestStatus = logistics?.shipment_status
    || detail?.status
    || submission?.status;

  const latestHistory = history?.[0] || null;
  const qaNeedsAttention = ['failed', 'rejected'].some((token) =>
    String(qaAssessment?.assessment_result || '').toLowerCase().includes(token)
  );

  const normalizedSubmissionStatus = String(submission?.status || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const hasWigStage = [
    'wig in production',
    'wiginproduction',
    'wig created',
    'wigcreated',
  ].some((token) => normalizedSubmissionStatus.includes(token));
  const currentIndex = hasWigStage ? 3 : logistics ? 2 : detail ? 1 : 0;

  const steps = [
    {
      key: 'submission',
      title: 'Submission received',
      label: normalizeStatusLabel(submission.status, 'Submitted'),
      description: `Hair submission ${submission.donation_reference || 'record'} was created on ${formatDateTime(submission.created_at)}.`,
      state: getStepState({ index: 0, currentIndex, hasData: Boolean(submission) }),
    },
    {
      key: 'logistics',
      title: 'Logistics and transport',
      label: normalizeStatusLabel(logistics?.shipment_status || logistics?.logistics_type, 'Waiting for logistics'),
      description: logistics
        ? [logistics.courier_name, logistics.tracking_number].filter(Boolean).join(' • ')
          || logistics.notes
          || 'Transport details were added to this submission.'
        : 'Pickup, courier, or drop-off details will appear here once logistics is scheduled.',
      state: getStepState({ index: 1, currentIndex, hasData: Boolean(logistics) }),
    },
    {
      key: 'qa',
      title: 'Quality assessment',
      label: normalizeStatusLabel(qaAssessment?.assessment_result || detail?.status, 'Pending review'),
      description: qaAssessment?.remarks
        || detail?.detail_notes
        || 'The bundle will move here once assessment starts.',
      state: getStepState({
        index: 2,
        currentIndex,
        highlightedIndex: qaNeedsAttention ? 2 : null,
        hasData: Boolean(qaAssessment),
      }),
    },
    {
      key: 'tracking',
      title: 'Bundle tracking',
      label: normalizeStatusLabel(latestHistory?.status, 'Waiting for tracking updates'),
      description: latestHistory?.description
        || latestHistory?.title
        || 'The latest bundle movement will appear here after QA and logistics updates.',
      state: getStepState({ index: 3, currentIndex, hasData: Boolean(latestHistory) }),
    },
  ];

  const events = [
    {
      key: `submission-${submission.submission_id}`,
      title: 'Hair submission created',
      description: `Donation reference ${submission.donation_reference || 'not available'}`,
      timestamp: formatDateTime(submission.created_at),
      badge: normalizeStatusLabel(submission.status, 'Submitted'),
    },
    logistics
      ? {
          key: `logistics-${logistics.submission_logistics_id}`,
          title: logistics.logistics_type
            ? `${normalizeStatusLabel(logistics.logistics_type)} arranged`
            : 'Logistics updated',
          description: logistics.notes
            || [logistics.courier_name, logistics.tracking_number].filter(Boolean).join(' • ')
            || 'Transport details were added for this donation.',
          timestamp: formatDateTime(
            logistics.received_at
            || logistics.pickup_approved_at
            || logistics.pickup_scheduled_at
            || logistics.created_at
          ),
          badge: normalizeStatusLabel(logistics.shipment_status || logistics.logistics_type, 'In transit'),
        }
      : null,
    qaAssessment
      ? {
          key: `qa-${qaAssessment.qa_assessment_id}`,
          title: 'Quality assessment updated',
          description: qaAssessment.remarks || 'The QA result is now available for this bundle.',
          timestamp: formatDateTime(qaAssessment.assessed_at),
          badge: normalizeStatusLabel(qaAssessment.assessment_result, 'Reviewed'),
        }
      : null,
    ...(history || []).map((entry) => ({
      key: `history-${entry.id}`,
      title: entry.title || 'Bundle update',
      description: entry.description || 'A bundle tracking update was recorded.',
      timestamp: formatDateTime(entry.updated_at),
      badge: normalizeStatusLabel(entry.status, 'Updated'),
    })),
  ].filter(Boolean);

  return {
    tracker: {
      title: 'Donation Status',
      subtitle: 'Track the latest donation progress from submission to bundle handling.',
      emptyTitle: 'No donation tracking yet',
      emptyDescription: 'Your latest hair submission will appear here after you save it.',
      summary: {
        label: normalizeStatusLabel(latestStatus, 'Submitted'),
        tone: getToneFromStatus(latestStatus || ''),
        referenceLabel: 'Donation reference',
        referenceValue: submission.donation_reference || 'Not available',
        helperText: `Last updated ${formatDateTime(
          latestHistory?.updated_at
          || qaAssessment?.assessed_at
          || logistics?.received_at
          || logistics?.pickup_approved_at
          || logistics?.pickup_scheduled_at
          || logistics?.created_at
          || submission.updated_at
          || submission.created_at
        )}`,
      },
      steps,
      events,
      watch: {
        submissionId: submission.submission_id,
        submissionDetailId: detail?.submission_detail_id || null,
      },
    },
    error: null,
  };
};

const buildDonorTracker = ({ submission, detail, logistics }) => {
  if (!submission?.submission_id) {
    return {
      tracker: null,
      error: null,
    };
  }

  const normalizedSubmissionStatus = String(submission?.status || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  const hasWigStage = [
    'wig in production',
    'wiginproduction',
    'wig created',
    'wigcreated',
  ].some((token) => normalizedSubmissionStatus.includes(token));
  const detailNeedsAttention = ['failed', 'rejected'].some((token) =>
    String(detail?.status || '').toLowerCase().includes(token)
  );
  const latestStatus = logistics?.shipment_status || detail?.status || submission?.status;
  const currentIndex = hasWigStage ? 3 : logistics ? 2 : detail ? 1 : 0;

  const steps = [
    {
      key: 'submission',
      title: 'Submission received',
      label: normalizeStatusLabel(submission.status, 'Submitted'),
      description: `Hair submission ${submission.donation_reference || 'record'} was created on ${formatDateTime(submission.created_at)}.`,
      state: getStepState({ index: 0, currentIndex, hasData: Boolean(submission) }),
    },
    {
      key: 'details',
      title: 'Donation details reviewed',
      label: normalizeStatusLabel(detail?.status, 'Pending review'),
      description: detail?.detail_notes || detail?.rejection_reason || 'Hair details will update after staff review.',
      state: getStepState({
        index: 1,
        currentIndex,
        highlightedIndex: detailNeedsAttention ? 1 : null,
        hasData: Boolean(detail),
      }),
    },
    {
      key: 'logistics',
      title: 'Logistics and transport',
      label: normalizeStatusLabel(logistics?.shipment_status || logistics?.logistics_type, 'Waiting for logistics'),
      description: logistics?.notes || 'Pickup, courier, or drop-off details will appear here once logistics is scheduled.',
      state: getStepState({ index: 2, currentIndex, hasData: Boolean(logistics) }),
    },
    {
      key: 'wig-stage',
      title: 'Wig production',
      label: normalizeStatusLabel(submission?.status, 'Waiting for production'),
      description: hasWigStage
        ? 'The donation has moved into the wig production stage.'
        : 'This step updates when staff moves the donation into wig production.',
      state: getStepState({ index: 3, currentIndex, hasData: hasWigStage }),
    },
  ];

  const events = [
    {
      key: `submission-${submission.submission_id}`,
      title: 'Hair submission created',
      description: `Donation reference ${submission.donation_reference || 'not available'}`,
      timestamp: formatDateTime(submission.created_at),
      badge: normalizeStatusLabel(submission.status, 'Submitted'),
    },
    detail
      ? {
          key: `detail-${detail.submission_detail_id}`,
          title: 'Donation details updated',
          description: detail.detail_notes || detail.rejection_reason || 'Hair submission details were reviewed.',
          timestamp: formatDateTime(detail.updated_at || detail.created_at),
          badge: normalizeStatusLabel(detail.status, 'Reviewed'),
        }
      : null,
    logistics
      ? {
          key: `logistics-${logistics.submission_logistics_id}`,
          title: logistics.logistics_type
            ? `${normalizeStatusLabel(logistics.logistics_type)} arranged`
            : 'Logistics updated',
          description: logistics.notes || 'Transport details were added for this donation.',
          timestamp: formatDateTime(logistics.received_at || logistics.created_at),
          badge: normalizeStatusLabel(logistics.shipment_status || logistics.logistics_type, 'In transit'),
        }
      : null,
  ].filter(Boolean);

  return {
    tracker: {
      title: 'Donation Status',
      subtitle: 'Track the latest donation progress from submission to staff scanning updates.',
      emptyTitle: 'No donation tracking yet',
      emptyDescription: 'Your latest hair submission will appear here after you save it.',
      summary: {
        label: normalizeStatusLabel(latestStatus, 'Submitted'),
        tone: getToneFromStatus(latestStatus || ''),
        referenceLabel: 'Donation reference',
        referenceValue: submission.donation_reference || 'Not available',
        helperText: `Last updated ${formatDateTime(
          logistics?.received_at
          || logistics?.created_at
          || detail?.updated_at
          || submission.updated_at
          || submission.created_at
        )}`,
      },
      steps,
      events,
      watch: {
        submissionId: submission.submission_id,
        submissionDetailId: detail?.submission_detail_id || null,
      },
    },
    error: null,
  };
};

const buildPatientTracker = ({ patientDetails, wigRequest, latestAllocation }) => {
  if (!patientDetails?.patient_id) {
    return {
      tracker: null,
      error: null,
    };
  }

  const wig = latestAllocation?.wigs || null;
  const releaseStatus = latestAllocation?.release_status || '';
  const requestStatus = normalizeTrackingStatusKey(wigRequest?.status);
  const fulfillmentStatus = normalizeTrackingStatusKey(wigRequest?.fulfillment_status);
  const wigStatus = normalizeTrackingStatusKey(wig?.wig_status);
  const normalizedReleaseStatus = normalizeTrackingStatusKey(releaseStatus);
  const currentStatus = wigRequest?.status || wigRequest?.fulfillment_status || releaseStatus || wig?.wig_status || '';
  const isRequestStopped = ['rejected', 'cancelled', 'canceled', 'closed'].includes(requestStatus);
  const isApproved = Boolean(
    wigRequest?.approved_at
    || requestStatus.startsWith('accepted')
    || ['approved', 'preparing', 'production', 'ready', 'release', 'released'].some((token) => requestStatus.includes(token))
  );
  const hasActiveRequest = Boolean(
    wigRequest?.req_id
    && !['completed', 'claimed', 'released', 'cancelled', 'canceled', 'rejected', 'closed']
      .some((token) => requestStatus.includes(token))
  );
  const hasAllocation = Boolean(
    latestAllocation?.allocation_id
    || wigRequest?.allocated_wig_id
    || requestStatus.includes('wig allocated')
    || ['allocated', 'bundle matched', 'wig matched'].some((token) => fulfillmentStatus.includes(token))
  );
  const hasWig = Boolean(wig?.wig_id || wig?.id || wigRequest?.allocated_wig_id);
  const isInProduction = Boolean(
    requestStatus.includes('production')
    || requestStatus.includes('preparing')
    || fulfillmentStatus.includes('production')
    || fulfillmentStatus.includes('preparing')
    || wigStatus.includes('production')
    || wigStatus.includes('preparing')
  );
  const isSentToHospital = Boolean(
    latestAllocation?.released_at
    || ['to be release', 'releasing', 'ready for pick up'].includes(requestStatus)
    || ['sent', 'transit', 'releasing', 'released', 'delivered'].some((token) => normalizedReleaseStatus.includes(token))
    || ['distribution', 'dispatch', 'in transit', 'ready for pick up'].some((token) => fulfillmentStatus.includes(token))
  );
  const isReadyForClaiming = Boolean(
    requestStatus === 'released'
    || ['ready', 'claim', 'received', 'completed', 'delivered'].some((token) => normalizedReleaseStatus.includes(token))
    || ['released', 'received', 'completed', 'delivered'].some((token) => fulfillmentStatus.includes(token))
  );

  const currentIndex = isReadyForClaiming
    ? 5
    : isSentToHospital
      ? 4
      : hasWig || isInProduction || wigStatus.includes('progress')
        ? 3
        : hasAllocation
          ? 2
          : isApproved || wigRequest?.req_id
            ? 1
            : 0;

  const steps = [
    {
      key: 'request-submitted',
      title: 'Request submitted',
      label: wigRequest?.req_id ? 'Submitted' : 'Waiting for request',
      description: wigRequest?.request_date
        ? `Request date ${formatDateTime(wigRequest.request_date)}`
        : 'Your wig request will appear here after submission.',
      state: getStepState({ index: 0, currentIndex, hasData: Boolean(wigRequest) }),
    },
    {
      key: 'approval',
      title: isApproved ? 'Request approved' : 'Waiting for approval',
      label: normalizeStatusLabel(wigRequest?.status, 'Pending approval'),
      description: isApproved
        ? `Approved ${formatDateTime(wigRequest?.approved_at || wigRequest?.updated_at)}`
        : 'The organization will review your wig request.',
      state: getStepState({ index: 1, currentIndex, hasData: Boolean(wigRequest) }),
    },
    {
      key: 'donor-match',
      title: 'Looking for wig donor',
      label: hasAllocation ? 'Donor bundle matched' : 'Matching in progress',
      description: wig?.wig_name
        ? `${wig.wig_name}${wig.wig_code ? ` • ${wig.wig_code}` : ''}`
        : 'A matching update appears here once a wig is linked to your request.',
      state: getStepState({ index: 2, currentIndex, hasData: hasAllocation }),
    },
    {
      key: 'preparing',
      title: 'Preparing wig',
      label: normalizeStatusLabel(wig?.wig_status, hasWig ? 'Preparing' : 'Waiting for wig record'),
      description: latestAllocation?.notes
        || (latestAllocation?.allocated_at
          ? `Allocated on ${formatDateTime(latestAllocation.allocated_at)}`
          : 'Preparation details appear here after wig production starts.'),
      state: getStepState({ index: 3, currentIndex, hasData: hasWig }),
    },
    {
      key: 'sent-hospital',
      title: 'Wig sent to hospital',
      label: normalizeStatusLabel(releaseStatus, 'Waiting for release'),
      description: latestAllocation?.released_at
        ? `Sent on ${formatDateTime(latestAllocation.released_at)}`
        : latestAllocation?.notes || 'Hospital release details will appear here.',
      state: getStepState({ index: 4, currentIndex, hasData: isSentToHospital }),
    },
    {
      key: 'ready-claiming',
      title: 'Ready for claiming',
      label: isReadyForClaiming ? 'Ready' : 'Not ready yet',
      description: isReadyForClaiming
        ? 'Please wait for hospital claiming instructions.'
        : 'The hospital will update this step once the wig is ready for claiming.',
      state: getStepState({ index: 5, currentIndex, hasData: isReadyForClaiming }),
    },
  ];

  const patientCurrentIndex = isReadyForClaiming
    ? 3
    : isSentToHospital
      ? 2
      : isApproved || hasAllocation || hasWig || isInProduction
        ? 1
        : 0;
  const patientSteps = steps.length ? [
    {
      key: 'approval',
      title: isRequestStopped ? normalizeStatusLabel(wigRequest?.status, 'Request closed') : 'Waiting for approval',
      label: isApproved ? 'Approved' : normalizeStatusLabel(wigRequest?.status, 'Pending'),
      description: isRequestStopped
        ? wigRequest?.status_reason || 'This request is no longer active.'
        : isApproved
        ? `Approved ${formatDateTime(wigRequest?.approved_at || wigRequest?.updated_at)}`
        : 'Reviewing your request.',
      state: getStepState({
        index: 0,
        currentIndex: patientCurrentIndex,
        highlightedIndex: isRequestStopped ? 0 : null,
        hasData: Boolean(wigRequest),
      }),
    },
    {
      key: 'preparing',
      title: 'Preparing wig',
      label: normalizeStatusLabel(
        isInProduction ? wigRequest?.status : wigRequest?.fulfillment_status,
        hasAllocation || hasWig ? 'In progress' : 'Waiting'
      ),
      description: wigRequest?.status_reason || latestAllocation?.notes
        || (latestAllocation?.allocated_at
          ? `Allocated ${formatDateTime(latestAllocation.allocated_at)}`
          : wig?.wig_name || 'Preparing your wig.'),
      state: getStepState({ index: 1, currentIndex: patientCurrentIndex, hasData: Boolean(isApproved || hasAllocation || hasWig || isInProduction) }),
    },
    {
      key: 'dropoff',
      title: 'Distributing to dropoff point',
      label: normalizeStatusLabel(wigRequest?.status || releaseStatus, 'Waiting'),
      description: latestAllocation?.released_at
        ? `Sent ${formatDateTime(latestAllocation.released_at)}`
        : 'Delivery update will appear here.',
      state: getStepState({ index: 2, currentIndex: patientCurrentIndex, hasData: isSentToHospital }),
    },
    {
      key: 'received',
      title: 'Received by patient',
      label: isReadyForClaiming ? 'Received' : 'Not yet',
      description: isReadyForClaiming
        ? 'Wig received.'
        : 'Marked once you receive it.',
      state: getStepState({ index: 3, currentIndex: patientCurrentIndex, hasData: isReadyForClaiming }),
    },
  ] : [];

  const events = [
    wigRequest
      ? {
          key: `wig-request-${wigRequest.req_id}`,
          title: 'Wig request submitted',
          description: wigRequest.status_reason || wigRequest.notes || 'Your wig preferences were saved to the request.',
          timestamp: formatDateTime(wigRequest.updated_at || wigRequest.request_date),
          badge: normalizeStatusLabel(wigRequest.status, 'Pending'),
        }
      : null,
    wig
      ? {
          key: `wig-${wig.id}`,
          title: 'Wig record updated',
          description: wig.wig_name || 'A wig was linked to your request.',
          timestamp: formatDateTime(wig.completed_at || wig.updated_at),
          badge: normalizeStatusLabel(wig.wig_status, 'In progress'),
        }
      : null,
    latestAllocation
      ? {
          key: `allocation-${latestAllocation.allocation_id}`,
          title: latestAllocation.released_at ? 'Wig released' : 'Wig allocated',
          description: latestAllocation.notes || 'Allocation details were updated for your request.',
          timestamp: formatDateTime(latestAllocation.released_at || latestAllocation.allocated_at),
          badge: normalizeStatusLabel(releaseStatus || 'Allocated', 'Allocated'),
        }
      : null,
  ].filter(Boolean);

  return {
    tracker: {
      hasActiveRequest,
      title: 'Wig Request Status',
      subtitle: 'Follow your wig request from submission to hospital claiming.',
      emptyTitle: 'No wig tracking yet',
      emptyDescription: 'Your wig request status will appear here after the first request is saved.',
      summary: {
        label: normalizeStatusLabel(currentStatus, 'Waiting for request'),
        tone: getToneFromStatus(currentStatus || ''),
        referenceLabel: wigRequest?.request_code ? 'Request code' : 'Patient code',
        referenceValue: wigRequest?.request_code || patientDetails.patient_code || 'Not assigned',
        helperText: latestAllocation?.allocated_at
          ? `Latest allocation ${formatDateTime(latestAllocation.allocated_at)}`
          : wigRequest?.request_date
            ? `Request date ${formatDateTime(wigRequest.request_date)}`
            : 'Waiting for the first wig request.',
      },
      steps: patientSteps,
      events,
      watch: {
        patientId: patientDetails.patient_id,
        reqId: wigRequest?.req_id || null,
        wigId: wig?.id || null,
      },
    },
    error: null,
  };
};

export const getProcessTracking = async ({ role, userId }) => {
  try {
    if (!userId) {
      throw new Error('Your session is not ready.');
    }

    if (role === 'donor') {
      const { data: submission, error: submissionError } = await fetchLatestHairSubmissionByUserId(userId);
      if (submissionError) {
        throw new Error(submissionError.message || 'Unable to load donor tracking.');
      }

      if (!submission?.id) {
        return { tracker: null, error: null };
      }

      const { data: detail, error: detailError } = await fetchLatestHairSubmissionDetailBySubmissionId(submission.submission_id);
      if (detailError) {
        throw new Error(detailError.message || 'Unable to load donor tracking details.');
      }

      const { data: logistics, error: logisticsError } = await fetchHairSubmissionLogisticsBySubmissionId(submission.submission_id);

      if (logisticsError) throw new Error(logisticsError.message || 'Unable to load logistics updates.');

      return buildDonorTracker({
        submission,
        detail,
        logistics,
      });
    }

    if (role === 'patient') {
      const { data: patientDetails, error: patientDetailsError } = await fetchPatientDetailsByUserId(userId);
      if (patientDetailsError) {
        throw new Error(patientDetailsError.message || 'Unable to load patient details.');
      }

      if (!patientDetails?.patient_id) {
        return { tracker: null, error: null };
      }

      const [{ data: wigRequest, error: wigRequestError }, { data: latestAllocation, error: allocationError }] =
        await Promise.all([
          fetchLatestWigRequestTrackingByPatientId(patientDetails.patient_id),
          fetchLatestWigAllocationTrackingByPatientId(patientDetails.patient_id),
        ]);

      if (wigRequestError) throw new Error(wigRequestError.message || 'Unable to load wig request tracking.');
      if (allocationError) throw new Error(allocationError.message || 'Unable to load wig allocation tracking.');

      return buildPatientTracker({
        patientDetails,
        wigRequest,
        latestAllocation,
      });
    }

    return { tracker: null, error: null };
  } catch (error) {
    return {
      tracker: null,
      error: error.message || 'Unable to load process tracking.',
    };
  }
};
