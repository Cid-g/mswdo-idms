const router  = require('express').Router();
const path    = require('path');
const fs      = require('fs');
const { authenticate } = require('../middleware/auth');

const MIME_MAP = {
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.pdf':  'application/pdf',
};

const VALID_TYPES  = new Set(['photos', 'signatures', 'documents', 'ids', 'templates', 'avatars']);
const PUBLIC_TYPES = new Set(['templates', 'avatars']); // no personal data — img tags work without token
const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');

// GET /files/:type/:filename
router.get('/:type/:filename', (req, res, next) => {
  if (!PUBLIC_TYPES.has(req.params.type)) return authenticate(req, res, next);
  next();
}, (req, res) => {
  const { type, filename } = req.params;

  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid file type.' } });
  }

  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(UPLOADS_ROOT, type, safe);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found.' } });
  }

  const contentType = MIME_MAP[path.extname(safe).toLowerCase()] || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
