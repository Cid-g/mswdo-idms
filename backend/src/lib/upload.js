const multer = require('multer');

const imgFilter = (_req, file, cb) => {
  if (['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error('Only JPEG/PNG/WebP images are allowed.');
    err.code = 'INVALID_FILE_TYPE';
    cb(err, false);
  }
};

exports.photoUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imgFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

exports.signatureUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imgFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
});

exports.templateUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: imgFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});
