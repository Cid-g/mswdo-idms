'use strict';

const { connect } = require('@hyperledger/fabric-gateway');
const grpc = require('@grpc/grpc-js');
const crypto = require('node:crypto');
const fs = require('node:fs');

const CHANNEL_NAME = process.env.FABRIC_CHANNEL_NAME || 'mychannel';
const CHAINCODE_NAME = 'id-contract';
const QSCC_CHAINCODE_NAME = 'qscc';

let gateway = null;
let client = null;
let connected = false;
let connectPromise = null;

function closeResources() {
  connected = false;

  if (gateway) {
    try {
      gateway.close();
    } catch (_) {
      // Closing a failed gateway is best-effort.
    }
    gateway = null;
  }

  if (client) {
    try {
      client.close();
    } catch (_) {
      // Closing a failed gRPC client is best-effort.
    }
    client = null;
  }
}

function contractFor(chaincodeName) {
  if (!gateway || !connected) {
    throw new Error('Fabric gateway is not connected');
  }
  return gateway.getNetwork(CHANNEL_NAME).getContract(chaincodeName);
}

async function openAndProbe() {
  closeResources();

  try {
    const tlsCert = fs.readFileSync(process.env.FABRIC_TLS_CERT_PATH);
    const credentials = grpc.credentials.createSsl(tlsCert);

    client = new grpc.Client(
      `${process.env.FABRIC_PEER_HOST}:${process.env.FABRIC_PEER_PORT}`,
      credentials,
      { 'grpc.ssl_target_name_override': process.env.FABRIC_PEER_NAME }
    );

    const privateKeyPem = fs.readFileSync(process.env.FABRIC_PRIVATE_KEY_PATH);
    const certificatePem = fs.readFileSync(process.env.FABRIC_CERT_PATH).toString();
    const privateKey = crypto.createPrivateKey(privateKeyPem);

    gateway = connect({
      client,
      identity: {
        mspId: process.env.FABRIC_MSP_ID,
        credentials: Buffer.from(certificatePem),
      },
      signer: {
        sign: (digest) => crypto.sign(undefined, Buffer.from(digest), privateKey),
      },
    });

    const healthContract = gateway.getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME);
    await healthContract.evaluateTransaction('verifyID', '__health__');
    connected = true;
    return { available: true };
  } catch (error) {
    closeResources();
    throw error;
  }
}

function ensureFabricConnected() {
  if (process.env.FABRIC_ENABLED !== 'true') {
    return Promise.resolve({ available: false, reason: 'DISABLED' });
  }
  if (connected) return Promise.resolve({ available: true });
  if (connectPromise) return connectPromise;

  connectPromise = openAndProbe().finally(() => {
    connectPromise = null;
  });
  return connectPromise;
}

function isFabricConnected() {
  return connected;
}

function markFabricDisconnected(_error) {
  closeResources();
}

function getContract() {
  return contractFor(CHAINCODE_NAME);
}

function getQsccContract() {
  return contractFor(QSCC_CHAINCODE_NAME);
}

async function connectToFabric() {
  const availability = await ensureFabricConnected();
  return availability.available ? gateway : availability;
}

function disconnectFromFabric() {
  closeResources();
}

module.exports = {
  connectToFabric,
  disconnectFromFabric,
  ensureFabricConnected,
  getContract,
  getQsccContract,
  isFabricConnected,
  markFabricDisconnected,
};
