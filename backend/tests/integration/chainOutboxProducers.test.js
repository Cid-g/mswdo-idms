'use strict';

const path = require('path');
const fs = require('fs');

jest.mock('../../src/services/idGeneration', () => ({
  generateIDImage: jest.fn(),
}));

jest.mock('../../src/services/imageProcessing', () => ({
  processPhoto: jest.fn(),
  processSignature: jest.fn(),
  processSignatureUpload: jest.fn(),
  saveBase64Signature: jest.fn(),
  deleteUploadFile: jest.fn(),
}));

jest.mock('../../src/services/blockchain', () => {
  const actual = jest.requireActual('../../src/services/blockchain');
  return { ...actual, anchorIDOnChain: jest.fn(), revokeIDOnChain: jest.fn() };
});

const supertest = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const db = require('../dbHelpers');
const { createTestUser, getToken } = require('../testHelpers');
const Applicant = require('../../src/models/Applicant');
const IDRecord = require('../../src/models/IDRecord');
const IDTemplate = require('../../src/models/IDTemplate');
const IDTemplateVersion = require('../../src/models/IDTemplateVersion');
const ChainOutbox = require('../../src/models/ChainOutbox');
const VerifyOutbox = require('../../src/models/VerifyOutbox');
const BlockchainAnchor = require('../../src/models/BlockchainAnchor');
const AuditLog = require('../../src/models/AuditLog');
const { withMongoTransaction } = require('../../src/lib/transactions');
const { enqueueChainOp, operationIdFor } = require('../../src/services/chainOutbox');
const { generateIDImage } = require('../../src/services/idGeneration');
const {
  processPhoto,
  saveBase64Signature,
  deleteUploadFile,
} = require('../../src/services/imageProcessing');
const { anchorIDOnChain, revokeIDOnChain } = require('../../src/services/blockchain');

const IDS_DIR = path.resolve(__dirname, '../../uploads/ids');
const PWD_TYPE = '5. Physical Disability (Orthopedic)';

let pwdUser;
let soloUser;
let seniorUser;
let pwdToken;
let soloToken;
let seniorToken;
let generatedCounter = 0;

beforeAll(async () => {
  await db.connect();
  await Promise.all([
    IDRecord.syncIndexes(),
    ChainOutbox.syncIndexes(),
    VerifyOutbox.syncIndexes(),
  ]);

  pwdUser = await createTestUser({ username: 'outbox_pwd', role: 'ENCODER', department: 'PWD' });
  soloUser = await createTestUser({ username: 'outbox_solo', role: 'ENCODER', department: 'SOLO_PARENT' });
  seniorUser = await createTestUser({ username: 'outbox_senior', role: 'ENCODER', department: 'SENIOR_CITIZEN' });

  [pwdToken, soloToken, seniorToken] = await Promise.all([
    getToken(app, 'outbox_pwd'),
    getToken(app, 'outbox_solo'),
    getToken(app, 'outbox_senior'),
  ]);
});

afterAll(async () => {
  cleanupGeneratedIDFiles();
  await db.disconnect();
});

beforeEach(() => {
  generatedCounter = 0;
  generateIDImage.mockImplementation(async () => ({
    buffer: Buffer.from('generated-id-image'),
    filename: `task7-generated-${++generatedCounter}.png`,
  }));
  processPhoto.mockResolvedValue({ relPath: 'photos/task7-new-photo.png' });
  saveBase64Signature.mockResolvedValue({ relPath: 'signatures/task7-new-signature.png' });
  deleteUploadFile.mockResolvedValue(undefined);
  anchorIDOnChain.mockClear();
  revokeIDOnChain.mockClear();
});

afterEach(async () => {
  jest.restoreAllMocks();
  cleanupGeneratedIDFiles();
  const { collections } = mongoose.connection;
  for (const key of [
    'applicants',
    'idrecords',
    'idtemplates',
    'idtemplateversions',
    'chainoutboxes',
    'verifyoutboxes',
    'blockchainanchors',
    'sequences',
    'auditlogs',
  ]) {
    if (collections[key]) await collections[key].deleteMany({});
  }
});

