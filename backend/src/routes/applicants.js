const router = require('express').Router();
const { authenticate }   = require('../middleware/auth');
const { requireRole }    = require('../middleware/rbac');
const { auditLog }       = require('../middleware/auditLog');
const { photoUpload, signatureUpload } = require('../lib/upload');
const {
  createApplicant,
  getApplicants,
  getApplicantById,
  updateApplicant,
  updatePwdDetails,
  updateSoloParentDetails,
  updateSeniorCitizenDetails,
  uploadPhoto,
  uploadSignature,
} = require('../controllers/applicantController');

const ALL_ROLES   = requireRole('SUPERADMIN', 'ADMIN', 'ENCODER', 'RELEASING_STAFF');
const STAFF_ROLES = requireRole('ADMIN', 'ENCODER', 'RELEASING_STAFF');

router.use(authenticate);

const applicantId = (req) => req.params.id;

router.post('/',                              STAFF_ROLES, auditLog('APPLICANT_CREATED', 'New applicant registered', 'Applicant'), createApplicant);
router.get('/',                               ALL_ROLES,   getApplicants);
router.get('/:id',                            ALL_ROLES,   getApplicantById);
router.patch('/:id',                          STAFF_ROLES, auditLog('APPLICANT_UPDATED', 'Applicant information updated', 'Applicant', applicantId), updateApplicant);
router.patch('/:id/pwd-details',              STAFF_ROLES, auditLog('APPLICANT_UPDATED', 'PWD details updated', 'Applicant', applicantId), updatePwdDetails);
router.patch('/:id/solo-parent-details',      STAFF_ROLES, auditLog('APPLICANT_UPDATED', 'Solo Parent details updated', 'Applicant', applicantId), updateSoloParentDetails);
router.patch('/:id/senior-citizen-details',   STAFF_ROLES, auditLog('APPLICANT_UPDATED', 'Senior Citizen details updated', 'Applicant', applicantId), updateSeniorCitizenDetails);

// Phase 5: Photo & Signature
router.post('/:id/photo',     STAFF_ROLES, photoUpload.single('photo'),         auditLog('APPLICANT_UPDATED', 'Applicant photo uploaded', 'Applicant', applicantId), uploadPhoto);
router.post('/:id/signature', STAFF_ROLES, signatureUpload.single('signature'), auditLog('APPLICANT_UPDATED', 'Applicant signature uploaded', 'Applicant', applicantId), uploadSignature);

module.exports = router;
