'use strict';

const { connect, signers } = require('@hyperledger/fabric-gateway');
const grpc = require('@grpc/grpc-js');
const crypto = require('node:crypto');
const fs = require('node:fs');

const CHANNEL_NAME = process.env.FABRIC_CHANNEL_NAME || 'mychannel';
const CHAINCODE_NAME = 'id-contract';
const QSCC_CHAINCODE_NAME = 'qscc';

// The first reconnect waits 250 ms, then 1 s, then at most 5 s. The manager
// owns this serialized infrastructure delay; outbox attempt counters do not.
const RECONNECT_DELAYS_MS = Object.freeze([250, 1000, 5000]);

let generation = 0;
let activeConnection = null;
let connectAttempt = null;
let consecutiveFailures = 0;

function closeConnection(connection) {
  if (!connection || connection.closed) return;
  connection.closed = true;

  try {
    connection.gateway?.close();
  } catch (_) {
    // Closing a failed gateway is best-effort.
  }
  try {
    connection.client.close();
  } catch (_) {
    // Closing a failed gRPC client is best-effort.
  }
}

function supersededError() {
  const error = new Error('Fabric connection attempt was superseded');
  error.code = 'FABRIC_CONNECTION_SUPERSEDED';
  return error;
}

function attemptIsCurrent(attempt) {
  return connectAttempt === attempt && generation === attempt.generation;
}

function reconnectDelay() {
  if (consecutiveFailures === 0) return 0;
  const index = Math.min(consecutiveFailures - 1, RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index];
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function openAndProbe(attempt) {
  try {
    if (attempt.delayMs > 0) await wait(attempt.delayMs);
    if (!attemptIsCurrent(attempt)) throw supersededError();

    const tlsCert = fs.readFileSync(process.env.FABRIC_TLS_CERT_PATH);
    const credentials = grpc.credentials.createSsl(tlsCert);
    const localClient = new grpc.Client(
      `${process.env.FABRIC_PEER_HOST}:${process.env.FABRIC_PEER_PORT}`,
      credentials,
      { 'grpc.ssl_target_name_override': process.env.FABRIC_PEER_NAME }
    );
    attempt.connection = {
      generation: attempt.generation,
      gateway: null,
      client: localClient,
      closed: false,
    };

    const privateKeyPem = fs.readFileSync(process.env.FABRIC_PRIVATE_KEY_PATH);
    const certificatePem = fs.readFileSync(process.env.FABRIC_CERT_PATH).toString();
    const privateKey = crypto.createPrivateKey(privateKeyPem);
    const localGateway = connect({
      client: localClient,
      identity: {
        mspId: process.env.FABRIC_MSP_ID,
        credentials: Buffer.from(certificatePem),
      },
      signer: signers.newPrivateKeySigner(privateKey),
    });
    attempt.connection.gateway = localGateway;

    const healthContract = localGateway.getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME);
    await healthContract.evaluateTransaction('verifyID', '__health__');
    if (!attemptIsCurrent(attempt)) throw supersededError();

    activeConnection = attempt.connection;
    attempt.connection = null;
    consecutiveFailures = 0;
    return { available: true };
  } catch (error) {
    closeConnection(attempt.connection);
    attempt.connection = null;
    if (attemptIsCurrent(attempt) && error.code !== 'FABRIC_CONNECTION_SUPERSEDED') {
      consecutiveFailures += 1;
    }
    throw error;
  }
}

function ensureFabricConnected() {
  if (process.env.FABRIC_ENABLED !== 'true') {
    return Promise.resolve({ available: false, reason: 'DISABLED' });
  }
  if (activeConnection) return Promise.resolve({ available: true });
  if (connectAttempt) return connectAttempt.promise;

  const attempt = {
    generation: ++generation,
    delayMs: reconnectDelay(),
    connection: null,
    promise: null,
  };
  connectAttempt = attempt;
  attempt.promise = openAndProbe(attempt).finally(() => {
    if (connectAttempt === attempt) connectAttempt = null;
  });
  return attempt.promise;
}

function isFabricConnected() {
  return activeConnection !== null;
}

function isConnectivityError(error) {
  return error?.code === grpc.status.UNAVAILABLE
    || error?.code === grpc.status.DEADLINE_EXCEEDED;
}

function markFabricDisconnected(error, originatingGeneration = activeConnection?.generation) {
  if (!isConnectivityError(error)) return false;
  if (!activeConnection || activeConnection.generation !== originatingGeneration) return false;

  generation += 1;
  const staleConnection = activeConnection;
  activeConnection = null;
  consecutiveFailures += 1;
  closeConnection(staleConnection);
  return true;
}

function contractFor(chaincodeName) {
  if (!activeConnection) throw new Error('Fabric gateway is not connected');
  return activeConnection.gateway.getNetwork(CHANNEL_NAME).getContract(chaincodeName);
}

function getContract() {
  return contractFor(CHAINCODE_NAME);
}

function getQsccContract() {
  return contractFor(QSCC_CHAINCODE_NAME);
}

function getFabricGeneration() {
  return activeConnection?.generation ?? null;
}

async function connectToFabric() {
  const availability = await ensureFabricConnected();
  return availability.available ? activeConnection.gateway : availability;
}

function disconnectFromFabric() {
  generation += 1;
  consecutiveFailures = 0;

  if (connectAttempt) {
    closeConnection(connectAttempt.connection);
    connectAttempt.connection = null;
    connectAttempt = null;
  }

  const connection = activeConnection;
  activeConnection = null;
  closeConnection(connection);
}

module.exports = {
  connectToFabric,
  disconnectFromFabric,
  ensureFabricConnected,
  getContract,
  getFabricGeneration,
  getQsccContract,
  isFabricConnected,
  markFabricDisconnected,
};
