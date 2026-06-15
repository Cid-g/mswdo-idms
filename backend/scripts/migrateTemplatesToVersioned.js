/**
 * Migration: convert per-side IDTemplate docs into IDTemplate (parent) + IDTemplateVersion (v1).
 *
 * Old shape: { department, side, name, templateImagePath, placeholderConfig, version,
 *              isActive, uploadedById }  — one doc per (department, side).
 *
 * New shape: IDTemplate        { department (unique), activeVersionId }
 *            IDTemplateVersion { templateId, versionNumber, note,
 *                                front: { imagePath, placeholderConfig },
 *                                back:  { imagePath, placeholderConfig },
 *                                uploadedById }
 *
 * Idempotent: skips if all docs are already new-shape. Aborts on mixed state.
 *
 * Strategy (safe order — old docs preserved until new structure is fully in place):
 *   1. Read all old-shape docs into memory.
 *   2. Create new parent + v1 per department (additive — old index has no conflict
 *      because new parents have side=null, old docs have side=front/back).
 *   3. Delete old-shape docs.
 *   4. Drop the old (department, side) unique index.
 *   5. Sync new indexes (creates department-unique on parent).
 *
 * Usage: node scripts/migrateTemplatesToVersioned.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

// Disable autoIndex so requiring the models doesn't create the new department-unique
// index while old duplicate-department docs still exist.
mongoose.set('autoIndex', false);

const IDTemplate        = require('../src/models/IDTemplate');
const IDTemplateVersion = require('../src/models/IDTemplateVersion');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mswdo_idms';

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log(`Connected to MongoDB: ${MONGODB_URI}\n`);

  const raw = mongoose.connection.db.collection('idtemplates');

  const oldDocs = await raw.find({ side: { $exists: true } }).toArray();
  const newDocs = await raw.find({ side: { $exists: false } }).toArray();

  if (oldDocs.length === 0 && newDocs.length === 0) {
    console.log('No IDTemplate docs found. Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  if (oldDocs.length === 0) {
    console.log('All IDTemplate docs are already new-shape. Syncing indexes only.');
    await IDTemplate.syncIndexes();
    await IDTemplateVersion.syncIndexes();
    await mongoose.disconnect();
    return;
  }

  if (newDocs.length > 0) {
    console.error('Mixed state: old-shape and new-shape docs co-exist.');
    console.error(`  Old-shape: ${oldDocs.length}, New-shape: ${newDocs.length}`);
    console.error('Restore from backup and re-run.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`Found ${oldDocs.length} old-shape docs. Migrating...\n`);

  // Group by department.
  const byDept = {};
  for (const doc of oldDocs) {
    if (!byDept[doc.department]) byDept[doc.department] = {};
    byDept[doc.department][doc.side] = doc;
  }

  // Phase 1: Create new parent + v1 per dept (old docs preserved).
  for (const dept of Object.keys(byDept)) {
    const front = byDept[dept].front;
    const back  = byDept[dept].back;

    const template = await IDTemplate.create({ department: dept, activeVersionId: null });

    const version = await IDTemplateVersion.create({
      templateId:    template._id,
      versionNumber: 1,
      note:          'Initial version (migrated from per-side templates)',
      front: {
        imagePath:         front?.templateImagePath || null,
        placeholderConfig: front?.placeholderConfig || {},
      },
      back: {
        imagePath:         back?.templateImagePath || null,
        placeholderConfig: back?.placeholderConfig || {},
      },
      uploadedById: front?.uploadedById || back?.uploadedById || null,
    });

    template.activeVersionId = version._id;
    await template.save();

    console.log(
      `  Created ${dept}: parent=${template._id}, v1=${version._id} ` +
      `(front=${front ? 'Y' : '-'}, back=${back ? 'Y' : '-'})`
    );
  }

  // Phase 2: Delete old-shape docs.
  const result = await raw.deleteMany({ _id: { $in: oldDocs.map((d) => d._id) } });
  console.log(`\nDeleted ${result.deletedCount} old-shape docs.`);

  // Phase 3: Drop the old (department, side) unique index.
  try {
    await raw.dropIndex('department_1_side_1');
    console.log('Dropped old (department, side) unique index.');
  } catch (err) {
    if (err.codeName !== 'IndexNotFound') throw err;
  }

  // Phase 4: Sync new indexes.
  await IDTemplate.syncIndexes();
  await IDTemplateVersion.syncIndexes();
  console.log('Synced new indexes.');

  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
