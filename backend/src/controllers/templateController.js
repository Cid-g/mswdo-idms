const path  = require('path');
const fs    = require('fs');
const sharp = require('sharp');
const IDTemplate        = require('../models/IDTemplate');
const IDTemplateVersion = require('../models/IDTemplateVersion');
const AuditLog          = require('../models/AuditLog');

const DEPT_LABEL = { PWD: 'PWD', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen' };

function logTemplate(req, action, description, targetId, meta = {}) {
  AuditLog.create({
    userId: req.user.id,
    action,
    department: req.user.department ?? meta.department,
    targetType: 'IDTemplateVersion',
    targetId: String(targetId),
    description,
    ipAddress: req.ip,
    userAgent: req.get('User-Agent'),
    metadata: meta,
  }).catch((err) => console.error('[AuditLog] write error:', err.message));
}

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads/templates');

function imageUrl(imagePath) {
  if (!imagePath) return null;
  return `/api/files/templates/${path.basename(imagePath)}`;
}

function serializeVersion(version) {
  const obj = version.toObject();
  if (obj.front) obj.front.imageUrl = imageUrl(obj.front.imagePath);
  if (obj.back)  obj.back.imageUrl  = imageUrl(obj.back.imagePath);
  return obj;
}

async function saveImageBuffer(buffer, dept, side) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const filename = `template-${dept.toLowerCase()}-${side}-${Date.now()}.png`;
  const filePath = path.join(UPLOADS_DIR, filename);
  await sharp(buffer).png().toFile(filePath);
  return filePath;
}

function authorizeDept(user, dept) {
  return user.role === 'SUPERADMIN' || user.department === dept;
}

// GET /templates?department=X
async function getTemplate(req, res, next) {
  try {
    const dept = req.user.role === 'SUPERADMIN'
      ? req.query.department
      : req.user.department;

    if (!dept) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Department is required.' } });
    }

    const template = await IDTemplate.findOne({ department: dept });
    if (!template || !template.activeVersionId) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No template configured for this department.' } });
    }

    const activeVersion = await IDTemplateVersion
      .findById(template.activeVersionId)
      .populate('uploadedById', 'firstName lastName username');

    return res.json({
      template: {
        _id:             template._id,
        department:      template.department,
        activeVersionId: template.activeVersionId,
        createdAt:       template.createdAt,
        updatedAt:       template.updatedAt,
      },
      activeVersion: activeVersion ? serializeVersion(activeVersion) : null,
    });
  } catch (err) { next(err); }
}

// POST /templates/versions
// multipart fields: frontFile, backFile
// body: department, note, useCurrentFront ('true'/'false'), useCurrentBack ('true'/'false')
async function createVersion(req, res, next) {
  try {
    const dept = req.user.role === 'SUPERADMIN' ? req.body.department : req.user.department;
    if (!dept) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Department is required.' } });
    }
    if (!authorizeDept(req.user, dept)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const useCurrentFront = String(req.body.useCurrentFront) === 'true';
    const useCurrentBack  = String(req.body.useCurrentBack)  === 'true';
    const frontFile       = req.files?.frontFile?.[0];
    const backFile        = req.files?.backFile?.[0];

    let template = await IDTemplate.findOne({ department: dept });
    if (!template) {
      template = await IDTemplate.create({ department: dept, activeVersionId: null });
    }

    const currentVersion = template.activeVersionId
      ? await IDTemplateVersion.findById(template.activeVersionId)
      : null;

    // First-ever version requires at least a front image.
    if (!currentVersion && !frontFile) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Front image is required for the first version.' },
      });
    }

    // For subsequent versions: each side must be either (a) a new file, or (b) "use current" with the current version having that side, or (c) explicitly left empty.
    if (currentVersion && !frontFile && !useCurrentFront) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Front: provide a new image or enable "Use current front".' },
      });
    }

    const frontData = { imagePath: null, placeholderConfig: {} };
    if (frontFile) {
      frontData.imagePath         = await saveImageBuffer(frontFile.buffer, dept, 'front');
      frontData.placeholderConfig = currentVersion?.front?.placeholderConfig || {};
    } else if (useCurrentFront && currentVersion?.front?.imagePath) {
      frontData.imagePath         = currentVersion.front.imagePath;
      frontData.placeholderConfig = currentVersion.front.placeholderConfig || {};
    }

    const backData = { imagePath: null, placeholderConfig: {} };
    if (backFile) {
      backData.imagePath         = await saveImageBuffer(backFile.buffer, dept, 'back');
      backData.placeholderConfig = currentVersion?.back?.placeholderConfig || {};
    } else if (useCurrentBack && currentVersion?.back?.imagePath) {
      backData.imagePath         = currentVersion.back.imagePath;
      backData.placeholderConfig = currentVersion.back.placeholderConfig || {};
    }

    const latest = await IDTemplateVersion
      .findOne({ templateId: template._id })
      .sort({ versionNumber: -1 });
    const nextVersionNumber = (latest?.versionNumber || 0) + 1;

    const newVersion = await IDTemplateVersion.create({
      templateId:    template._id,
      versionNumber: nextVersionNumber,
      note:          req.body.note || '',
      front:         frontData,
      back:          backData,
      uploadedById:  req.user.id,
    });

    template.activeVersionId = newVersion._id;
    await template.save();

    const populated = await IDTemplateVersion
      .findById(newVersion._id)
      .populate('uploadedById', 'firstName lastName username');

    const obj = serializeVersion(populated);
    obj.department = template.department;
    obj.isActive   = true;

    logTemplate(req, 'TEMPLATE_VERSION_CREATED',
      `Template version v${nextVersionNumber} uploaded for ${DEPT_LABEL[dept] ?? dept} department`,
      newVersion._id, { versionNumber: nextVersionNumber, department: dept });

    return res.status(201).json(obj);
  } catch (err) { next(err); }
}

