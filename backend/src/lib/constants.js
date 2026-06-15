const DEPARTMENTS = ['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN'];

const ROLES = ['SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF'];
const USER_STATUS = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];

const APPLICANT_STATUS = ['PARTIAL', 'COMPLETE', 'REVOKED'];
const RECORD_STATUS = ['ACTIVE', 'EXPIRED', 'REVOKED', 'DECEASED', 'TRANSFERRED'];

const ID_TRANSACTION_TYPE = ['New', 'Renew', 'Replace', 'Loss', 'Transfer'];
const ID_CARD_STATUS = ['ACTIVE', 'EXPIRED', 'REVOKED'];

const SEX = ['M', 'F'];
const CIVIL_STATUS = [
  'Single', 'Married', 'Separated', 'Widow/er', 'Annulled', 'Cohabitation', 'Divorced',
];

const BARANGAYS = [
  'Abagon', 'Amacalan', 'Apsayan', 'Ayson', 'Bawa', 'Buenlag', 'Bularit', 'Calayaan',
  'Carbonel', 'Cardona', 'Caturay', 'Danzo', 'Dicolor', 'Don Basilio', 'Luna', 'Mabini',
  'Magaspac', 'Malayep', 'Matapitap', 'Matayuncab', 'New Salem', 'Oloybuaya', 'Padapada',
  'Parsolingan', 'Pinasling', 'Plastado', 'Poblacion 1', 'Poblacion 2', 'Poblacion 3',
  'Quezon', 'Rizal', 'Salapungan', 'San Agustin', 'San Antonio', 'San Bartolome',
  'San Jose', 'Sta. Lucia', 'Santiago', 'Sembrano', 'Singat', 'Sulipa', 'Tagumbao',
  'Tangcaran', 'Villa Paz',
];

const PWD_DISABILITY_TYPES = [
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

const SOLO_PARENT_CATEGORIES = [
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

const SOLO_PARENT_CATEGORY_CODES = SOLO_PARENT_CATEGORIES.map((c) => c.code);

const PENSION_TYPES = ['socpen', 'local socpen', 'SSS', 'GSIS', 'PVAO', 'Socpen/SSS', 'None'];
const SC_REGISTRATION_CATEGORY = ['Walk-In', 'Caravan'];

const EMPLOYMENT_STATUS = ['Employed (Public or Private)', 'Self-employed', 'Not Employed'];
const LIVING_STATUS = ['Owned', 'Rent', 'Living Alone', 'Living with Relatives'];
const SC_TRANSACTION_TYPE = ['New', 'Replace', 'Loss', 'Transfer'];

module.exports = {
  DEPARTMENTS,
  ROLES,
  USER_STATUS,
  APPLICANT_STATUS,
  RECORD_STATUS,
  ID_TRANSACTION_TYPE,
  ID_CARD_STATUS,
  SEX,
  CIVIL_STATUS,
  BARANGAYS,
  PWD_DISABILITY_TYPES,
  SOLO_PARENT_CATEGORIES,
  SOLO_PARENT_CATEGORY_CODES,
  PENSION_TYPES,
  SC_REGISTRATION_CATEGORY,
  EMPLOYMENT_STATUS,
  LIVING_STATUS,
  SC_TRANSACTION_TYPE,
};