function cleanupGeneratedIDFiles() {
  if (!fs.existsSync(IDS_DIR)) return;
  for (const filename of fs.readdirSync(IDS_DIR)) {
    if (filename.startsWith('task7-generated-')) {
      fs.rmSync(path.join(IDS_DIR, filename), { force: true });
    }
  }
}

async function installTemplate(department, userId) {
  const template = await IDTemplate.create({ department });
  const version = await IDTemplateVersion.create({
    templateId: template._id,
    versionNumber: 1,
    uploadedById: userId,
    front: {
      imagePath: `templates/${department.toLowerCase()}-front.png`,
      placeholderConfig: { fullName: { x: 1, y: 1 } },
    },
  });
  template.activeVersionId = version._id;
  await template.save();
  return version;
}

function baseApplicant({ department = 'PWD', encodedById = pwdUser._id, ...overrides } = {}) {
  return {
    firstName: 'Producer',
    lastName: 'Test',
    birthdate: new Date('1985-04-12'),
    barangay: 'Poblacion 1',
    sex: 'Female',
    department,
    encodedById,
    status: 'PARTIAL',
    ...overrides,
  };
}

async function createActiveId(applicant, suffix) {
  return IDRecord.create({
    applicantId: applicant._id,
    department: applicant.department,
    idNumber: `${applicant.department}-${suffix}`,
    qrToken: `task7-token-${suffix}`,
    issuedDate: new Date('2026-08-01T00:00:00.000Z'),
    expiryDate: applicant.department === 'SENIOR_CITIZEN'
      ? null
      : new Date('2031-08-01T00:00:00.000Z'),
    status: 'ACTIVE',
    idImagePath: `uploads/ids/${suffix}.png`,
  });
}

async function expectOnePendingVerification(applicant, idRecord) {
  const row = await VerifyOutbox.findOne({ idRecordId: idRecord._id }).lean();
  expect(row).toMatchObject({
    operationId: `verify:issue:${idRecord._id}`,
    idRecordId: idRecord._id,
    epoch: 1,
    revision: 1,
    state: 'PENDING',
    payload: {
      anchoredAt: null,
      anchoredHash: null,
      blockNumber: null,
      expiryDate: idRecord.expiryDate
        ? new Date(idRecord.expiryDate).toISOString().slice(0, 10)
        : null,
      idNumber: idRecord.idNumber,
      idType: idRecord.department,
      issuedDate: new Date(idRecord.issuedDate).toISOString().slice(0, 10),
      maskedName: 'T***, P*******',
      releasedAt: null,
      status: 'ACTIVE',
      txId: null,
    },
  });
  expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(row)).not.toContain(idRecord.qrToken);
  expect(JSON.stringify(row.payload)).not.toContain(applicant.firstName);
  expect(JSON.stringify(row.payload)).not.toContain(applicant.lastName);

  const persisted = await IDRecord.findById(idRecord._id).lean();
  expect(persisted.verifyRevision).toBe(1);
}

async function expectOnePendingAnchor(applicantId, idRecordId) {
  const rows = await ChainOutbox.find({ idRecordId }).lean();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    operationId: `anchor:${idRecordId}`,
    operation: 'ANCHOR',
    state: 'PENDING',
    idRecordId,
  });
  expect(rows[0].payload.canonicalHash).toMatch(/^[a-f0-9]{64}$/);

  const applicant = await Applicant.findById(applicantId).lean();
  const idRecord = await IDRecord.findById(idRecordId).lean();
  expect(applicant.status).toBe('COMPLETE');
  expect(idRecord.chainSequence).toBe(1);
  expect(anchorIDOnChain).not.toHaveBeenCalled();
}

