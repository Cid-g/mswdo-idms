const { connect } = require('@hyperledger/fabric-gateway');
const grpc        = require('@grpc/grpc-js');
const crypto      = require('node:crypto');
const fs          = require('node:fs');

const CHANNEL_NAME   = 'mychannel';
const CHAINCODE_NAME = 'id-contract';

let gateway = null;
let client  = null;

async function connectToFabric() {
  const tlsCert   = fs.readFileSync(process.env.FABRIC_TLS_CERT_PATH);
  const credentials = grpc.credentials.createSsl(tlsCert);

  client = new grpc.Client(
    `${process.env.FABRIC_PEER_HOST}:${process.env.FABRIC_PEER_PORT}`,
    credentials,
    { 'grpc.ssl_target_name_override': process.env.FABRIC_PEER_NAME }
  );

  const privateKeyPem  = fs.readFileSync(process.env.FABRIC_PRIVATE_KEY_PATH);
  const certificatePem = fs.readFileSync(process.env.FABRIC_CERT_PATH).toString();
  const privateKey     = crypto.createPrivateKey(privateKeyPem);

  gateway = connect({
    client,
    identity: {
      mspId:       process.env.FABRIC_MSP_ID,
      credentials: Buffer.from(certificatePem),
    },
    signer: {
      sign: (digest) => crypto.sign(undefined, Buffer.from(digest), privateKey),
    },
  });

  console.log('[Fabric] Gateway connected');
  return gateway;
}

function getContract() {
  if (!gateway) throw new Error('Fabric gateway not initialized');
  return gateway.getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME);
}

function disconnectFromFabric() {
  if (gateway) { gateway.close(); gateway = null; }
  if (client)  { client.close();  client  = null; }
}

module.exports = { connectToFabric, getContract, disconnectFromFabric };
