const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

const REFRESH_DAYS = 7;

function signAccessToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role, department: user.department },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

function refreshExpiry() {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_DAYS);
  return d;
}

// POST /auth/login
async function login(req, res, next) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Username and password are required.' },
      });
    }

    const user = await User.findOne({ username });

    // Return same message for both "not found" and "wrong password" — no info leak
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid username or password.' },
      });
    }

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Account is inactive or suspended. Contact your administrator.' },
      });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid username or password.' },
      });
    }

    const accessToken = signAccessToken(user);

    const tokenDoc = await RefreshToken.create({
      userId: user._id,
      token: uuidv4(),
      expiresAt: refreshExpiry(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    return res.json({
      accessToken,
      refreshToken: tokenDoc.token,
      user: {
        id: user._id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        department: user.department,
      },
    });
  } catch (err) {
    next(err);
  }
}

// POST /auth/refresh
async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Refresh token required.' },
      });
    }

    const tokenDoc = await RefreshToken.findOne({ token: refreshToken });

    if (!tokenDoc || tokenDoc.revokedAt || tokenDoc.expiresAt < new Date()) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token.' },
      });
    }

    const user = await User.findById(tokenDoc.userId);
    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'User account is no longer active.' },
      });
    }

    // Rotate: revoke old, issue new
    const newToken = uuidv4();
    await RefreshToken.findByIdAndUpdate(tokenDoc._id, {
      revokedAt: new Date(),
      replacedBy: newToken,
    });
    await RefreshToken.create({
      userId: user._id,
      token: newToken,
      expiresAt: refreshExpiry(),
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    const accessToken = signAccessToken(user);

    return res.json({ accessToken, refreshToken: newToken });
  } catch (err) {
    next(err);
  }
}

// POST /auth/logout  (requires authenticate middleware)
async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await RefreshToken.findOneAndUpdate(
        { token: refreshToken, revokedAt: null },
        { revokedAt: new Date() }
      );
    }
    return res.json({ message: 'Logged out' });
  } catch (err) {
    next(err);
  }
}

// GET /auth/me  (requires authenticate middleware)
async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found.' },
      });
    }
    return res.json(user);
  } catch (err) {
    next(err);
  }
}

module.exports = { login, refresh, logout, me };
