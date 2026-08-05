'use strict';

const mongoose = require('mongoose');
const {
  buildVerificationPayload,
  maskName,
} = require('../../src/services/verificationProjection');

function sources({ applicant = {}, idRecord = {}, anchor } = {}) {
  const applicantId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const recordId = new mongoose.Types.ObjectId('507f191e810c19729de860ea');

  const value = {
    applicant: {
      _id: applicantId,
      department: 'PWD',
      firstName: 'Maria Luisa',
      lastName: 'De la Cruz',
      birthdate: new Date('1980-01-02T00:00:00.000Z'),
      barangay: 'Abagon',
      photoPath: 'private/photo.png',
      signaturePath: 'private/signature.png',
      ...applicant,
    },
    idRecord: {
      _id: recordId,
      applicantId,
      department: 'PWD',
      idNumber: 'PWD-2026-0000200',
      qrToken: '49feec7e-90f5-420a-be3e-18540525a9a6',
      issuedDate: new Date('2026-08-05T00:00:00.000Z'),
      expiryDate: new Date('2031-08-05T00:00:00.000Z'),
      releasedAt: new Date('2026-08-06T01:02:03.004Z'),
      status: 'ACTIVE',
      revokedReason: 'must remain local',
      ...idRecord,
    },
  };

  if (anchor !== undefined) {
    value.anchor = anchor === null
      ? null
      : {
        _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
        idRecordId: recordId,
        recordRef: value.idRecord.idNumber,
        canonicalHash: 'a'.repeat(64),
        txId: 'b'.repeat(64),
        blockNumber: 42,
        receiptState: 'CURRENT',
        anchoredAt: new Date('2026-08-06T02:03:04.005Z'),
        ...anchor,
      };
  }

  return value;
}

