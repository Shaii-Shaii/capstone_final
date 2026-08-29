import React from 'react';
import { FeedbackFlowScreen } from '../../src/components/feedback/FeedbackFlowScreen';
import { donorDashboardNavItems } from '../../src/constants/dashboard';
import { submitDonorFeedback } from '../../src/features/feedback.api';

const submitRequest = ({ databaseUserId, feedbackType, message }) => submitDonorFeedback({
  databaseUserId,
  feedbackType,
  message,
  sourceRoute: '/donor/feedback',
});

export default function DonorFeedbackScreen() {
  return (
    <FeedbackFlowScreen
      role="donor"
      navItems={donorDashboardNavItems}
      notificationsRoute="/donor/notifications"
      submitRequest={submitRequest}
    />
  );
}
