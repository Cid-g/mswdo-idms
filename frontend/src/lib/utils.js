import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** Compute age from birthdate — age is NEVER stored, always computed */
export function computeAge(birthdate) {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  const now  = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

/** Format ISO date for display: "January 15, 1990" */
export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
    ...opts,
  });
}

/** Format ISO date as short: "May 15, 2026" */
export function formatDateShort(dateStr) {
  return formatDate(dateStr, { month: 'short' });
}

/** Convert ISO date string to YYYY-MM-DD for <input type="date">.
 *  Uses LOCAL date parts (not toISOString) so a stored timestamp never shifts
 *  to the previous/next day across timezones. */
export function toDateInput(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Get the primary display ID number for an applicant */
export function getPrimaryId(applicant) {
  if (!applicant) return { label: 'ID', value: '—' };
  switch (applicant.department) {
    case 'PWD':            return { label: 'Control No.', value: applicant.controlNumber ?? '—' };
    case 'SENIOR_CITIZEN': return { label: 'OSCA No.',    value: applicant.seniorCitizen?.oscaNumber ?? '—' };
    case 'SOLO_PARENT':    return { label: 'Case No.',    value: applicant.soloParent?.caseNumber ?? '—' };
    default:               return { label: 'ID',          value: '—' };
  }
}
