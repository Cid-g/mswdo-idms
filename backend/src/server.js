require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mswdo_idms';

async function dropLegacyIndex(model, indexName) {
  try {
    await model.collection.dropIndex(indexName);
    console.log(`[migration] Dropped legacy index: ${indexName}`);
  } catch (err) {
    if (err.codeName !== 'IndexNotFound' && err.code !== 27) {
      console.warn(`[migration] Could not drop ${indexName} index:`, err.message);
    }
  }
}

async function runMigrations() {
  const IDTemplate = require('./models/IDTemplate');
  const IDRecord   = require('./models/IDRecord');
  await dropLegacyIndex(IDTemplate, 'department_1');
  // Legacy full-unique index on applicantId blocked re-issuing an ID after revocation.
  // Dropped so the new partial unique index (ACTIVE-only) can take effect.
  await dropLegacyIndex(IDRecord, 'applicantId_1');
}

mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log(`MongoDB connected: ${MONGODB_URI}`);
    await runMigrations();

    if (process.env.FABRIC_ENABLED === 'true') {
      const { connectToFabric } = require('./fabric/connect');
      connectToFabric().catch((err) => {
        console.error('[Fabric] Connection failed — blockchain calls will error:', err.message);
      });
    } else {
      console.log('[Fabric] FABRIC_ENABLED=false — blockchain integration disabled');
    }

    app.listen(PORT, () => {
      console.log(`Backend running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });
