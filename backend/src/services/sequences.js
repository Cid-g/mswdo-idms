const Sequence = require('../models/Sequence');

/**
 * Atomically increment a named sequence and return the new value.
 * Uses findOneAndUpdate + $inc + upsert so it's safe under concurrency.
 */
async function nextValue(name) {
  const doc = await Sequence.findOneAndUpdate(
    { name },
    { $inc: { value: 1 } },
    { new: true, upsert: true }
  );
  return doc.value;
}

/**
 * Generate PWD control number: YYYY-NNN  (e.g. 2026-461)
 * Sequence key: 'PWD-YYYY'
 */
async function nextPWDControlNumber() {
  const year = new Date().getFullYear();
  const seq = await nextValue(`PWD-${year}`);
  return `${year}-${seq}`;
}

/**
 * Generate PWD ID number printed on card: 03-6906-000-NNNNNNN (e.g. 03-6906-000-0002975)
 * Sequence key: 'PWD-ID-YYYY'
 */
async function nextPWDIdNumber() {
  const year = new Date().getFullYear();
  const seq = await nextValue(`PWD-ID-${year}`);
  return `03-6906-000-${String(seq).padStart(7, '0')}`;
}

/**
 * Generate Senior Citizen OSCA number: YY-NNNN  (e.g. 26-0501)
 * Sequence key: 'SC-YY'
 */
async function nextOSCANumber() {
  const yy = String(new Date().getFullYear()).slice(-2);
  const seq = await nextValue(`SC-${yy}`);
  return `${yy}-${String(seq).padStart(4, '0')}`;
}

/**
 * Generate Solo Parent case number: YYMM-NNNNNN  (e.g. 2301-000001)
 * The 6-digit number is a SINGLE continuous counter (it never resets per
 * month or year); only the YYMM prefix reflects the issuance date. e.g.
 *   2301-000001, 2302-000002, 2312-000003, 2401-000004, 2401-000005
 * Sequence key: 'SP-CASE' (global, continuous).
 */
async function nextCaseNumber(now = new Date()) {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const seq = await nextValue('SP-CASE');
  return `${yy}${mm}-${String(seq).padStart(6, '0')}`;
}

/**
 * Generate Solo Parent SPIC number: 036906000-YYMM-NNNNNN (e.g. 036906000-2605-000001)
 * Derived from case number.
 */
function caseNumberToSPIC(caseNumber) {
  return `036906000-${caseNumber}`;
}

module.exports = {
  nextValue,
  nextPWDControlNumber,
  nextPWDIdNumber,
  nextOSCANumber,
  nextCaseNumber,
  caseNumberToSPIC,
};