describe('verification projection builder', () => {
  test('uses the existing word-by-word masking behavior', () => {
    expect(maskName('De la Cruz')).toBe('D* l* C***');
    expect(maskName('A')).toBe('A');
    expect(maskName('  Maria   Luisa ')).toBe('M**** L****');
  });

  test('builds the exact minimized ACTIVE payload with canonical dates', () => {
    const payload = buildVerificationPayload(sources());

    expect(payload).toEqual({
      anchoredAt: null,
      anchoredHash: null,
      blockNumber: null,
      expiryDate: '2031-08-05',
      idNumber: 'PWD-2026-0000200',
      idType: 'PWD',
      issuedDate: '2026-08-05',
      maskedName: 'D* l* C***, M**** L****',
      releasedAt: '2026-08-06T01:02:03.004Z',
      status: 'ACTIVE',
      txId: null,
    });
    expect(Object.isFrozen(payload)).toBe(true);
  });

  test.each([
    ['PWD', 'PWD-2026-1', new Date('2031-08-05T00:00:00.000Z')],
    ['SOLO_PARENT', 'SP-2026-1', new Date('2027-08-05T00:00:00.000Z')],
    ['SENIOR_CITIZEN', 'OSCA-2026-1', null],
  ])('projects the supported %s ID type', (department, idNumber, expiryDate) => {
    const payload = buildVerificationPayload(sources({
      applicant: { department },
      idRecord: { department, idNumber, expiryDate },
    }));

    expect(payload.idType).toBe(department);
    expect(payload.idNumber).toBe(idNumber);
    expect(payload.expiryDate).toBe(expiryDate ? expiryDate.toISOString().slice(0, 10) : null);
  });

  test.each(['ACTIVE', 'REVOKED', 'EXPIRED'])(
    'projects persisted %s lifecycle state without a free-text reason',
    (status) => {
      const payload = buildVerificationPayload(sources({
        idRecord: { status, revokedReason: 'private local reason' },
      }));

      expect(payload.status).toBe(status);
      expect(payload).not.toHaveProperty('revokedReason');
      expect(JSON.stringify(payload)).not.toContain('private local reason');
    }
  );

  test('keeps persisted ACTIVE deterministic even when expiry is already past', () => {
    const payload = buildVerificationPayload(sources({
      idRecord: {
        status: 'ACTIVE',
        expiryDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    }));

    expect(payload.status).toBe('ACTIVE');
    expect(payload.expiryDate).toBe('2020-01-01');
  });

  test('uses a complete CURRENT Fabric receipt as issuance metadata', () => {
    const payload = buildVerificationPayload(sources({ anchor: {} }));

    expect(payload).toMatchObject({
      anchoredAt: '2026-08-06T02:03:04.005Z',
      anchoredHash: 'a'.repeat(64),
      blockNumber: 42,
      txId: 'b'.repeat(64),
    });
  });

  test('omits a STALE Fabric receipt instead of presenting it as current proof', () => {
    const payload = buildVerificationPayload(sources({
      anchor: { receiptState: 'STALE' },
    }));

    expect(payload).toMatchObject({
      anchoredAt: null,
      anchoredHash: null,
      blockNumber: null,
      txId: null,
    });
  });

  test('requires a complete CURRENT Fabric receipt tuple', () => {
    expect(() => buildVerificationPayload(sources({
      anchor: { txId: undefined },
    }))).toThrow();
  });

  test('rejects mismatched applicant, department, or anchor identity', () => {
    expect(() => buildVerificationPayload(sources({
      idRecord: { applicantId: new mongoose.Types.ObjectId() },
    }))).toThrow('Applicant and ID record do not match');

    expect(() => buildVerificationPayload(sources({
      applicant: { department: 'PWD' },
      idRecord: { department: 'SOLO_PARENT' },
    }))).toThrow('departments do not match');

    expect(() => buildVerificationPayload(sources({
      anchor: { idRecordId: new mongoose.Types.ObjectId() },
    }))).toThrow('anchor and ID record do not match');
  });

  test('fails closed on missing names and invalid source dates', () => {
    expect(() => buildVerificationPayload(sources({
      applicant: { firstName: '   ' },
    }))).toThrow('applicant.firstName is invalid');

    expect(() => buildVerificationPayload(sources({
      idRecord: { issuedDate: '2026-02-30' },
    }))).toThrow('idRecord.issuedDate is invalid');

    expect(() => buildVerificationPayload(sources({
      idRecord: { releasedAt: '2026-08-06T01:02:03Z' },
    }))).toThrow('idRecord.releasedAt is invalid');
  });

  test('never serializes raw QR, full applicant fields, or canonical snapshot data', () => {
    const source = sources({ anchor: {} });
    const payload = buildVerificationPayload(source);
    const serialized = JSON.stringify(payload);

    expect(Object.keys(payload).sort()).toEqual([
      'anchoredAt',
      'anchoredHash',
      'blockNumber',
      'expiryDate',
      'idNumber',
      'idType',
      'issuedDate',
      'maskedName',
      'releasedAt',
      'status',
      'txId',
    ]);
    expect(serialized).not.toContain(source.idRecord.qrToken);
    expect(serialized).not.toContain(source.applicant.firstName);
    expect(serialized).not.toContain(source.applicant.lastName);
    expect(serialized).not.toContain(source.applicant.birthdate.toISOString());
    expect(serialized).not.toContain(source.applicant.barangay);
    expect(serialized).not.toContain(source.applicant.photoPath);
    expect(serialized).not.toContain(source.applicant.signaturePath);
  });

  test('captures an immutable snapshot independent of later local edits', () => {
    const source = sources({ anchor: {} });
    const payload = buildVerificationPayload(source);

    source.applicant.firstName = 'Changed';
    source.idRecord.status = 'REVOKED';
    source.anchor.canonicalHash = 'c'.repeat(64);

    expect(payload.maskedName).toBe('D* l* C***, M**** L****');
    expect(payload.status).toBe('ACTIVE');
    expect(payload.anchoredHash).toBe('a'.repeat(64));
  });
});
