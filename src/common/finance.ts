import { LOAN } from './constants';

/**
 * Standard fixed-rate amortized monthly payment.
 *   M = P * r / (1 - (1 + r)^-n)
 * where r is the monthly rate and n the number of months. With a 0% rate it
 * degrades to simple principal / term.
 */
export function monthlyPayment(
  principal: number,
  aprPercent: number = LOAN.apr,
  termMonths: number,
): number {
  if (termMonths <= 0) return 0;
  const r = aprPercent / 100 / 12;
  const payment =
    r === 0
      ? principal / termMonths
      : (principal * r) / (1 - Math.pow(1 + r, -termMonths));
  return round2(payment);
}

/**
 * Debt-to-income ratio as a percentage:
 *   (housing + other debts + new loan payment) / gross monthly income * 100
 * Returns a large sentinel (9999) when income is zero to avoid divide-by-zero
 * and to ensure such applications never pass the DTI gate.
 */
export function calculateDti(params: {
  monthlyHousingPayment: number;
  otherMonthlyDebts: number;
  newLoanPayment: number;
  grossMonthlyIncome: number;
}): number {
  const {
    monthlyHousingPayment,
    otherMonthlyDebts,
    newLoanPayment,
    grossMonthlyIncome,
  } = params;
  if (grossMonthlyIncome <= 0) return 9999;
  const dti =
    ((monthlyHousingPayment + otherMonthlyDebts + newLoanPayment) /
      grossMonthlyIncome) *
    100;
  return round2(dti);
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
