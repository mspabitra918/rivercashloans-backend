// Single source of truth for the hard-coded business rules. These mirror the
// frontend's src/lib/constants.ts (LOAN / BRAND) — keep the two in sync.

// Company identity used across transactional emails and SMS. Mirrors the
// frontend's BRAND object so customer-facing copy never drifts between the
// website and the messages we send.
export const BRAND = {
  name: 'Oakhill Loans',
  legalName: 'Oakhill Loans, LLC',
  domain: 'oakhillloans.com',
  website: 'https://www.oakhillloans.com',
  websiteLabel: 'www.oakhillloans.com',
  logoUrl: 'https://oakhillloans.com/logo.png',
  supportEmail: 'support@oakhillloans.com',
  // Sender shown in the "From" line of outgoing email.
  fromName: 'Oakhill Loans',
  // Display + dialable forms of the support phone number.
  phone: '888-392-2321',
  phoneTel: '+18883922321',
} as const;

export const LOAN = {
  minAmount: 2000,
  maxAmount: 50000,
  apr: 10, // % fixed APR for every applicant
  terms: [12, 24, 36, 48, 60] as const, // term lengths in months
  minMonthlyIncome: 1000, // gross; below this => auto-decline
  maxDtiPercent: 45, // DTI at/above this => manual underwriting
} as const;

// Application lifecycle statuses. The string values match the frontend's
// STATUS_TO_STAGE_INDEX map so the dashboard can render the right milestone.
export enum ApplicationStatus {
  PENDING = 'PENDING', // row default before intake completes
  APPLICATION_SUBMITTED = 'APPLICATION_SUBMITTED',
  BANK_VERIFICATION_PENDING = 'BANK_VERIFICATION_PENDING',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION', // fast-track (safe + DTI < 45%)
  MANUAL_REVIEW = 'MANUAL_REVIEW', // underwriter queue
  BANK_REJECTED = 'BANK_REJECTED', // banned routing -> correction email
  PHONE_VERIFICATION_PENDING = 'PHONE_VERIFICATION_PENDING',
  SIGN_LOAN_AGREEMENT = 'SIGN_LOAN_AGREEMENT',
  VERIFICATION_DEPOSIT = 'VERIFICATION_DEPOSIT',
  FUNDED = 'FUNDED', // terminal — set only by manual admin release
  DECLINED = 'DECLINED', // terminal off-ramp
}

export enum HousingStatus {
  RENT = 'RENT',
  OWN_MORTGAGE = 'OWN_MORTGAGE',
  OWN_PAID = 'OWN_PAID',
}

export enum AccountAge {
  LT_3M = 'LT_3M',
  M3_12 = '3_12M',
  Y1_3 = '1_3Y',
  GT_3Y = 'GT_3Y',
}

export enum Role {
  CUSTOMER = 'customer',
  UNDERWRITER = 'underwriter',
  ADMIN = 'admin',
}

// Statuses an underwriter may release funds from. The release itself is always
// a manual, human-in-the-loop action — never automated.
export const RELEASABLE_STATUSES: ApplicationStatus[] = [
  ApplicationStatus.VERIFICATION_DEPOSIT,
  ApplicationStatus.PENDING_VERIFICATION,
];
