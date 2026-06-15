const AuditLog = require('../models/AuditLog');
const User     = require('../models/User');

// ── GET /audit-logs ────────────────────────────────────────────────────────────
// SA: all depts | ADMIN: own dept only
// Query: department, userId, action, targetType, from, to, page, limit
async function getAuditLogs(req, res, next) {
  try {
    const {
      department, userId, action, targetType, search,
      from, to,
      page  = 1,
      limit = 50,
      export: doExport,
    } = req.query;

    const filter = {};

    // Dept scoping
    if (req.user.role === 'ADMIN') {
      filter.department = req.user.department;
    } else if (department) {
      filter.department = department;
    }

    if (userId)     filter.userId     = userId;
    if (action)     filter.action     = action;
    else            filter.action     = { $not: /[:\/]/ }; // hide legacy raw API-call logs
    if (targetType) filter.targetType = targetType;
    if (search)     filter.description = { $regex: search, $options: 'i' };

    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    // CSV export — return all matching rows (capped at 10 000)
    if (doExport === 'csv') {
      const logs = await AuditLog
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(10000)
        .populate('userId', 'firstName lastName username role department');

      const rows = [
        ['Timestamp', 'Action', 'User', 'Role', 'Department', 'Target Type', 'Target ID', 'Description', 'IP Address'].join(','),
        ...logs.map((l) => {
          const u = l.userId;
          const name = u ? `${u.firstName} ${u.lastName}` : 'System';
          return [
            new Date(l.createdAt).toISOString(),
            l.action,
            `"${name}"`,
            u?.role ?? '',
            l.department ?? '',
            l.targetType ?? '',
            l.targetId   ?? '',
            `"${(l.description ?? '').replace(/"/g, '""')}"`,
            l.ipAddress  ?? '',
          ].join(',');
        }),
      ].join('\r\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      return res.send(rows);
    }

    // Paginated JSON response
    const skip    = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const limitN  = Math.min(parseInt(limit, 10), 200);

    const [data, total] = await Promise.all([
      AuditLog
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitN)
        .populate('userId', 'firstName lastName username role department'),
      AuditLog.countDocuments(filter),
    ]);

    res.json({ data, total });
  } catch (err) {
    next(err);
  }
}

// ── GET /audit-logs/actions ────────────────────────────────────────────────────
// Returns distinct action codes present in the collection (for filter dropdown)
async function getAuditActions(req, res, next) {
  try {
    const filter = {};
    if (req.user.role === 'ADMIN') filter.department = req.user.department;
    const actions = await AuditLog.distinct('action', filter);
    // Exclude legacy raw API-call action codes (e.g. "PATCH:/:id")
    res.json(actions.filter((a) => !/[:\/]/.test(a)).sort());
  } catch (err) {
    next(err);
  }
}

// ── GET /audit-logs/users ──────────────────────────────────────────────────────
// Staff who appear in the logs, for the "Staff" filter dropdown.
// SA: all depts | ADMIN: own dept only
async function getAuditUsers(req, res, next) {
  try {
    const match = {};
    if (req.user.role === 'ADMIN') match.department = req.user.department;
    const ids = await AuditLog.distinct('userId', match);
    const users = await User
      .find({ _id: { $in: ids.filter(Boolean) } })
      .select('firstName lastName role department')
      .sort({ firstName: 1, lastName: 1 });
    res.json(users);
  } catch (err) {
    next(err);
  }
}

module.exports = { getAuditLogs, getAuditActions, getAuditUsers };
