'use strict';

const { listReportsForDept, isAvailable, getReport } = require('../lib/reports');
const { tableToWorkbook } = require('../lib/reports/excel');

function listReports(req, res, next) {
  try {
    res.json({ reports: listReportsForDept(req.user.department) });
  } catch (err) { next(err); }
}

async function getReportData(req, res, next) {
  try {
    const dept = req.user.department;
    if (!isAvailable(req.params.id, dept)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not available' } });
    }
    res.json(await getReport(req.params.id, dept));
  } catch (err) { next(err); }
}

async function exportReport(req, res, next) {
  try {
    const dept = req.user.department;
    const { id } = req.params;
    if (!isAvailable(id, dept)) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Report not available' } });
    }
    const data = await getReport(id, dept);
    const wb = tableToWorkbook(data);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${id}-${dept}-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
}

module.exports = { listReports, getReportData, exportReport };
