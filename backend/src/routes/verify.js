const router = require('express').Router();
const { verifyByToken } = require('../controllers/verifyController');

// Public — no authentication required
router.get('/:token', verifyByToken);

module.exports = router;
