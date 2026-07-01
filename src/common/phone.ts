// Single source of truth for phone formatting. Numbers are stored AND looked
// up in E.164 (+1XXXXXXXXXX) so the value written at signup matches the value
// the OTP login resolves — see users.service (create) and auth.service (OTP).
export function toE164US(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  // Strip a leading US country code if the caller already included it.
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return `+1${local}`;
}