describe('ID creation ANCHOR producer', () => {
  test('commits a COMPLETE applicant ID and PENDING ANCHOR together while Fabric is disabled', async () => {
    await installTemplate('PWD', pwdUser._id);
    const applicant = await Applicant.create(baseApplicant({
      status: 'COMPLETE',
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
      emergencyContactName: 'Emergency Person',
      emergencyContactNumber: '09170000000',
      pwd: { disabilityType: PWD_TYPE },
    }));

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(201);
    const idRecord = await IDRecord.findOne({ applicantId: applicant._id });
    expect(idRecord).not.toBeNull();
    await expectOnePendingAnchor(applicant._id, idRecord._id);
    await expectOnePendingVerification(applicant, idRecord);
  });

  test('creates a PARTIAL applicant ID without an ANCHOR intent', async () => {
    await installTemplate('PWD', pwdUser._id);
    const applicant = await Applicant.create(baseApplicant({
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
    }));

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(201);
    const idRecord = await IDRecord.findOne({ applicantId: applicant._id }).lean();
    expect(idRecord).not.toBeNull();
    expect(idRecord.chainSequence).toBe(0);
    expect(await ChainOutbox.countDocuments()).toBe(0);
    await expectOnePendingVerification(applicant, idRecord);
    expect(anchorIDOnChain).not.toHaveBeenCalled();
  });

  test('rolls back ID issuance, ANCHOR intent, assigned number, and images when verification enqueue fails', async () => {
    await installTemplate('SENIOR_CITIZEN', seniorUser._id);
    const applicant = await Applicant.create(baseApplicant({
      department: 'SENIOR_CITIZEN',
      encodedById: seniorUser._id,
      status: 'COMPLETE',
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
    }));
    jest.spyOn(VerifyOutbox, 'create')
      .mockRejectedValueOnce(new Error('forced verification enqueue failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(500);
    expect(await IDRecord.countDocuments({ applicantId: applicant._id })).toBe(0);
    expect(await ChainOutbox.countDocuments()).toBe(0);
    expect(await VerifyOutbox.countDocuments()).toBe(0);
    const persisted = await Applicant.findById(applicant._id).lean();
    expect(persisted.seniorCitizen?.oscaNumber).toBeUndefined();
    expect(fs.existsSync(path.join(IDS_DIR, 'task7-generated-1.png'))).toBe(false);
  });

  test('rolls back a newly assigned OSCA number with the ID when enqueue fails', async () => {
    await installTemplate('SENIOR_CITIZEN', seniorUser._id);
    const applicant = await Applicant.create(baseApplicant({
      department: 'SENIOR_CITIZEN',
      encodedById: seniorUser._id,
      status: 'COMPLETE',
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
    }));
    jest.spyOn(ChainOutbox, 'create').mockRejectedValueOnce(new Error('forced outbox failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(500);
    expect(await IDRecord.countDocuments({ applicantId: applicant._id })).toBe(0);
    const persisted = await Applicant.findById(applicant._id).lean();
    expect(persisted.seniorCitizen?.oscaNumber).toBeUndefined();
    expect(await ChainOutbox.countDocuments()).toBe(0);
  });

  test('rolls back the IDRecord and removes only the newly generated image when enqueue fails', async () => {
    await installTemplate('PWD', pwdUser._id);
    const applicant = await Applicant.create(baseApplicant({
      status: 'COMPLETE',
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
      emergencyContactName: 'Emergency Person',
      emergencyContactNumber: '09170000000',
      pwd: { disabilityType: PWD_TYPE },
    }));
    jest.spyOn(ChainOutbox, 'create').mockRejectedValueOnce(new Error('forced outbox failure'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await supertest(app)
      .post('/api/id-records')
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ applicantId: applicant._id.toString() });

    expect(res.status).toBe(500);
    expect(await IDRecord.countDocuments({ applicantId: applicant._id })).toBe(0);
    expect(await ChainOutbox.countDocuments()).toBe(0);
    expect(fs.existsSync(path.join(IDS_DIR, 'task7-generated-1.png'))).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('PARTIAL to COMPLETE ANCHOR producers', () => {
  test('general applicant update queues exactly one ANCHOR and repeated updates stay idempotent', async () => {
    const applicant = await Applicant.create(baseApplicant({
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
      emergencyContactName: 'Emergency Person',
      pwd: { disabilityType: PWD_TYPE },
    }));
    const idRecord = await createActiveId(applicant, 'general');

    const first = await supertest(app)
      .patch(`/api/applicants/${applicant._id}`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ emergencyContactNumber: '09171111111' });
    expect(first.status).toBe(200);
    await expectOnePendingAnchor(applicant._id, idRecord._id);

    const second = await supertest(app)
      .patch(`/api/applicants/${applicant._id}`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ contactNumber: '09172222222' });
    expect(second.status).toBe(200);
    expect(await ChainOutbox.countDocuments({ idRecordId: idRecord._id })).toBe(1);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(1);
  });

  test('PWD details completion queues an ANCHOR', async () => {
    const applicant = await Applicant.create(baseApplicant({
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
      emergencyContactName: 'Emergency Person',
      emergencyContactNumber: '09170000000',
    }));
    const idRecord = await createActiveId(applicant, 'pwd-details');

    const res = await supertest(app)
      .patch(`/api/applicants/${applicant._id}/pwd-details`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ disabilityType: PWD_TYPE });

    expect(res.status).toBe(200);
    await expectOnePendingAnchor(applicant._id, idRecord._id);
  });

  test('Solo Parent details completion queues an ANCHOR', async () => {
    const applicant = await Applicant.create(baseApplicant({
      department: 'SOLO_PARENT',
      encodedById: soloUser._id,
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
      birthplace: 'Gerona, Tarlac',
      emergencyContactName: 'Emergency Person',
      emergencyContactAddress: 'Poblacion 1',
      emergencyContactNumber: '09170000000',
      soloParent: { caseNumber: 'SP-CASE-1', spicNumber: 'SPIC-1' },
    }));
    const idRecord = await createActiveId(applicant, 'solo-details');

    const res = await supertest(app)
      .patch(`/api/applicants/${applicant._id}/solo-parent-details`)
      .set('Authorization', `Bearer ${soloToken}`)
      .send({
        categoryCode: 'A2',
        children: [{ firstName: 'Child', lastName: 'Test', birthdate: '2015-01-01', sex: 'Female' }],
      });

    expect(res.status).toBe(200);
    await expectOnePendingAnchor(applicant._id, idRecord._id);
  });

  test('Senior Citizen details completion queues an ANCHOR', async () => {
    const applicant = await Applicant.create(baseApplicant({
      department: 'SENIOR_CITIZEN',
      encodedById: seniorUser._id,
      photoPath: 'photos/existing.png',
      signaturePath: 'signatures/existing.png',
      seniorCitizen: { oscaNumber: 'OSCA-001' },
    }));
    const idRecord = await createActiveId(applicant, 'senior-details');

    const res = await supertest(app)
      .patch(`/api/applicants/${applicant._id}/senior-citizen-details`)
      .set('Authorization', `Bearer ${seniorToken}`)
      .send({ registrationCategory: 'Walk-In' });

    expect(res.status).toBe(200);
    await expectOnePendingAnchor(applicant._id, idRecord._id);
  });

  test('photo upload completion queues an ANCHOR', async () => {
    const applicant = await Applicant.create(baseApplicant({
      signaturePath: 'signatures/existing.png',
      emergencyContactName: 'Emergency Person',
      emergencyContactNumber: '09170000000',
      pwd: { disabilityType: PWD_TYPE },
    }));
    const idRecord = await createActiveId(applicant, 'photo');

    const res = await supertest(app)
      .post(`/api/applicants/${applicant._id}/photo`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .attach('photo', Buffer.from('photo'), { filename: 'photo.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    await expectOnePendingAnchor(applicant._id, idRecord._id);
  });

  test('signature upload completion queues an ANCHOR', async () => {
    const applicant = await Applicant.create(baseApplicant({
      photoPath: 'photos/existing.png',
      emergencyContactName: 'Emergency Person',
      emergencyContactNumber: '09170000000',
      pwd: { disabilityType: PWD_TYPE },
    }));
    const idRecord = await createActiveId(applicant, 'signature');

    const res = await supertest(app)
      .post(`/api/applicants/${applicant._id}/signature`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ signatureBase64: 'data:image/png;base64,AA==' });

    expect(res.status).toBe(200);
    await expectOnePendingAnchor(applicant._id, idRecord._id);
  });

  test('rolls back applicant completion and preserves an existing upload when enqueue fails', async () => {
    const applicant = await Applicant.create(baseApplicant({
      photoPath: 'photos/original-photo.png',
      signaturePath: 'signatures/existing.png',
      emergencyContactName: 'Emergency Person',
      emergencyContactNumber: '09170000000',
      pwd: { disabilityType: PWD_TYPE },
    }));
    await createActiveId(applicant, 'photo-rollback');
    jest.spyOn(ChainOutbox, 'create').mockRejectedValueOnce(new Error('forced completion failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await supertest(app)
      .post(`/api/applicants/${applicant._id}/photo`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .attach('photo', Buffer.from('replacement'), { filename: 'replacement.png', contentType: 'image/png' });

    expect(res.status).toBe(500);
    const persisted = await Applicant.findById(applicant._id).lean();
    expect(persisted.status).toBe('PARTIAL');
    expect(persisted.photoPath).toBe('photos/original-photo.png');
    expect(await ChainOutbox.countDocuments()).toBe(0);
    expect(deleteUploadFile).toHaveBeenCalledWith('photos/task7-new-photo.png');
    expect(deleteUploadFile).not.toHaveBeenCalledWith('photos/original-photo.png');
  });
});


async function createAnchorReceipt(idRecord, suffix = 'receipt') {
  return BlockchainAnchor.create({
    idRecordId: idRecord._id,
    recordRef: idRecord.idNumber,
    canonicalHash: 'a'.repeat(64),
    txId: `task8-${suffix}-tx`,
    blockNumber: 8,
    ledgerEpoch: `task8-${suffix}-epoch`,
    receiptState: 'CURRENT',
  });
}

async function enqueuePendingAnchor(idRecord) {
  return withMongoTransaction((session) => enqueueChainOp({
    session,
    operationId: operationIdFor('ANCHOR', idRecord._id),
    operation: 'ANCHOR',
    idRecordId: idRecord._id,
    payload: {
      canonicalHash: 'b'.repeat(64),
      idType: idRecord.department,
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    },
  }));
}

async function waitForAudit(action, expectedCount, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await AuditLog.countDocuments({ action });
    if (count === expectedCount) return count;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return AuditLog.countDocuments({ action });
}

describe('critical REVOKE producer', () => {
  test('commits an anchored ID revocation and PENDING REVOKE together while Fabric is disabled', async () => {
    const applicant = await Applicant.create(baseApplicant());
    const idRecord = await createActiveId(applicant, 'revoke-anchored');
    await createAnchorReceipt(idRecord, 'anchored');

    const res = await supertest(app)
      .post(`/api/id-records/${idRecord._id}/revoke`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ reason: '  Lost card reported  ' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');
    expect(res.body.revokedReason).toBe('Lost card reported');
    expect(res.body.chainSync).toEqual({ state: 'PENDING', operation: 'REVOKE' });

    const persisted = await IDRecord.findById(idRecord._id).lean();
    expect(persisted).toMatchObject({
      status: 'REVOKED',
      revokedReason: 'Lost card reported',
      chainSequence: 1,
    });
    expect(persisted.revokedAt).toBeInstanceOf(Date);
    expect(persisted.revokedById.toString()).toBe(pwdUser._id.toString());

    const revoke = await ChainOutbox.findOne({ operationId: `revoke:${idRecord._id}` }).lean();
    expect(revoke).toMatchObject({
      operation: 'REVOKE',
      state: 'PENDING',
      recordRef: idRecord.idNumber,
      sequence: 1,
      payload: { reason: 'Lost card reported' },
    });
    expect(revokeIDOnChain).not.toHaveBeenCalled();
  });

  test('queues REVOKE after an existing pending ANCHOR with the next sequence', async () => {
    const applicant = await Applicant.create(baseApplicant());
    const idRecord = await createActiveId(applicant, 'revoke-after-anchor');
    const anchor = await enqueuePendingAnchor(idRecord);
    expect(anchor.sequence).toBe(1);

    const res = await supertest(app)
      .post(`/api/id-records/${idRecord._id}/revoke`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ reason: 'Fraudulent application' });

    expect(res.status).toBe(200);
    expect(res.body.chainSync).toEqual({ state: 'PENDING', operation: 'REVOKE' });

    const rows = await ChainOutbox.find({ idRecordId: idRecord._id }).sort({ sequence: 1 }).lean();
    expect(rows.map((row) => [row.operation, row.sequence])).toEqual([
      ['ANCHOR', 1],
      ['REVOKE', 2],
    ]);
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(2);
  });

  test('rolls back all local revocation metadata when REVOKE enqueue fails', async () => {
    const applicant = await Applicant.create(baseApplicant());
    const idRecord = await createActiveId(applicant, 'revoke-rollback');
    await createAnchorReceipt(idRecord, 'rollback');
    jest.spyOn(ChainOutbox, 'create').mockRejectedValueOnce(new Error('forced revoke enqueue failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await supertest(app)
      .post(`/api/id-records/${idRecord._id}/revoke`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ reason: 'Should roll back' });

    expect(res.status).toBe(500);
    const persisted = await IDRecord.findById(idRecord._id).lean();
    expect(persisted.status).toBe('ACTIVE');
    expect(persisted.revokedReason).toBeUndefined();
    expect(persisted.revokedAt).toBeUndefined();
    expect(persisted.revokedById).toBeUndefined();
    expect(persisted.chainSequence).toBe(0);
    expect(await ChainOutbox.countDocuments({ operation: 'REVOKE' })).toBe(0);
    expect(await waitForAudit('ID_REVOKED', 0)).toBe(0);
  });

  test('revokes a never-anchored PARTIAL ID locally without an impossible Fabric command', async () => {
    const applicant = await Applicant.create(baseApplicant());
    const idRecord = await createActiveId(applicant, 'revoke-never-anchored');

    const res = await supertest(app)
      .post(`/api/id-records/${idRecord._id}/revoke`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ reason: 'Card replaced before completion' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');
    expect(res.body.chainSync).toEqual({
      state: 'NOT_APPLICABLE',
      operation: 'REVOKE',
      reason: 'NEVER_ANCHORED',
    });
    expect((await IDRecord.findById(idRecord._id)).status).toBe('REVOKED');
    expect((await IDRecord.findById(idRecord._id)).chainSequence).toBe(0);
    expect(await ChainOutbox.countDocuments({ idRecordId: idRecord._id })).toBe(0);
  });

  test('writes ID_REVOKED audit only after a successful committed response', async () => {
    const applicant = await Applicant.create(baseApplicant());
    const idRecord = await createActiveId(applicant, 'revoke-audit');
    await createAnchorReceipt(idRecord, 'audit');

    const res = await supertest(app)
      .post(`/api/id-records/${idRecord._id}/revoke`)
      .set('Authorization', `Bearer ${pwdToken}`)
      .send({ reason: 'Confirmed duplicate credential' });

    expect(res.status).toBe(200);
    expect(await waitForAudit('ID_REVOKED', 1)).toBe(1);
    const audit = await AuditLog.findOne({ action: 'ID_REVOKED' }).lean();
    expect(audit).toMatchObject({
      targetType: 'IDRecord',
      targetId: idRecord._id.toString(),
      department: 'PWD',
    });
    expect(audit.description).toContain('Confirmed duplicate credential');
  });
});