// GET /templates/:templateId/versions
async function listVersions(req, res, next) {
  try {
    const template = await IDTemplate.findById(req.params.templateId);
    if (!template) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Template not found.' } });
    }
    if (!authorizeDept(req.user, template.department)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const versions = await IDTemplateVersion
      .find({ templateId: template._id })
      .sort({ versionNumber: -1 })
      .populate('uploadedById', 'firstName lastName username');

    return res.json({
      templateId:      template._id,
      department:      template.department,
      activeVersionId: template.activeVersionId,
      versions:        versions.map(serializeVersion),
    });
  } catch (err) { next(err); }
}

// GET /templates/versions/:versionId
async function getVersion(req, res, next) {
  try {
    const version = await IDTemplateVersion
      .findById(req.params.versionId)
      .populate('uploadedById', 'firstName lastName username');
    if (!version) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found.' } });
    }

    const template = await IDTemplate.findById(version.templateId);
    if (!template) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Parent template not found.' } });
    }
    if (!authorizeDept(req.user, template.department)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const obj = serializeVersion(version);
    obj.department = template.department;
    obj.isActive   = String(template.activeVersionId) === String(version._id);
    return res.json(obj);
  } catch (err) { next(err); }
}

// PATCH /templates/versions/:versionId/activate
async function activateVersion(req, res, next) {
  try {
    const version = await IDTemplateVersion.findById(req.params.versionId);
    if (!version) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found.' } });
    }
    const template = await IDTemplate.findById(version.templateId);
    if (!template) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Parent template not found.' } });
    }
    if (!authorizeDept(req.user, template.department)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    template.activeVersionId = version._id;
    await template.save();

    logTemplate(req, 'TEMPLATE_ACTIVATED',
      `Template version v${version.versionNumber} set as active for ${DEPT_LABEL[template.department] ?? template.department} department`,
      version._id, { versionNumber: version.versionNumber, department: template.department });

    return res.json({
      templateId:       template._id,
      activeVersionId:  template.activeVersionId,
      activatedVersion: version.versionNumber,
    });
  } catch (err) { next(err); }
}

// PATCH /templates/versions/:versionId/config
// body: { side: 'front'|'back', placeholderConfig: {...} }
// only the active version is editable
async function updateVersionConfig(req, res, next) {
  try {
    const { side, placeholderConfig } = req.body;
    if (!['front', 'back'].includes(side)) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'side must be "front" or "back".' } });
    }
    if (!placeholderConfig || typeof placeholderConfig !== 'object') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'placeholderConfig object is required.' } });
    }

    const version = await IDTemplateVersion.findById(req.params.versionId);
    if (!version) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found.' } });
    }
    const template = await IDTemplate.findById(version.templateId);
    if (!template) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Parent template not found.' } });
    }
    if (!authorizeDept(req.user, template.department)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    if (String(template.activeVersionId) !== String(version._id)) {
      return res.status(400).json({
        error: { code: 'NOT_ACTIVE', message: 'Placeholders can only be edited on the active version.' },
      });
    }

    version.set(`${side}.placeholderConfig`, placeholderConfig);
    version.markModified(`${side}.placeholderConfig`);
    await version.save();

    logTemplate(req, 'TEMPLATE_CONFIG_UPDATED',
      `ID field layout updated for ${DEPT_LABEL[template.department] ?? template.department} department (${side} side)`,
      version._id, { versionNumber: version.versionNumber, department: template.department, side });

    const obj = serializeVersion(version);
    obj.department = template.department;
    obj.isActive   = true;
    return res.json(obj);
  } catch (err) { next(err); }
}

// GET /templates/versions/:versionId/preview?side=front|back
async function previewVersion(req, res, next) {
  try {
    const side = req.query.side === 'back' ? 'back' : 'front';
    const version = await IDTemplateVersion.findById(req.params.versionId);
    if (!version) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Version not found.' } });
    }
    const template = await IDTemplate.findById(version.templateId);
    if (template && !authorizeDept(req.user, template.department)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    const imagePath = version[side]?.imagePath;
    if (!imagePath || !fs.existsSync(imagePath)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: `No ${side} image for this version.` } });
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(imagePath).pipe(res);
  } catch (err) { next(err); }
}

module.exports = {
  getTemplate,
  createVersion,
  listVersions,
  getVersion,
  activateVersion,
  updateVersionConfig,
  previewVersion,
};
