import { FeedbackFlowScreen } from '../../src/components/feedback/FeedbackFlowScreen';
import { patientDashboardNavItems } from '../../src/constants/dashboard';
import { submitFeedback } from '../../src/features/feedback.api';

const submitRequest = ({ databaseUserId, feedbackType, message }) => submitFeedback({
  databaseUserId,
  feedbackType,
  message,
  appRole: 'patient',
  sourceRoute: '/patient/feedback',
});

export default function PatientFeedbackScreen() {
  return (
    <FeedbackFlowScreen
      role="patient"
      navItems={patientDashboardNavItems}
      notificationsRoute="/patient/notifications"
      submitRequest={submitRequest}
    />
  );
}
