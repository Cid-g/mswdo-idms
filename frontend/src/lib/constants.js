export const DEPARTMENTS = ['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN'];

export const ROLES = ['SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF'];

export const APPLICANT_STATUS = ['PARTIAL', 'COMPLETE', 'REVOKED'];

export const SEX = ['M', 'F'];

export const CIVIL_STATUS = [
  'Single', 'Married', 'Separated', 'Widow/er', 'Annulled', 'Cohabitation', 'Divorced',
];

export const BARANGAYS = [
  'Abagon', 'Amacalan', 'Apsayan', 'Ayson', 'Bawa', 'Buenlag', 'Bularit', 'Calayaan',
  'Carbonel', 'Cardona', 'Caturay', 'Danzo', 'Dicolor', 'Don Basilio', 'Luna', 'Mabini',
  'Magaspac', 'Malayep', 'Matapitap', 'Matayuncab', 'New Salem', 'Oloybuaya', 'Padapada',
  'Parsolingan', 'Pinasling', 'Plastado', 'Poblacion 1', 'Poblacion 2', 'Poblacion 3',
  'Quezon', 'Rizal', 'Salapungan', 'San Agustin', 'San Antonio', 'San Bartolome',
  'San Jose', 'Sta. Lucia', 'Santiago', 'Sembrano', 'Singat', 'Sulipa', 'Tagumbao',
  'Tangcaran', 'Villa Paz',
];

export const PWD_DISABILITY_TYPES = [
  '1. Deaf or Hard of Hearing',
  '2. Intellectual Disability',
  '3. Learning Disability',
  '4. Mental Disability',
  '5. Physical Disability (Orthopedic)',
  '6. Psychosocial Disability',
  '7. Speech and Language Impairment',
  '8. Visual Disability',
  '9. Cancer (R.A. 11215)',
  '10. Rare Disease (R.A. 10747)',
];

export const SOLO_PARENT_CATEGORIES = [
  { code: 'A1', label: 'Birth of a child as a consequence of rape' },
  { code: 'A2', label: 'Widow / Widower' },
  { code: 'A3', label: 'Spouse of person deprived of liberty' },
  { code: 'A4', label: 'Spouse of person with physical or mental incapacity' },
  { code: 'A5', label: 'Due to legal separation or de facto separation' },
  { code: 'A6', label: 'Due to nullity or annulment of marriage' },
  { code: 'A7', label: 'Abandonment by the spouse' },
  { code: 'B1', label: 'Spouse of OFW' },
  { code: 'B2', label: 'Relative of OFW' },
  { code: 'C',  label: 'Unmarried person' },
  { code: 'D',  label: 'Legal guardian / Adoptive parent / Foster parent' },
  { code: 'E',  label: 'Relative within the fourth (4th) civil degree of consanguinity or affinity' },
  { code: 'F',  label: 'Pregnant woman' },
];

export const PENSION_TYPES = ['socpen', 'local socpen', 'SSS', 'GSIS', 'PVAO', 'Socpen/SSS', 'None'];

export const SC_REGISTRATION_CATEGORY = ['Walk-In', 'Caravan'];
export const SC_TRANSACTION_TYPE = ['New', 'Replace', 'Loss', 'Transfer'];

export const EMPLOYMENT_STATUS = [
  'Employed (Public or Private)', 'Self-employed', 'Not Employed',
];

export const LIVING_STATUS = ['Owned', 'Rent', 'Living Alone', 'Living with Relatives'];

/** Department display config — colors, labels, ID format info */
export const DEPT_CONFIG = {
  PWD: {
    label: 'Persons with Disability',
    shortLabel: 'PWD',
    color: 'pwd',
    accentClass: 'bg-pwd-600 text-white',
    badgeClass: 'bg-pwd-100 text-pwd-700',
    validity: '5 years',
  },
  SOLO_PARENT: {
    label: 'Solo Parent',
    shortLabel: 'Solo Parent',
    color: 'sp',
    accentClass: 'bg-sp-600 text-white',
    badgeClass: 'bg-sp-100 text-sp-700',
    validity: '2 years',
  },
  SENIOR_CITIZEN: {
    label: 'Senior Citizen',
    shortLabel: 'Senior',
    color: 'sc',
    accentClass: 'bg-sc-600 text-white',
    badgeClass: 'bg-sc-100 text-sc-700',
    validity: 'Lifetime',
  },
};
