'use strict';

const crypto = require('node:crypto');
const { common } = require('@hyperledger/fabric-protos');

const testPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({
  type: 'pkcs8',
  format: 'pem',
});

jest.mock('node:fs', () => ({ readFileSync: jest.fn() }));
jest.mock('@grpc/grpc-js', () => {
  const actual = jest.requireActual('@grpc/grpc-js');
  return {
    ...actual,
    credentials: { ...actual.credentials, createSsl: jest.fn() },
    Client: jest.fn(),
  };
});
jest.mock('@hyperledger/fabric-gateway', () => ({ connect: jest.fn() }));

let fs = require('node:fs');
let grpc = require('@grpc/grpc-js');
let fabricGateway = require('@hyperledger/fabric-gateway');

function reloadBoundaries() {
  fs = require('node:fs');
  grpc = require('@grpc/grpc-js');
  fabricGateway = require('@hyperledger/fabric-gateway');
}

function json(value) {
  return Buffer.from(JSON.stringify(value));
}

function block(number) {
  const header = new common.BlockHeader();
  header.setNumber(number);
  const value = new common.Block();
  value.setHeader(header);
  return Buffer.from(value.serializeBinary());
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function grpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

function anchorCommand(overrides = {}) {
  return {
    operationId: 'anchor:507f1f77bcf86cd799439011',
    operation: 'ANCHOR',
    recordRef: 'PWD-2026-0000001',
    payload: {
      canonicalHash: 'a'.repeat(64),
      idType: 'PWD',
      soloParentIdType: '',
      issuingOffice: 'MSWDO-GERONA-TARLAC',
    },
    ...overrides,
  };
}

function ledgerAnchor(overrides = {}) {
  return {
    found: true,
    recordRef: 'PWD-2026-0000001',
    hash: 'a'.repeat(64),
    idType: 'PWD',
    soloParentIdType: null,
    issuingOffice: 'MSWDO-GERONA-TARLAC',
    status: 'ACTIVE',
    ...overrides,
  };
}

function submittedTransaction({
  txId = 'tx-new',
  result = ledgerAnchor(),
  successful = true,
  blockNumber = 47,
} = {}) {
  return {
    getTransactionId: jest.fn(() => txId),
    getResult: jest.fn(() => json(result)),
    getStatus: jest.fn(async () => ({ successful, blockNumber })),
  };
}

function installGateway({
  verify = async (recordRef) => (recordRef === '__health__'
    ? { found: false, recordRef }
    : { found: false, recordRef }),
  history = async () => [],
  submit = async () => submittedTransaction(),
  txBlocks = {},
  genesis = block(0),
} = {}) {
  const client = { close: jest.fn() };
  const contract = {
    evaluateTransaction: jest.fn(async (name, recordRef) => {
      if (name === 'verifyID') return json(await verify(recordRef));
      if (name === 'getIDHistory') return json(await history(recordRef));
      throw new Error(`Unexpected evaluation: ${name}`);
    }),
    submitAsync: jest.fn(submit),
  };
  const qscc = {
    evaluateTransaction: jest.fn(async (name, channelName, value) => {
      if (name === 'GetBlockByTxID') {
        if (!txBlocks[value]) throw new Error(`Missing block for ${value}`);
        return txBlocks[value];
      }
      if (name === 'GetBlockByNumber' && value === '0') return genesis;
      throw new Error(`Unexpected QSCC evaluation: ${name}`);
    }),
  };
  const network = {
    getContract: jest.fn((name) => (name === 'qscc' ? qscc : contract)),
  };
  const gateway = {
    close: jest.fn(),
    getNetwork: jest.fn(() => network),
  };

  grpc.Client.mockImplementation(() => client);
  fabricGateway.connect.mockReturnValue(gateway);
  return { client, contract, gateway, qscc };
}

function loadModules() {
  const fabric = require('../../src/fabric/connect');
  const blockchain = require('../../src/services/blockchain');
  return { fabric, blockchain };
}

describe('reconnecting Fabric access', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    reloadBoundaries();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      FABRIC_ENABLED: 'true',
      FABRIC_TLS_CERT_PATH: 'tls.pem',
      FABRIC_PRIVATE_KEY_PATH: 'key.pem',
      FABRIC_CERT_PATH: 'cert.pem',
      FABRIC_PEER_HOST: 'peer.example.test',
      FABRIC_PEER_PORT: '7051',
      FABRIC_PEER_NAME: 'peer0.example.test',
      FABRIC_MSP_ID: 'ExampleMSP',
      FABRIC_CHANNEL_NAME: 'mychannel',
    };
    fs.readFileSync.mockImplementation((path) => (
      path === 'key.pem' ? testPrivateKey : Buffer.from('certificate')
    ));
    grpc.credentials.createSsl.mockReturnValue({ secure: true });
  });

  afterEach(async () => {
    try {
      require('../../src/fabric/connect').disconnectFromFabric();
    } catch (_) {
      // A disabled test may not have loaded a connection.
    }
    jest.useRealTimers();
    process.env = originalEnv;
  });

  test('shares one in-flight connection attempt and stays unhealthy until verifyID succeeds', async () => {
    const health = deferred();
    const gateway = installGateway({
      verify: (recordRef) => (recordRef === '__health__'
        ? health.promise
        : Promise.resolve({ found: false, recordRef })),
    });
    const { fabric } = loadModules();

    const first = fabric.ensureFabricConnected();
    const second = fabric.ensureFabricConnected();

    await Promise.resolve();
    expect(fabricGateway.connect).toHaveBeenCalledTimes(1);
    expect(fabric.isFabricConnected()).toBe(false);
    expect(gateway.contract.evaluateTransaction)
      .toHaveBeenCalledWith('verifyID', '__health__');

    health.resolve({ found: false, recordRef: '__health__' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { available: true },
      { available: true },
    ]);
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('clears failed gateway resources and permits a later reconnect', async () => {
    const first = installGateway({
      verify: async () => { throw new Error('peer unavailable'); },
    });
    const { fabric } = loadModules();

    await expect(fabric.ensureFabricConnected()).rejects.toThrow('peer unavailable');
    expect(fabric.isFabricConnected()).toBe(false);
    expect(first.gateway.close).toHaveBeenCalledTimes(1);
    expect(first.client.close).toHaveBeenCalledTimes(1);

    installGateway();
    await expect(fabric.ensureFabricConnected()).resolves.toEqual({ available: true });
    expect(fabricGateway.connect).toHaveBeenCalledTimes(2);
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('closes a locally constructed client when identity loading fails', async () => {
    const boundary = installGateway();
    fs.readFileSync.mockImplementation((path) => (
      path === 'key.pem' ? Buffer.from('not a private key') : Buffer.from('certificate')
    ));
    const fabric = require('../../src/fabric/connect');

    await expect(fabric.ensureFabricConnected()).rejects.toThrow();
    expect(boundary.client.close).toHaveBeenCalledTimes(1);
    expect(fabric.isFabricConnected()).toBe(false);
  });

  test('invalidates and replaces an attempt disconnected during its health probe', async () => {
    const firstHealth = deferred();
    const firstGateway = installGateway({
      verify: (recordRef) => (recordRef === '__health__'
        ? firstHealth.promise
        : Promise.resolve({ found: false, recordRef })),
    });
    const { fabric } = loadModules();

    const firstAttempt = fabric.ensureFabricConnected();
    await Promise.resolve();
    fabric.disconnectFromFabric();

    const secondGateway = installGateway();
    const secondAttempt = fabric.ensureFabricConnected();
    firstHealth.resolve({ found: false, recordRef: '__health__' });
    await expect(secondAttempt).resolves.toEqual({ available: true });

    await expect(firstAttempt).rejects.toMatchObject({
      code: 'FABRIC_CONNECTION_SUPERSEDED',
    });
    expect(fabricGateway.connect).toHaveBeenCalledTimes(2);
    expect(firstGateway.gateway.close).toHaveBeenCalledTimes(1);
    expect(firstGateway.client.close).toHaveBeenCalledTimes(1);
    expect(secondGateway.gateway.close).not.toHaveBeenCalled();
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('serializes reconnects behind a bounded infrastructure backoff', async () => {
    jest.useFakeTimers();
    installGateway({
      verify: async () => { throw grpcError(grpc.status.UNAVAILABLE, 'peer unavailable'); },
    });
    const fabric = require('../../src/fabric/connect');

    await expect(fabric.ensureFabricConnected()).rejects.toThrow('peer unavailable');
    installGateway();
    const firstReconnect = fabric.ensureFabricConnected();
    const concurrentReconnect = fabric.ensureFabricConnected();

    await jest.advanceTimersByTimeAsync(249);
    expect(fabricGateway.connect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(Promise.all([firstReconnect, concurrentReconnect])).resolves.toEqual([
      { available: true },
      { available: true },
    ]);
    expect(fabricGateway.connect).toHaveBeenCalledTimes(2);
  });

  test('caps consecutive reconnect backoff at five seconds', async () => {
    jest.useFakeTimers();
    const fabric = require('../../src/fabric/connect');
    const failConnection = () => installGateway({
      verify: async () => { throw grpcError(grpc.status.UNAVAILABLE, 'still unavailable'); },
    });

    failConnection();
    await expect(fabric.ensureFabricConnected()).rejects.toThrow('still unavailable');

    for (const [index, delay] of [250, 1000, 5000, 5000].entries()) {
      failConnection();
      const attempt = fabric.ensureFabricConnected();
      const rejection = expect(attempt).rejects.toThrow('still unavailable');
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(fabricGateway.connect).toHaveBeenCalledTimes(index + 1);
      await jest.advanceTimersByTimeAsync(1);
      await rejection;
      expect(fabricGateway.connect).toHaveBeenCalledTimes(index + 2);
    }
  });

  test('returns disabled before reading identity files or opening a socket', async () => {
    process.env.FABRIC_ENABLED = 'false';
    const { fabric } = loadModules();

    await expect(fabric.ensureFabricConnected()).resolves.toEqual({
      available: false,
      reason: 'DISABLED',
    });
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(grpc.Client).not.toHaveBeenCalled();
    expect(fabricGateway.connect).not.toHaveBeenCalled();
  });
});

describe('immutable Fabric command execution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    reloadBoundaries();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      FABRIC_ENABLED: 'true',
      FABRIC_TLS_CERT_PATH: 'tls.pem',
      FABRIC_PRIVATE_KEY_PATH: 'key.pem',
      FABRIC_CERT_PATH: 'cert.pem',
      FABRIC_PEER_HOST: 'peer.example.test',
      FABRIC_PEER_PORT: '7051',
      FABRIC_PEER_NAME: 'peer0.example.test',
      FABRIC_MSP_ID: 'ExampleMSP',
      FABRIC_CHANNEL_NAME: 'mychannel',
    };
    fs.readFileSync.mockImplementation((path) => (
      path === 'key.pem' ? testPrivateKey : Buffer.from('certificate')
    ));
    grpc.credentials.createSsl.mockReturnValue({ secure: true });
  });

  afterEach(() => {
    try {
      require('../../src/fabric/connect').disconnectFromFabric();
    } catch (_) {
      // Module cleanup is best-effort after expected connection failures.
    }
    jest.useRealTimers();
    process.env = originalEnv;
  });

  test('submits ANCHOR entirely from its queued payload and validates the commit', async () => {
    const genesis = block(0);
    const submitted = submittedTransaction();
    const gateway = installGateway({ submit: async () => submitted, genesis });
    const { blockchain } = loadModules();

    const receipt = await blockchain.executeChainCommand(anchorCommand());

    expect(gateway.contract.submitAsync).toHaveBeenCalledWith('issueID', {
      arguments: [
        'PWD-2026-0000001',
        'PWD',
        '',
        'a'.repeat(64),
        'MSWDO-GERONA-TARLAC',
      ],
    });
    expect(submitted.getStatus).toHaveBeenCalledTimes(1);
    expect(receipt).toEqual({
      txId: 'tx-new',
      blockNumber: 47,
      result: ledgerAnchor(),
      ledgerEpoch: crypto.createHash('sha256').update(genesis).digest('hex'),
      reconciled: false,
    });
  });

  test.each([
    ['REVOKE', { reason: 'Duplicate record — entered in error' }, 'revokeID', [
      'PWD-2026-0000001', 'Duplicate record — entered in error',
    ]],
    ['EXPIRE', {}, 'expireID', ['PWD-2026-0000001']],
  ])('uses submitAsync and validates the commit for %s', async (
    operation,
    payload,
    transactionName,
    args
  ) => {
    const submitted = submittedTransaction({ result: { status: operation === 'REVOKE' ? 'REVOKED' : 'EXPIRED' } });
    const gateway = installGateway({ submit: async () => submitted });
    const { blockchain } = loadModules();

    await blockchain.executeChainCommand(anchorCommand({ operation, payload }));

    expect(gateway.contract.submitAsync).toHaveBeenCalledWith(transactionName, { arguments: args });
    expect(submitted.getStatus).toHaveBeenCalledTimes(1);
  });

  test('rejects a transaction whose commit status is unsuccessful', async () => {
    const submitted = submittedTransaction({ successful: false });
    installGateway({ submit: async () => submitted });
    const { blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_COMMIT_FAILED' });
    expect(submitted.getStatus).toHaveBeenCalledTimes(1);
  });

  test('accepts a prior ANCHOR only when every immutable ledger field matches', async () => {
    const current = ledgerAnchor({ status: 'REVOKED' });
    const history = [{ txId: 'tx-issued', record: ledgerAnchor() }];
    const txBlock = block(31);
    const genesis = block(0);
    const gateway = installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : current),
      history: async () => history,
      txBlocks: { 'tx-issued': txBlock },
      genesis,
    });
    const { blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand())).resolves.toEqual({
      txId: 'tx-issued',
      blockNumber: 31,
      result: current,
      ledgerEpoch: crypto.createHash('sha256').update(genesis).digest('hex'),
      reconciled: true,
    });
    expect(gateway.contract.submitAsync).not.toHaveBeenCalled();
  });

  test.each([
    ['record reference', { recordRef: 'PWD-WRONG' }],
    ['canonical hash', { hash: 'b'.repeat(64) }],
    ['ID type', { idType: 'SENIOR' }],
    ['solo-parent ID type', { soloParentIdType: 'SOLO-01' }],
    ['issuing office', { issuingOffice: 'OTHER-OFFICE' }],
  ])('rejects an existing ANCHOR with a conflicting %s', async (_label, change) => {
    installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : ledgerAnchor(change)),
    });
    const { blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_STATE_CONFLICT' });
  });

  test('rejects an existing ANCHOR whose optional ledger field is missing', async () => {
    installGateway({
      verify: async (recordRef) => {
        if (recordRef === '__health__') return { found: false, recordRef };
        const current = ledgerAnchor();
        delete current.soloParentIdType;
        return current;
      },
    });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_STATE_CONFLICT' });
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test.each([
    ['REVOKE', 'REVOKED', true],
    ['REVOKE', 'EXPIRED', false],
    ['EXPIRE', 'REVOKED', true],
    ['EXPIRE', 'EXPIRED', true],
  ])('%s reconciliation treats %s as satisfied: %s', async (operation, status, satisfied) => {
    const current = ledgerAnchor({ status });
    const history = [{ txId: `tx-${status.toLowerCase()}`, record: current }];
    const gateway = installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : current),
      history: async () => history,
      txBlocks: { [`tx-${status.toLowerCase()}`]: block(58) },
    });
    const { blockchain } = loadModules();
    const command = anchorCommand({ operation, payload: { reason: 'Keep this text exactly' } });

    const receipt = await blockchain.executeChainCommand(command);

    expect(receipt.reconciled).toBe(satisfied);
    expect(gateway.contract.submitAsync).toHaveBeenCalledTimes(satisfied ? 0 : 1);
  });

  test('does not infer success from an already-exists exception', async () => {
    installGateway({
      submit: async () => { throw new Error('ID already exists on chain'); },
    });
    const { blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toThrow('ID already exists on chain');
  });

  test('keeps a healthy connection after a deterministic endorsement failure', async () => {
    installGateway({
      submit: async () => {
        throw grpcError(grpc.status.ABORTED, 'chaincode rejected duplicate record');
      },
    });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toThrow('chaincode rejected duplicate record');
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('keeps a healthy connection after malformed chaincode JSON', async () => {
    const gateway = installGateway();
    gateway.contract.evaluateTransaction.mockImplementation(async (name, recordRef) => {
      if (name === 'verifyID' && recordRef === '__health__') {
        return json({ found: false, recordRef });
      }
      if (name === 'verifyID') return Buffer.from('{malformed');
      throw new Error(`Unexpected evaluation: ${name}`);
    });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand())).rejects.toBeInstanceOf(SyntaxError);
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('invalidates after an established transport failure and reconnects after backoff', async () => {
    installGateway({
      verify: async (recordRef) => {
        if (recordRef === '__health__') return { found: false, recordRef };
        throw grpcError(grpc.status.UNAVAILABLE, 'established peer disconnected');
      },
    });
    const { fabric, blockchain } = loadModules();
    jest.useFakeTimers();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toThrow('established peer disconnected');
    expect(fabric.isFabricConnected()).toBe(false);

    installGateway();
    const reconnect = fabric.ensureFabricConnected();
    await jest.advanceTimersByTimeAsync(250);
    await expect(reconnect).resolves.toEqual({ available: true });
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('a delayed error from an old generation cannot close the replacement gateway', async () => {
    const delayedFailure = deferred();
    installGateway({
      verify: async (recordRef) => {
        if (recordRef === '__health__') return { found: false, recordRef };
        if (recordRef === 'PWD-SLOW') return delayedFailure.promise;
        throw grpcError(grpc.status.UNAVAILABLE, 'peer connection lost');
      },
    });
    const { fabric, blockchain } = loadModules();
    jest.useFakeTimers();
    await fabric.ensureFabricConnected();

    const slowCommand = blockchain.executeChainCommand(anchorCommand({ recordRef: 'PWD-SLOW' }));
    await Promise.resolve();
    await expect(blockchain.executeChainCommand(anchorCommand({ recordRef: 'PWD-FAIL' })))
      .rejects.toThrow('peer connection lost');

    const replacement = installGateway();
    const reconnect = fabric.ensureFabricConnected();
    await jest.advanceTimersByTimeAsync(250);
    await reconnect;

    delayedFailure.reject(grpcError(grpc.status.UNAVAILABLE, 'late old-generation failure'));
    await expect(slowCommand).rejects.toThrow('late old-generation failure');
    expect(replacement.gateway.close).not.toHaveBeenCalled();
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('keeps a satisfied command retryable when its receipt cannot be recovered', async () => {
    installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : ledgerAnchor()),
      history: async () => [],
    });
    const { blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_RECEIPT_RECOVERY_FAILED' });
  });

  test('recovers the earliest satisfying transaction from multi-entry history', async () => {
    const current = ledgerAnchor({ status: 'REVOKED' });
    const gateway = installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : current),
      history: async () => [
        { txId: 'tx-issued', record: ledgerAnchor() },
        { txId: 'tx-revoked', record: current },
      ],
      txBlocks: {
        'tx-issued': block(31),
        'tx-revoked': block(32),
      },
    });
    const { blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand())).resolves.toMatchObject({
      txId: 'tx-issued',
      blockNumber: 31,
      reconciled: true,
    });
    expect(gateway.qscc.evaluateTransaction)
      .toHaveBeenCalledWith('GetBlockByTxID', 'mychannel', 'tx-issued');
  });

  test('rejects a malformed QSCC transaction block without disconnecting', async () => {
    installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : ledgerAnchor()),
      history: async () => [{ txId: 'tx-issued', record: ledgerAnchor() }],
      txBlocks: { 'tx-issued': Buffer.from([0xff]) },
    });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_RECEIPT_RECOVERY_FAILED' });
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('rejects a mismatched QSCC genesis block number without disconnecting', async () => {
    installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : ledgerAnchor()),
      history: async () => [{ txId: 'tx-issued', record: ledgerAnchor() }],
      txBlocks: { 'tx-issued': block(31) },
      genesis: block(9),
    });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_RECEIPT_RECOVERY_FAILED' });
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('keeps a healthy connection when submitted receipt block validation is local', async () => {
    installGateway({ genesis: block(9) });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toThrow('QSCC returned block 9, expected 0');
    expect(fabric.isFabricConnected()).toBe(true);
  });

  test('disconnects after a transport error during receipt recovery', async () => {
    const gateway = installGateway({
      verify: async (recordRef) => (recordRef === '__health__'
        ? { found: false, recordRef }
        : ledgerAnchor()),
      history: async () => {
        throw grpcError(grpc.status.UNAVAILABLE, 'history gateway unavailable');
      },
    });
    const { fabric, blockchain } = loadModules();

    await expect(blockchain.executeChainCommand(anchorCommand()))
      .rejects.toMatchObject({ code: 'CHAIN_RECEIPT_RECOVERY_FAILED' });
    expect(fabric.isFabricConnected()).toBe(false);
    expect(gateway.gateway.close).toHaveBeenCalledTimes(1);
  });
});

