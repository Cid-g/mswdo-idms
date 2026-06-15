const { createCanvas, loadImage } = require('@napi-rs/canvas');
const QRCode = require('qrcode');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_ROOT = path.resolve(__dirname, '../../uploads');

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function computeAge(birthdate) {
  if (!birthdate) return '';
  const born = new Date(birthdate);
  const now  = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
  return age;
}

// Build the data fields that will be drawn onto the ID card.
// Each entry maps a placeholder key → { type, value/path/token/children }.
function buildFields(applicant, idData) {
  const { idNumber, qrToken, issuedDate, expiryDate } = idData;

  // Name format: "DELA CRUZ, Juan M. Jr."
  const givenParts = [applicant.firstName];
  if (applicant.middleName) givenParts.push(applicant.middleName[0] + '.');
  if (applicant.extensionName) givenParts.push(applicant.extensionName);
  const fullName = `${(applicant.lastName || '').toUpperCase()}, ${givenParts.join(' ')}`;

  // Address: "Purok 3, Brgy. Poblacion 1, Gerona, Tarlac"
  const addrParts = [];
  if (applicant.purokStreet) addrParts.push(applicant.purokStreet);
  if (applicant.barangay)    addrParts.push(`Brgy. ${applicant.barangay}`);
  addrParts.push('Gerona, Tarlac');
  const address = addrParts.join(', ');

  const fields = {
    photo:      { type: 'image', path: applicant.photoPath },
    signature:  { type: 'image', path: applicant.signaturePath },
    qrCode:     { type: 'qr',   token: `${process.env.VERIFICATION_BASE_URL || 'http://localhost:5173/verify'}?token=${qrToken}` },
    fullName:   { type: 'text', value: fullName },
    idNumber:   { type: 'text', value: idNumber || '' },
    birthDate:  { type: 'text', value: fmtDate(applicant.birthdate) },
    address:    { type: 'text', value: address },
    issuedDate: { type: 'text', value: fmtDate(issuedDate) },
    expiryDate: { type: 'text', value: expiryDate ? fmtDate(expiryDate) : 'LIFETIME' },
  };

  if (applicant.department === 'PWD') {
    fields.idType = { type: 'text', value: applicant.pwd?.disabilityType || '' };
  }

  // Emergency contact — used on PWD back side (and available for any dept)
  fields.emergencyContactName    = { type: 'text', value: applicant.emergencyContactName    || '' };
  fields.emergencyContactNumber  = { type: 'text', value: applicant.emergencyContactNumber  || '' };
  fields.emergencyContactAddress = { type: 'text', value: applicant.emergencyContactAddress || '' };

  if (applicant.department === 'SOLO_PARENT') {
    fields.idType        = { type: 'text', value: (applicant.soloParent?.categoryCode || '').toUpperCase() };
    fields.benefitCode   = { type: 'text', value: applicant.soloParent?.benefitCode   || '' };
    fields.birthplace    = { type: 'text', value: applicant.birthplace || '' };
    fields.childrenTable = {
      type: 'table',
      children: (applicant.soloParent?.children || []).slice(0, 6),
    };
    // composite field — separator comes from placeholderConfig at render time
    fields.birthDateAndPlace = {
      type:  'composite',
      parts: [fmtDate(applicant.birthdate), applicant.birthplace || ''],
    };
  }

  return fields;
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

async function drawImageField(ctx, filePath, cfg) {
  if (!filePath) return;
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.join(UPLOADS_ROOT, filePath);
  if (!fs.existsSync(abs)) return;
  try {
    const img = await loadImage(abs);
    ctx.drawImage(img, cfg.x, cfg.y, cfg.width, cfg.height);
  } catch (err) {
    console.warn(`[idGen] Image draw failed (${abs}):`, err.message);
  }
}

async function drawQRField(ctx, token, cfg) {
  if (!token) return;
  try {
    const size = (cfg.width || 80) * 2; // render 2× then scale down → sharper
    const qrBuf = await QRCode.toBuffer(token, {
      type: 'png', width: size, margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    const img = await loadImage(qrBuf);
    ctx.drawImage(img, cfg.x, cfg.y, cfg.width || 80, cfg.height || 80);
  } catch (err) {
    console.warn('[idGen] QR draw failed:', err.message);
  }
}

function getWrappedLines(ctx, text, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '', curY = 0;
  for (const word of words) {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line !== '') {
      lines.push({ text: line.trim(), y: curY });
      line = word + ' '; curY += lineHeight;
    } else { line = test; }
  }
  if (line.trim()) lines.push({ text: line.trim(), y: curY });
  return lines;
}

function drawTextField(ctx, value, cfg, canvasW) {
  if (!value) return;
  const text   = cfg.allCaps ? String(value).toUpperCase() : value;
  const size   = cfg.fontSize   || 10;
  const style  = cfg.fontStyle  === 'italic' ? 'italic ' : '';
  const weight = cfg.fontWeight === 'bold'   ? 'bold '   : '';
  const family = cfg.fontFamily || 'Arial';
  const align  = cfg.textAlign  || 'left';
  const maxW   = cfg.maxWidth   || Math.max(60, canvasW - cfg.x - 8);
  const lineH  = Math.round(size * (cfg.lineHeight ?? 1.35));

  ctx.font         = `${style}${weight}${size}px ${family}`;
  ctx.textBaseline = 'top';
  ctx.textAlign    = align;

  let anchorX = cfg.x;
  if (align === 'center') anchorX = cfg.x + maxW / 2;
  else if (align === 'right') anchorX = cfg.x + maxW;

  const lines = getWrappedLines(ctx, text, maxW, lineH);

  // Stroke pass first (renders behind fill)
  if ((cfg.strokeWidth ?? 0) > 0 && cfg.strokeColor) {
    ctx.strokeStyle = cfg.strokeColor;
    ctx.lineWidth   = (cfg.strokeWidth ?? 0) * 2;
    ctx.lineJoin    = 'round';
    for (const ln of lines) ctx.strokeText(ln.text, anchorX, cfg.y + ln.y);
  }

  // Fill pass
  ctx.fillStyle = cfg.color || '#000000';
  for (const ln of lines) ctx.fillText(ln.text, anchorX, cfg.y + ln.y);

  // Underline
  if (cfg.textDecoration === 'underline') {
    ctx.strokeStyle = cfg.color || '#000000';
    ctx.lineWidth   = Math.max(0.5, size * 0.06);
    for (const ln of lines) {
      const lw = ctx.measureText(ln.text).width;
      let ux = anchorX;
      if (align === 'center') ux = anchorX - lw / 2;
      else if (align === 'right') ux = anchorX - lw;
      const uy = cfg.y + ln.y + size + 1;
      ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(ux + lw, uy); ctx.stroke();
    }
  }

  ctx.textAlign = 'left';
}

function drawChildrenTable(ctx, children, cfg) {
  const { x, y } = cfg;
  const w    = cfg.width  || 300;
  const h    = cfg.height || 140;
  const rows = 6;
  const rowH = h / rows;

  // Columns: Name | Birthday | Age | Relationship
  const c1 = w * 0.35;  // Name
  const c2 = w * 0.28;  // Birthday
  const c3 = w * 0.10;  // Age

  // Grid lines are part of the template image — not drawn here
  const fz     = cfg.fontSize   || 8;
  const family = cfg.fontFamily || 'Arial';
  const weight = cfg.fontWeight === 'bold'   ? 'bold '   : '';
  const style  = cfg.fontStyle  === 'italic' ? 'italic ' : '';
  ctx.font         = `${style}${weight}${fz}px ${family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';

  children.forEach((child, i) => {
    if (i >= 6) return;
    const ry      = y + i * rowH + rowH / 2;
    const rawName = `${child.lastName || ''}, ${child.firstName || ''}`.replace(/^,\s*/, '').trim();
    const name    = cfg.allCaps ? rawName.toUpperCase() : rawName;
    const age     = child.birthdate ? String(computeAge(child.birthdate)) : '';
    let bday      = '';
    if (child.birthdate) {
      const d = new Date(child.birthdate);
      bday = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }
    const rel = cfg.allCaps ? (child.relationship || '').toUpperCase() : (child.relationship || '');

    const cells = [
      { text: name.substring(0, 18), xPos: x + 3        },
      { text: bday,                  xPos: x + c1 + 3   },
      { text: age,                   xPos: x + c1+c2 + 3 },
      { text: rel,                   xPos: x + c1+c2+c3 + 3 },
    ];

    // Stroke pass
    if ((cfg.strokeWidth ?? 0) > 0 && cfg.strokeColor) {
      ctx.strokeStyle = cfg.strokeColor;
      ctx.lineWidth   = (cfg.strokeWidth ?? 0) * 2;
      ctx.lineJoin    = 'round';
      for (const { text, xPos } of cells) ctx.strokeText(text, xPos, ry);
    }

    // Fill pass
    ctx.fillStyle = cfg.color || '#111111';
    for (const { text, xPos } of cells) ctx.fillText(text, xPos, ry);
  });
}

// ── Main export ───────────────────────────────────────────────────────────────

async function generateIDImage(applicant, idData, template) {
  if (!template.templateImagePath || !fs.existsSync(template.templateImagePath)) {
    throw new Error('Template image file not found on disk.');
  }

  const templateImg = await loadImage(template.templateImagePath);
  const W = templateImg.width;
  const H = templateImg.height;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.drawImage(templateImg, 0, 0, W, H);

  const fields = buildFields(applicant, idData);

  for (const [key, cfg] of Object.entries(template.placeholderConfig || {})) {
    const field = fields[key];
    if (!field) continue;

    if      (field.type === 'image')     await drawImageField(ctx, field.path, cfg);
    else if (field.type === 'qr')        await drawQRField(ctx, field.token, cfg);
    else if (field.type === 'text')      drawTextField(ctx, field.value, cfg, W);
    else if (field.type === 'table')     drawChildrenTable(ctx, field.children, cfg);
    else if (field.type === 'composite') {
      const sep   = cfg.separator ?? ' / ';
      const value = field.parts.filter(Boolean).join(sep);
      drawTextField(ctx, value, cfg, W);
    }
  }

  const buffer   = canvas.toBuffer('image/png');
  const filename = `id-${uuidv4()}.png`;
  return { buffer, filename };
}

module.exports = { generateIDImage };
