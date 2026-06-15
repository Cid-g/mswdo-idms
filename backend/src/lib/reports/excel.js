'use strict';

const ExcelJS = require('exceljs');

const THIN = { style: 'thin' };
const BORDER = { top: THIN, bottom: THIN, left: THIN, right: THIN };

function formatAsOf(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function flattenColumns(structure) {
  return structure.columns || structure.columnGroups.flatMap((g) => g.columns);
}

const alignOf = (c) => ({ horizontal: c && c.align === 'right' ? 'right' : 'left' });

function styleHeaderCell(cell, align) {
  cell.font = { bold: true };
  cell.alignment = { horizontal: align, vertical: 'middle' };
  cell.border = BORDER;
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F1F1' } };
}

function tableToWorkbook(structure) {
  const { title, asOf, rows, totals, columnGroups } = structure;
  const columns = flattenColumns(structure);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Report');

  // Numeric merge (top,left,bottom,right) so wide cross-tab reports (>26 columns) work.
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, columns.length);
  const asOfCell = ws.getCell(2, 1);
  asOfCell.value = `As of ${formatAsOf(asOf)}`;
  asOfCell.font = { italic: true, size: 10 };
  asOfCell.alignment = { horizontal: 'center' };

  let dataStartRow;
  if (columnGroups) {
    let col = 1;
    columnGroups.forEach((g) => {
      const span = g.columns.length;
      if (g.label == null) {
        g.columns.forEach((c) => {
          ws.mergeCells(4, col, 5, col);
          const cell = ws.getCell(4, col);
          cell.value = c.label;
          styleHeaderCell(cell, alignOf(c).horizontal);
          col += 1;
        });
      } else {
        ws.mergeCells(4, col, 4, col + span - 1);
        const gcell = ws.getCell(4, col);
        gcell.value = g.label;
        styleHeaderCell(gcell, 'center');
        g.columns.forEach((c, j) => {
          const sub = ws.getCell(5, col + j);
          sub.value = c.label;
          styleHeaderCell(sub, alignOf(c).horizontal);
        });
        col += span;
      }
    });
    dataStartRow = 6;
  } else {
    const header = ws.getRow(4);
    columns.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.label;
      styleHeaderCell(cell, alignOf(c).horizontal);
    });
    dataStartRow = 5;
  }

  rows.forEach((r, ri) => {
    const row = ws.getRow(dataStartRow + ri);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.value = r[c.key];
      cell.alignment = alignOf(c);
      cell.border = BORDER;
    });
  });

  if (totals) {
    // 'TOTAL' label goes in the last leading column before the first totalled (numeric) column.
    let labelIdx = 0;
    for (let i = 0; i < columns.length; i += 1) {
      if (columns[i].key in totals) break;
      labelIdx = i;
    }
    const trow = ws.getRow(dataStartRow + rows.length);
    columns.forEach((c, i) => {
      const cell = trow.getCell(i + 1);
      if (c.key in totals) cell.value = totals[c.key];
      else if (i === labelIdx) cell.value = 'TOTAL';
      cell.font = { bold: true };
      cell.alignment = alignOf(c);
      cell.border = BORDER;
    });
  }

  const WIDTHS = { no: 5, barangay: 24, category: 34 };
  columns.forEach((c, i) => {
    // explicit per-column width wins; then known keys; then numeric=8 / text=16.
    ws.getColumn(i + 1).width = c.width || WIDTHS[c.key] || (c.align === 'right' ? 8 : 16);
  });

  return wb;
}

module.exports = { tableToWorkbook, flattenColumns };
