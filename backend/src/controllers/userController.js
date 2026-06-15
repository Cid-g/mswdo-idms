const bcrypt = require('bcryptjs');
const { z } = require('zod');
const User = require('../models/User');
const { DEPARTMENTS, USER_STATUS } = require('../lib/constants');
const { processAvatar, deleteUploadFile } = require('../services/imageProcessing');

const BCRYPT_COST = 12;
const ADMIN_CREATABLE_ROLES = ['ENCODER', 'RELEASING_STAFF'];

function safeUser(user) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.passwordHash;
  if (obj.avatarPath) obj.avatarUrl = `/api/files/${obj.avatarPath}`;
  return obj;
}

// ─── Zod schemas ───────────────────────────────────────────────────────────
const createUserSchema = z.object({
  firstName:  z.string().min(1, 'First name is required'),
  lastName:   z.string().min(1, 'Last name is required'),
  middleName: z.string().optional(),
  username:   z.string().min(3, 'Min 3 characters')
               .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, dots, dashes, underscores only'),
  email:      z.string().email('Invalid email'),
  password:   z.string().min(8, 'Password must be at least 8 characters'),
  role:       z.enum(['ADMIN', 'ENCODER', 'RELEASING_STAFF']),
  department: z.enum(DEPARTMENTS).optional(),
});

const updateUserSchema = z.object({
  firstName:  z.string().min(1).optional(),
  lastName:   z.string().min(1).optional(),
  middleName: z.string().optional(),
  email:      z.string().email().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(USER_STATUS),
});

const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

const changeOwnPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
});

// ─── POST /users ───────────────────────────────────────────────────────────
async function createUser(req, res, next) {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const { firstName, lastName, middleName, username, email, password, role, department } = parsed.data;
    const creatorRole = req.user.role;

    // Role permission enforcement
    if (creatorRole === 'SUPERADMIN' && role !== 'ADMIN') {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'SuperAdmin can only create Admin accounts.' },
      });
    }
    if (creatorRole === 'ADMIN' && !ADMIN_CREATABLE_ROLES.includes(role)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'Admin can only create Encoder or Releasing Staff accounts.' },
      });
    }
    if (creatorRole === 'SUPERADMIN' && !department) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Department is required when creating an Admin account.' },
      });
    }

    // Admin: force department to their own
    const finalDept = creatorRole === 'ADMIN' ? req.user.department : (department ?? null);

    // Duplicate check
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) {
      const field = existing.username === username ? 'username' : 'email';
      return res.status(409).json({
        error: { code: 'CONFLICT', message: `That ${field} is already taken.` },
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await User.create({
      firstName, lastName, middleName,
      username, email, passwordHash,
      role, department: finalDept,
      createdById: req.user.id,
    });

    return res.status(201).json(safeUser(user));
  } catch (err) {
    next(err);
  }
}

// ─── GET /users ────────────────────────────────────────────────────────────
async function getUsers(req, res, next) {
  try {
    const { department, role, status, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (req.user.role === 'ADMIN') {
      filter.department = req.user.department;
      filter.role = { $in: ADMIN_CREATABLE_ROLES };
    } else {
      if (department) filter.department = department;
    }

    if (role) {
      // Admin already has role filter locked; SA can override
      if (req.user.role !== 'ADMIN') filter.role = role;
    }
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total] = await Promise.all([
      User.find(filter).select('-passwordHash').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      User.countDocuments(filter),
    ]);

    return res.json({ data: users, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    next(err);
  }
}

// ─── GET /users/:id ────────────────────────────────────────────────────────
async function getUserById(req, res, next) {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }
    if (req.user.role === 'ADMIN' && user.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    return res.json(user);
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /users/:id ─────────────────────────────────────────────────────
async function updateUser(req, res, next) {
  try {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }
    if (req.user.role === 'ADMIN' && user.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    if (parsed.data.email && parsed.data.email !== user.email) {
      const taken = await User.findOne({ email: parsed.data.email });
      if (taken) {
        return res.status(409).json({ error: { code: 'CONFLICT', message: 'Email is already in use.' } });
      }
    }

    Object.assign(user, parsed.data);
    await user.save();

    return res.json(safeUser(user));
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /users/:id/status ───────────────────────────────────────────────
async function updateStatus(req, res, next) {
  try {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid status value.', details: parsed.error.flatten() },
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }
    if (req.user.role === 'ADMIN' && user.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }
    if (user._id.toString() === req.user.id) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'You cannot change your own account status.' },
      });
    }

    user.status = parsed.data.status;
    await user.save();

    return res.json(safeUser(user));
  } catch (err) {
    next(err);
  }
}

// ─── POST /users/:id/reset-password ───────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters.' },
      });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    }
    if (req.user.role === 'ADMIN' && user.department !== req.user.department) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied.' } });
    }

    user.passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_COST);
    await user.save();

    return res.json({ message: 'Password reset successful.' });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /users/me/profile ───────────────────────────────────────────────
const updateProfileSchema = z.object({
  firstName: z.string().min(1, 'First name is required').optional(),
  lastName:  z.string().min(1, 'Last name is required').optional(),
});

async function updateOwnProfile(req, res, next) {
  try {
    const parsed = updateProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });

    if (parsed.data.firstName) user.firstName = parsed.data.firstName;
    if (parsed.data.lastName)  user.lastName  = parsed.data.lastName;

    if (req.file) {
      const oldPath = user.avatarPath;
      const { relPath } = await processAvatar(req.file.buffer);
      user.avatarPath = relPath;
      if (oldPath) await deleteUploadFile(oldPath);
    }

    await user.save();
    return res.json(safeUser(user));
  } catch (err) {
    next(err);
  }
}

// ─── PATCH /users/me/password ──────────────────────────────────────────────
async function changeOwnPassword(req, res, next) {
  try {
    const parsed = changeOwnPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input.', details: parsed.error.flatten() },
      });
    }
    const { currentPassword, newPassword } = parsed.data;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'User not found.' } });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' } });
    }
    user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await user.save();
    return res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createUser, getUsers, getUserById, updateUser, updateStatus, resetPassword, changeOwnPassword, updateOwnProfile };