describe('chain outbox worker timer lifecycle', () => {
  function loadWorker({
    executeChainCommand = jest.fn().mockResolvedValue({}),
    chainOutboxOverrides = {},
    ensureFabricConnected = jest.fn().mockResolvedValue({ available: true }),
  } = {}) {
    const claimed = {
      _id: 'outbox-id',
      operationId: 'anchor:outbox-id',
      operation: 'ANCHOR',
      recordRef: 'PWD-TIMER',
      payload: { canonicalHash: 'a'.repeat(64) },
    };
    const chainOutbox = {
      recoverExpiredLeases: jest.fn().mockResolvedValue(),
      reevaluateBlockedOperations: jest.fn().mockResolvedValue(),
      claimNextOperation: jest.fn()
        .mockResolvedValueOnce(claimed)
        .mockResolvedValue(null),
      completeOperation: jest.fn().mockResolvedValue(true),
      failOperation: jest.fn().mockResolvedValue(true),
      releaseOperation: jest.fn().mockResolvedValue(true),
      ...chainOutboxOverrides,
    };
    const fabricClient = {
      ensureFabricConnected,
      executeChainCommand,
    };

    jest.doMock('../../src/services/chainOutbox', () => chainOutbox);
    jest.doMock('../../src/fabric/connect', () => ({
      ensureFabricConnected: fabricClient.ensureFabricConnected,
    }));
    jest.doMock('../../src/services/blockchain', () => ({
      executeChainCommand: fabricClient.executeChainCommand,
    }));

    return {
      worker: require('../../src/workers/chainOutboxWorker'),
      chainOutbox,
      fabricClient,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.dontMock('../../src/services/chainOutbox');
    jest.dontMock('../../src/fabric/connect');
    jest.dontMock('../../src/services/blockchain');
  });

  test('does not start a timer or process work on import', async () => {
    const { worker, fabricClient } = loadWorker();

    await jest.advanceTimersByTimeAsync(60_000);

    expect(fabricClient.ensureFabricConnected).not.toHaveBeenCalled();
    await worker.stopChainOutboxWorker();
  });

  test('prevents duplicate timers and overlapping ticks, then awaits the in-flight tick on stop', async () => {
    const execution = deferred();
    const executeChainCommand = jest.fn(() => execution.promise);
    const { worker, fabricClient } = loadWorker({ executeChainCommand });

    worker.startChainOutboxWorker({ intervalMs: 100 });
    worker.startChainOutboxWorker({ intervalMs: 100 });
    await jest.advanceTimersByTimeAsync(100);
    expect(executeChainCommand).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(500);
    expect(fabricClient.ensureFabricConnected).toHaveBeenCalledTimes(1);
    expect(executeChainCommand).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = worker.stopChainOutboxWorker().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    execution.resolve({
      txId: 'tx-timer',
      blockNumber: 1,
      ledgerEpoch: 'timer-epoch',
      reconciled: false,
    });
    await stopping;
    expect(stopped).toBe(true);

    await jest.advanceTimersByTimeAsync(500);
    expect(fabricClient.ensureFabricConnected).toHaveBeenCalledTimes(1);
  });

  test('reports a PERSISTENCE_FAILED result while containing the background tick', async () => {
    const persistenceError = new Error('transaction commit result is ambiguous');
    const reporter = jest.fn();
    const { worker } = loadWorker({
      chainOutboxOverrides: {
        completeOperation: jest.fn().mockRejectedValue(persistenceError),
      },
    });

    worker.startChainOutboxWorker({ intervalMs: 100, errorReporter: reporter });
    await jest.advanceTimersByTimeAsync(100);

    expect(reporter).toHaveBeenCalledWith(
      persistenceError,
      expect.objectContaining({ state: 'PERSISTENCE_FAILED' })
    );
    await expect(worker.stopChainOutboxWorker()).resolves.toBeUndefined();
  });

  test('reports an unexpected rejected tick without creating an unhandled rejection', async () => {
    const databaseError = new Error('Mongo unavailable during lease recovery');
    const reporter = jest.fn();
    const { worker } = loadWorker({
      chainOutboxOverrides: {
        recoverExpiredLeases: jest.fn().mockRejectedValue(databaseError),
      },
    });

    worker.startChainOutboxWorker({ intervalMs: 100, errorReporter: reporter });
    await jest.advanceTimersByTimeAsync(100);

    expect(reporter).toHaveBeenCalledWith(
      databaseError,
      expect.objectContaining({ state: 'TICK_REJECTED' })
    );
    await expect(worker.stopChainOutboxWorker()).resolves.toBeUndefined();
  });

  test('does not report an expected retry outcome as a scheduler failure', async () => {
    const reporter = jest.fn();
    const { worker } = loadWorker({
      executeChainCommand: jest.fn().mockRejectedValue(new Error('chaincode conflict')),
    });

    worker.startChainOutboxWorker({ intervalMs: 100, errorReporter: reporter });
    await jest.advanceTimersByTimeAsync(100);

    expect(reporter).not.toHaveBeenCalled();
    await expect(worker.stopChainOutboxWorker()).resolves.toBeUndefined();
  });
});
