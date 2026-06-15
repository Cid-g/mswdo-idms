const Applicant = require('../models/Applicant');
const IDRecord  = require('../models/IDRecord');
const AuditLog  = require('../models/AuditLog');
const User      = require('../models/User');
const { buildSoloParentReports, buildPwdReports, buildSeniorReports } = require('../lib/dashboardReports');

const DEPTS = ['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN'];

function reportsBuilderFor(dept) {
  if (dept === 'SOLO_PARENT')      return buildSoloParentReports();
  if (dept === 'PWD')              return buildPwdReports();
  if (dept === 'SENIOR_CITIZEN')   return buildSeniorReports();
  return Promise.resolve(null);
}

function buildMonthSlots(count) {
  const slots = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    slots.push({
      year:  d.getFullYear(),
      month: d.getMonth() + 1,
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
    });
  }
  return slots;
}

// ── GET /dashboard/superadmin ──────────────────────────────────────────────────
async function getSuperadminDashboard(_req, res, next) {
  try {
    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - 11);
    windowStart.setDate(1);
    windowStart.setHours(0, 0, 0, 0);

    const [applicantAgg, idAgg, userAgg, trendAgg, recentActivity] = await Promise.all([
      // Counts per dept x status
      Applicant.aggregate([
        { $group: { _id: { department: '$department', status: '$status' }, count: { $sum: 1 } } },
      ]),
      // Active IDs per dept
      IDRecord.aggregate([
        { $match: { status: 'ACTIVE' } },
        { $group: { _id: '$department', count: { $sum: 1 } } },
      ]),
      // Users per dept x role (active only)
      User.aggregate([
        { $match: { status: 'ACTIVE', role: { $ne: 'SUPERADMIN' } } },
        { $group: { _id: { department: '$department', role: '$role' }, count: { $sum: 1 } } },
      ]),
      // ID issuance trend last 12 months
      IDRecord.aggregate([
        { $match: { issuedDate: { $gte: windowStart } } },
        {
          $group: {
            _id: {
              year:       { $year: '$issuedDate' },
              month:      { $month: '$issuedDate' },
              department: '$department',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      // System-wide recent activity (all departments)
      AuditLog.find({})
        .sort({ createdAt: -1 })
        .limit(15)
        .populate('userId', 'firstName lastName role'),
    ]);

    // Build totalCounts
    const totalCounts = {};
    DEPTS.forEach((d) => {
      totalCounts[d] = { applicants: 0, activeIDs: 0, partial: 0 };
    });
    applicantAgg.forEach(({ _id, count }) => {
      if (!_id.department || !totalCounts[_id.department]) return;
      totalCounts[_id.department].applicants += count;
      if (_id.status === 'PARTIAL') totalCounts[_id.department].partial = count;
    });
    idAgg.forEach(({ _id, count }) => {
      if (!_id || !totalCounts[_id]) return;
      totalCounts[_id].activeIDs = count;
    });

    // Build userCounts
    const userCounts = {};
    DEPTS.forEach((d) => {
      userCounts[d] = { admin: 0, encoder: 0, releasing_staff: 0 };
    });
    userAgg.forEach(({ _id, count }) => {
      if (!_id.department || !userCounts[_id.department]) return;
      const roleKey = _id.role?.toLowerCase().replace('_', '_') ?? '';
      if (roleKey === 'admin')           userCounts[_id.department].admin           = count;
      if (roleKey === 'encoder')         userCounts[_id.department].encoder         = count;
      if (roleKey === 'releasing_staff') userCounts[_id.department].releasing_staff = count;
    });

    // Build idTrend — 12 slots, zero-filled
    const slots = buildMonthSlots(12);
    const trendMap = {};
    slots.forEach((s) => {
      trendMap[s.key] = { month: s.key, PWD: 0, SOLO_PARENT: 0, SENIOR_CITIZEN: 0 };
    });
    trendAgg.forEach(({ _id, count }) => {
      const key = `${_id.year}-${String(_id.month).padStart(2, '0')}`;
      if (trendMap[key] && _id.department) {
        trendMap[key][_id.department] = count;
      }
    });
    const idTrend = slots.map((s) => trendMap[s.key]);

    res.json({ totalCounts, userCounts, idTrend, recentActivity });
  } catch (err) {
    next(err);
  }
}

// ── GET /dashboard/admin ───────────────────────────────────────────────────────
async function getAdminDashboard(req, res, next) {
  try {
    const dept = req.user.department;

    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - 5);
    windowStart.setDate(1);
    windowStart.setHours(0, 0, 0, 0);

    const [totalApplicants, activeIDs, partialRecords, revokedIDs, recentActivity, monthlyAgg, reports] =
      await Promise.all([
        Applicant.countDocuments({ department: dept }),
        IDRecord.countDocuments({ department: dept, status: 'ACTIVE' }),
        Applicant.countDocuments({ department: dept, status: 'PARTIAL' }),
        IDRecord.countDocuments({ department: dept, status: 'REVOKED' }),
        AuditLog.find({ department: dept })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('userId', 'firstName lastName role'),
        IDRecord.aggregate([
          { $match: { department: dept, issuedDate: { $gte: windowStart } } },
          {
            $group: {
              _id: { year: { $year: '$issuedDate' }, month: { $month: '$issuedDate' } },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
        reportsBuilderFor(dept),
      ]);

    // Build 6-slot trend, zero-filled
    const slots = buildMonthSlots(6);
    const trendMap = {};
    slots.forEach((s) => { trendMap[s.key] = { month: s.key, count: 0 }; });
    monthlyAgg.forEach(({ _id, count }) => {
      const key = `${_id.year}-${String(_id.month).padStart(2, '0')}`;
      if (trendMap[key]) trendMap[key].count = count;
    });
    const monthlyTrend = slots.map((s) => trendMap[s.key]);

    res.json({
      department: dept,
      totalApplicants,
      activeIDs,
      partialRecords,
      revokedIDs,
      recentActivity,
      monthlyTrend,
      reports,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSuperadminDashboard, getAdminDashboard };
