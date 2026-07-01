import { ApplicationStatus } from './constants';

// Mirrors the frontend's LIFECYCLE_STAGES + STATUS_TO_STAGE_INDEX so the API
// can hand the dashboard a ready-to-render stage index/label. DECLINED and
// BANK_REJECTED are terminal off-ramps (index -1).
export const STATUS_TO_STAGE: Record<string, { index: number; label: string }> =
  {
    [ApplicationStatus.PENDING]: { index: 0, label: 'Application Submitted' },
    [ApplicationStatus.APPLICATION_SUBMITTED]: {
      index: 0,
      label: 'Application Submitted',
    },
    [ApplicationStatus.BANK_VERIFICATION_PENDING]: {
      index: 0,
      label: 'Application Submitted',
    },
    [ApplicationStatus.PENDING_VERIFICATION]: {
      index: 1,
      label: 'Phone Verification',
    },
    [ApplicationStatus.PHONE_VERIFICATION_PENDING]: {
      index: 1,
      label: 'Phone Verification',
    },
    [ApplicationStatus.MANUAL_REVIEW]: {
      index: 1,
      label: 'Under Review',
    },
    [ApplicationStatus.SIGN_LOAN_AGREEMENT]: {
      index: 2,
      label: 'Sign Agreement',
    },
    [ApplicationStatus.VERIFICATION_DEPOSIT]: {
      index: 3,
      label: 'Verification Deposit',
    },
    [ApplicationStatus.FUNDED]: { index: 4, label: 'Funded' },
    [ApplicationStatus.BANK_REJECTED]: { index: -1, label: 'Bank Rejected' },
    [ApplicationStatus.DECLINED]: { index: -1, label: 'Declined' },
  };
