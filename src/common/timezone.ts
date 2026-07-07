/**
 * Application-wide time zone. Per business rule, all application timestamps for
 * rivercashloans.com are presented in US Pacific Time. We use the IANA zone (not
 * a fixed "PST" offset) so daylight saving is handled automatically — PST
 * (UTC−8) in winter, PDT (UTC−7) in summer.
 */
export const APP_TIME_ZONE = 'America/Los_Angeles';

/** Long date in Pacific time, e.g. "May 27, 2026". */
export function formatPacificLongDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: APP_TIME_ZONE,
  });
}

/** Date + time in Pacific time, e.g. "May 27, 2026, 2:14 PM PDT". */
export function formatPacificDateTime(d: Date): string {
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: APP_TIME_ZONE,
    timeZoneName: 'short',
  });
}
