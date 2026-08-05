import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Save, Eye, Type, Image as ImageIcon,
  CheckCircle2, AlertCircle, Loader2, ToggleLeft, ToggleRight, Table2,
} from 'lucide-react';
import { getVersion, saveConfig } from '../../services/templateService';

const IMAGE_TYPE   = 'image';
const TEXT_TYPE    = 'text';
const SPECIAL_TYPE = 'special';
const TOPBAR_H     = 56;  // px — must match the h-14 top bar
const HANDLE_SIZE  = 8;   // px — resize handle square size
const MIN_DIM      = 10;  // minimum box width/height in image pixels

// 8-point resize handles: rx/ry are 0–1 fractions of the box width/height
const RESIZE_HANDLES = [
  { id: 'nw', rx: 0,   ry: 0,   cursor: 'nw-resize' },
  { id: 'n',  rx: 0.5, ry: 0,   cursor: 'n-resize'  },
  { id: 'ne', rx: 1,   ry: 0,   cursor: 'ne-resize' },
  { id: 'e',  rx: 1,   ry: 0.5, cursor: 'e-resize'  },
  { id: 'se', rx: 1,   ry: 1,   cursor: 'se-resize' },
  { id: 's',  rx: 0.5, ry: 1,   cursor: 's-resize'  },
  { id: 'sw', rx: 0,   ry: 1,   cursor: 'sw-resize' },
  { id: 'w',  rx: 0,   ry: 0.5, cursor: 'w-resize'  },
];

const FONT_FAMILIES = [
  { value: 'Arial',             label: 'Arial'             },
  { value: 'Arial Narrow',      label: 'Arial Narrow'      },
  { value: 'Verdana',           label: 'Verdana'           },
  { value: 'Tahoma',            label: 'Tahoma'            },
  { value: 'Trebuchet MS',      label: 'Trebuchet MS'      },
  { value: 'Calibri',           label: 'Calibri'           },
  { value: 'Segoe UI',          label: 'Segoe UI'          },
  { value: 'Times New Roman',   label: 'Times New Roman'   },
  { value: 'Georgia',           label: 'Georgia'           },
  { value: 'Palatino Linotype', label: 'Palatino Linotype' },
  { value: 'Garamond',          label: 'Garamond'          },
  { value: 'Courier New',       label: 'Courier New'       },
  { value: 'Impact',            label: 'Impact'            },
  { value: 'Century Gothic',    label: 'Century Gothic'    },
];

// ── Sample data shown in preview mode ─────────────────────────────────────────
const SAMPLE_DATA = {
  PWD: {
    front: {
      fullName:   'DELA CRUZ, Juan M. Jr.',
      idNumber:   '07-2026-001234',
      birthDate:  'January 15, 1985',
      address:    'Purok 3, Brgy. Poblacion 1, Gerona, Tarlac',
      idType:     'Orthopedic',
      issuedDate: 'May 22, 2026',
      expiryDate: 'May 22, 2031',
    },
    back: {
      emergencyContactName:    'Maria Dela Cruz',
      emergencyContactNumber:  '09171234567',
      emergencyContactAddress: 'Purok 2, Brgy. San Juan, Gerona, Tarlac',
    },
  },
  SOLO_PARENT: {
    front: {
      fullName:   'SANTOS, Ana B.',
      idNumber:   'SPIC-GRNA-2026-001234',
      birthDate:         'March 10, 1992',
      birthplace:        'San Jose City, Nueva Ecija',
      birthDateAndPlace: 'March 10, 1992 / San Jose City, Nueva Ecija',
      address:    'Purok 5, Brgy. Poblacion 2, Gerona, Tarlac',
      idType:      'A2',
      benefitCode: 'SP-WELFARE-01',
      issuedDate:  'May 22, 2026',
      expiryDate:  'May 22, 2028',
    },
    back: {
      childrenTable:            '__table__',
      fullName:                 'SANTOS, Ana B.',
      idNumber:                 'SPIC-GRNA-2026-001234',
      emergencyContactName:     'Pedro Santos',
      emergencyContactNumber:   '09171234567',
      emergencyContactAddress:  'Purok 3, Brgy. San Juan, Gerona, Tarlac',
    },
  },
  SENIOR_CITIZEN: {
    front: {
      fullName:   'REYES, Roberto C. Sr.',
      idNumber:   'OSCA-2026-001234',
      birthDate:  'December 3, 1955',
      address:    'Purok 1, Brgy. Bantog, Gerona, Tarlac',
      issuedDate: 'May 22, 2026',
    },
    back: {
      emergencyContactName:    'Rosa Reyes',
      emergencyContactNumber:  '09981234567',
      emergencyContactAddress: 'Purok 1, Brgy. Bantog, Gerona, Tarlac',
    },
  },
};

const SAMPLE_CHILDREN = [
  { lastName: 'Santos', firstName: 'Maria Joy',   birthdate: '2014-03-15', relationship: 'Daughter' },
  { lastName: 'Santos', firstName: 'Mark Angelo', birthdate: '2016-07-22', relationship: 'Son'      },
];

// ── Canvas preview renderer ───────────────────────────────────────────────────

function _getWrappedLines(ctx, text, maxWidth, lineHeight) {
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

function _drawPreviewText(ctx, text, cfg, canvasW) {
  const value  = cfg.allCaps ? String(text).toUpperCase() : text;
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

  const lines = _getWrappedLines(ctx, value, maxW, lineH);

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

function _drawPreviewImageBox(ctx, def, cfg) {
  const { x, y, width = 80, height = 80 } = cfg;
  ctx.fillStyle   = `${def.color}25`;
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = def.color;
  ctx.lineWidth   = 1.5;
  ctx.strokeRect(x, y, width, height);
  ctx.strokeStyle = `${def.color}55`;
  ctx.lineWidth   = 0.8;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y + height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + width, y); ctx.lineTo(x, y + height); ctx.stroke();
  const fz = Math.max(7, Math.min(11, Math.floor(Math.min(width, height) / 6)));
  ctx.fillStyle    = def.color;
  ctx.font         = `bold ${fz}px Arial`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'center';
  ctx.fillText(def.label, x + width / 2, y + height / 2);
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
}

function _drawPreviewChildrenTable(ctx, cfg) {
  const { x, y } = cfg;
  const w    = cfg.width  || 300;
  const h    = cfg.height || 140;
  const rows = 6;
  const rowH = h / rows;

  // Columns: Name | Birthday | Age | Relationship
  const c1 = w * 0.35;
  const c2 = w * 0.28;
  const c3 = w * 0.10;

  // Grid lines are part of the template image — don't draw them here
  const fz     = cfg.fontSize   || 8;
  const family = cfg.fontFamily || 'Arial';
  const weight = cfg.fontWeight === 'bold'   ? 'bold '   : '';
  const style  = cfg.fontStyle  === 'italic' ? 'italic ' : '';
  ctx.font         = `${style}${weight}${fz}px ${family}`;
  ctx.fillStyle    = cfg.color || '#111';
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';

  SAMPLE_CHILDREN.forEach((child, i) => {
    if (i >= 6) return;
    const ry      = y + i * rowH + rowH / 2;
    const rawName = `${child.lastName}, ${child.firstName}`;
    const name    = cfg.allCaps ? rawName.toUpperCase() : rawName;
    const born = new Date(child.birthdate);
    const now  = new Date();
    let age    = now.getFullYear() - born.getFullYear();
    if (now.getMonth() - born.getMonth() < 0 ||
        (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age--;
    const bday = `${born.getMonth() + 1}/${born.getDate()}/${born.getFullYear()}`;
    const rel  = child.relationship || '';

    ctx.fillText(name.substring(0, 18), x + 3, ry);
    ctx.fillText(bday,                  x + c1 + 3, ry);
    ctx.fillText(String(age),           x + c1 + c2 + 3, ry);
    ctx.fillText(rel,                   x + c1 + c2 + c3 + 3, ry);
  });
}

async function buildSamplePreview(canvas, templateImageUrl, config, defs, sampleData) {
  return new Promise((resolve, reject) => {
    const img       = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload      = () => {
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx     = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      for (const [key, cfg] of Object.entries(config)) {
        const def   = defs.find((d) => d.key === key);
        if (!def) continue;
        if (def.type === IMAGE_TYPE) {
          _drawPreviewImageBox(ctx, def, cfg);
        } else if (def.type === TEXT_TYPE) {
          const value = sampleData[key];
          if (value) _drawPreviewText(ctx, value, cfg, img.naturalWidth);
        } else if (def.type === SPECIAL_TYPE) {
          _drawPreviewChildrenTable(ctx, cfg);
        }
      }
      resolve();
    };
    img.onerror = reject;
    img.src     = templateImageUrl;
  });
}

// ── Placeholder definitions per department × side ─────────────────────────────
const PLACEHOLDERS = {
  PWD: {
    front: [
      { key: 'photo',      label: 'Applicant Photo',  type: IMAGE_TYPE,  color: '#3B82F6', defSize: { width: 120, height: 150 } },
      { key: 'signature',  label: 'Signature',        type: IMAGE_TYPE,  color: '#8B5CF6', defSize: { width: 150, height: 50  } },
      { key: 'qrCode',     label: 'QR Code',          type: IMAGE_TYPE,  color: '#10B981', defSize: { width: 80,  height: 80  } },
      { key: 'fullName',   label: 'Full Name',        type: TEXT_TYPE,   color: '#EF4444', defFont: { fontSize: 14, fontWeight: 'bold', color: '#000000' } },
      { key: 'idNumber',   label: 'PWD ID Number',    type: TEXT_TYPE,   color: '#F59E0B', defFont: { fontSize: 11, color: '#333333' } },
      { key: 'birthDate',  label: 'Birth Date',       type: TEXT_TYPE,   color: '#EC4899', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'address',    label: 'Address',          type: TEXT_TYPE,   color: '#06B6D4', defFont: { fontSize: 9,  color: '#333333' } },
      { key: 'idType',     label: 'Disability Type',  type: TEXT_TYPE,   color: '#6366F1', defFont: { fontSize: 10, color: '#0000aa' } },
      { key: 'issuedDate', label: 'Date Issued',      type: TEXT_TYPE,   color: '#84CC16', defFont: { fontSize: 9,  color: '#666666' } },
      { key: 'expiryDate', label: 'Expiry Date',      type: TEXT_TYPE,   color: '#F97316', defFont: { fontSize: 9,  color: '#666666' } },
    ],
    back: [
      { key: 'qrCode',                  label: 'QR Code',                  type: IMAGE_TYPE, color: '#10B981', defSize: { width: 80, height: 80 } },
      { key: 'emergencyContactName',    label: 'Emergency Contact Name',    type: TEXT_TYPE,  color: '#EF4444', defFont: { fontSize: 10, fontWeight: 'bold', color: '#000000' } },
      { key: 'emergencyContactNumber',  label: 'Emergency Contact Number',  type: TEXT_TYPE,  color: '#3B82F6', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'emergencyContactAddress', label: 'Emergency Contact Address', type: TEXT_TYPE,  color: '#10B981', defFont: { fontSize: 9,  color: '#333333' } },
    ],
  },
  SOLO_PARENT: {
    front: [
      { key: 'photo',         label: 'Applicant Photo', type: IMAGE_TYPE,   color: '#3B82F6', defSize: { width: 120, height: 150 } },
      { key: 'signature',     label: 'Signature',       type: IMAGE_TYPE,   color: '#8B5CF6', defSize: { width: 150, height: 50  } },
      { key: 'qrCode',        label: 'QR Code',         type: IMAGE_TYPE,   color: '#10B981', defSize: { width: 80,  height: 80  } },
      { key: 'fullName',      label: 'Full Name',       type: TEXT_TYPE,    color: '#EF4444', defFont: { fontSize: 14, fontWeight: 'bold', color: '#000000' } },
      { key: 'idNumber',      label: 'SPIC Number',     type: TEXT_TYPE,    color: '#F59E0B', defFont: { fontSize: 11, color: '#333333' } },
      { key: 'birthDate',        label: 'Birth Date',                   type: TEXT_TYPE, color: '#EC4899', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'birthplace',       label: 'Birthplace',                   type: TEXT_TYPE, color: '#0EA5E9', defFont: { fontSize: 9,  color: '#333333' } },
      { key: 'birthDateAndPlace', label: 'Birth Date + Birthplace',     type: TEXT_TYPE, color: '#BE185D', composite: true, compositeKeys: ['birthDate', 'birthplace'], defFont: { fontSize: 10, color: '#333333' } },
      { key: 'address',       label: 'Address',         type: TEXT_TYPE,    color: '#06B6D4', defFont: { fontSize: 9,  color: '#333333' } },
      { key: 'idType',        label: 'Category Code',            type: TEXT_TYPE,    color: '#6366F1', defFont: { fontSize: 10, color: '#0000aa' } },
      { key: 'benefitCode',   label: 'Benefit Qualification Code', type: TEXT_TYPE, color: '#7C3AED', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'issuedDate',    label: 'Date Issued',              type: TEXT_TYPE,    color: '#84CC16', defFont: { fontSize: 9,  color: '#666666' } },
      { key: 'expiryDate',    label: 'Expiry Date',              type: TEXT_TYPE,    color: '#F97316', defFont: { fontSize: 9,  color: '#666666' } },
    ],
    back: [
      { key: 'childrenTable',           label: 'Children Table (Name/Birthday/Age/Relationship)', type: SPECIAL_TYPE, color: '#D946EF', defSize: { width: 300, height: 140 } },
      { key: 'qrCode',                  label: 'QR Code',                  type: IMAGE_TYPE,  color: '#10B981', defSize: { width: 80,  height: 80  } },
      { key: 'emergencyContactName',    label: 'Emergency Contact Name',    type: TEXT_TYPE,   color: '#EF4444', defFont: { fontSize: 10, fontWeight: 'bold', color: '#000000' } },
      { key: 'emergencyContactNumber',  label: 'Emergency Contact Number',  type: TEXT_TYPE,   color: '#3B82F6', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'emergencyContactAddress', label: 'Emergency Contact Address', type: TEXT_TYPE,   color: '#EC4899', defFont: { fontSize: 9,  color: '#333333' } },
      { key: 'fullName',                label: 'Full Name',                 type: TEXT_TYPE,   color: '#F59E0B', defFont: { fontSize: 10, fontWeight: 'bold', color: '#000000' } },
      { key: 'idNumber',                label: 'SPIC Number',               type: TEXT_TYPE,   color: '#6366F1', defFont: { fontSize: 10, color: '#333333' } },
    ],
  },
  SENIOR_CITIZEN: {
    front: [
      { key: 'photo',      label: 'Applicant Photo', type: IMAGE_TYPE, color: '#3B82F6', defSize: { width: 120, height: 150 } },
      { key: 'signature',  label: 'Signature',       type: IMAGE_TYPE, color: '#8B5CF6', defSize: { width: 150, height: 50  } },
      { key: 'qrCode',     label: 'QR Code',         type: IMAGE_TYPE, color: '#10B981', defSize: { width: 80,  height: 80  } },
      { key: 'fullName',   label: 'Full Name',       type: TEXT_TYPE,  color: '#EF4444', defFont: { fontSize: 14, fontWeight: 'bold', color: '#000000' } },
      { key: 'idNumber',   label: 'OSCA Number',     type: TEXT_TYPE,  color: '#F59E0B', defFont: { fontSize: 11, color: '#333333' } },
      { key: 'birthDate',  label: 'Birth Date',      type: TEXT_TYPE,  color: '#EC4899', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'address',    label: 'Address',         type: TEXT_TYPE,  color: '#06B6D4', defFont: { fontSize: 9,  color: '#333333' } },
      { key: 'issuedDate', label: 'Date Issued',     type: TEXT_TYPE,  color: '#84CC16', defFont: { fontSize: 9,  color: '#666666' } },
    ],
    back: [
      { key: 'qrCode',                  label: 'QR Code',                  type: IMAGE_TYPE, color: '#10B981', defSize: { width: 80, height: 80 } },
      { key: 'emergencyContactName',    label: 'Emergency Contact Name',    type: TEXT_TYPE,  color: '#EF4444', defFont: { fontSize: 10, fontWeight: 'bold', color: '#000000' } },
      { key: 'emergencyContactNumber',  label: 'Emergency Contact Number',  type: TEXT_TYPE,  color: '#3B82F6', defFont: { fontSize: 10, color: '#333333' } },
      { key: 'emergencyContactAddress', label: 'Emergency Contact Address', type: TEXT_TYPE,  color: '#10B981', defFont: { fontSize: 9,  color: '#333333' } },
    ],
  },
};

// Text placeholders display at a fixed visual size on the canvas (actual size depends on fontSize)
const TEXT_DISPLAY_W = 130;
const TEXT_DISPLAY_H = 22;

function defaultConfig(def) {
  if (def.type === TEXT_TYPE) {
    return {
      x: 20, y: 20,
      fontFamily:     'Arial',
      fontStyle:      'normal',
      textAlign:      'left',
      allCaps:        false,
      maxWidth:       null,
      lineHeight:     1.35,
      textDecoration: 'none',
      strokeColor:    '',
      strokeWidth:    0,
      ...(def.composite ? { separator: ' / ' } : {}),
      ...def.defFont,
    };
  }
  if (def.key === 'childrenTable') {
    return {
      x: 20, y: 20, ...def.defSize,
      fontFamily: 'Arial', fontSize: 8, color: '#111111',
      fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none',
      allCaps: false, textAlign: 'left', strokeColor: '', strokeWidth: 0,
    };
  }
  return { x: 20, y: 20, ...def.defSize };
}

function displayBox(def, cfg, scale) {
  if (!cfg) return null;
  if (def.type === TEXT_TYPE) {
    return { left: cfg.x * scale, top: cfg.y * scale, width: TEXT_DISPLAY_W, height: TEXT_DISPLAY_H };
  }
  return {
    left:   cfg.x      * scale,
    top:    cfg.y      * scale,
    width:  cfg.width  * scale,
    height: cfg.height * scale,
  };
}

// ── Main editor ───────────────────────────────────────────────────────────────
export default function TemplatePlacerEditor() {
  const { id }     = useParams();
  const [searchParams] = useSearchParams();
  const side       = searchParams.get('side') === 'back' ? 'back' : 'front';
  const navigate   = useNavigate();

  const [template,   setTemplate]   = useState(null);
  const [config,     setConfig]     = useState({});
  const [enabled,    setEnabled]    = useState(new Set());
  const [selected,   setSelected]   = useState(null);
  const [scale,      setScale]      = useState(1);
  const [imgNatural, setImgNatural] = useState({ w: 1, h: 1 });
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState(null);
  const [previewMode,  setPreviewMode]  = useState(false);

  const containerRef    = useRef(null);
  const dragging        = useRef(null);
  const previewCanvasRef = useRef(null);

  const templateDept = template?.department ?? 'PWD';
  const templateSide = side;
  const defs         = PLACEHOLDERS[templateDept]?.[templateSide] ?? [];
  const theme        = {
    PWD:            { accent: '#1E40AF' },
    SOLO_PARENT:    { accent: '#9F1239' },
    SENIOR_CITIZEN: { accent: '#92400E' },
  }[templateDept] ?? { accent: '#475569' };

  // ── Load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const data = await getVersion(id);
        const sideData = data[side] || {};
        setTemplate({
          _id:              data._id,
          department:       data.department,
          side,
          name:             `Version ${data.versionNumber}`,
          versionNumber:    data.versionNumber,
          isActive:         data.isActive,
          templateImageUrl: sideData.imageUrl,
        });
        if (sideData.placeholderConfig && Object.keys(sideData.placeholderConfig).length > 0) {
          setConfig(sideData.placeholderConfig);
          setEnabled(new Set(Object.keys(sideData.placeholderConfig)));
        } else {
          setConfig({});
          setEnabled(new Set());
        }
      } catch {
        navigate('/admin/templates');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, side, navigate]);

  // ── Scale on container resize ─────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || imgNatural.w === 1) return;
    const obs = new ResizeObserver(() => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setScale(rect.width / imgNatural.w);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [imgNatural]);

  function handleImgLoad(e) {
    const { naturalWidth: w, naturalHeight: h } = e.target;
    setImgNatural({ w, h });
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setScale(rect.width / w);
  }

  // ── Toggle placeholder ────────────────────────────────────────────────────
  function togglePlaceholder(key) {
    const def = defs.find((d) => d.key === key);
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setConfig((c) => { const n = { ...c }; delete n[key]; return n; });
        if (selected === key) setSelected(null);
      } else {
        next.add(key);
        setConfig((c) => ({ ...c, [key]: defaultConfig(def) }));
        setSelected(key);
      }
      return next;
    });
  }

  // ── Move (mousedown on box) ───────────────────────────────────────────────
  function onMoveMouseDown(e, key) {
    e.preventDefault(); e.stopPropagation();
    setSelected(key);
    const box = e.currentTarget.getBoundingClientRect();
    dragging.current = {
      type: 'move', key,
      offsetX: e.clientX - box.left,
      offsetY: e.clientY - box.top,
    };
  }

  // ── Resize (mousedown on handle) ──────────────────────────────────────────
  function onResizeMouseDown(e, key, handleId) {
    e.preventDefault(); e.stopPropagation();
    dragging.current = {
      type: 'resize', key, handleId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startCfg: { ...config[key] },
    };
  }

  // ── Mouse move ────────────────────────────────────────────────────────────
  const onMouseMove = useCallback((e) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();

    if (dragging.current.type === 'move') {
      const { key, offsetX, offsetY } = dragging.current;
      const imgX = Math.max(0, Math.round((e.clientX - rect.left - offsetX) / scale));
      const imgY = Math.max(0, Math.round((e.clientY - rect.top  - offsetY) / scale));
      setConfig((c) => ({ ...c, [key]: { ...c[key], x: imgX, y: imgY } }));
    } else {
      const { key, handleId, startMouseX, startMouseY, startCfg } = dragging.current;
      const dx = Math.round((e.clientX - startMouseX) / scale);
      const dy = Math.round((e.clientY - startMouseY) / scale);
      let { x, y, width, height } = { ...startCfg };

      if (handleId.includes('e')) width  = Math.max(MIN_DIM, startCfg.width  + dx);
      if (handleId.includes('s')) height = Math.max(MIN_DIM, startCfg.height + dy);
      if (handleId.includes('w')) {
        const newW = Math.max(MIN_DIM, startCfg.width - dx);
        x = startCfg.x + (startCfg.width - newW);
        width = newW;
      }
      if (handleId.includes('n')) {
        const newH = Math.max(MIN_DIM, startCfg.height - dy);
        y = startCfg.y + (startCfg.height - newH);
        height = newH;
      }
      setConfig((c) => ({ ...c, [key]: { ...c[key], x, y, width, height } }));
    }
  }, [scale]);

  const onMouseUp = useCallback(() => { dragging.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  // ── Arrow-key nudge ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (!selected || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const step = e.shiftKey ? 10 : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft')  { dx = -step; e.preventDefault(); }
      if (e.key === 'ArrowRight') { dx =  step; e.preventDefault(); }
      if (e.key === 'ArrowUp')    { dy = -step; e.preventDefault(); }
      if (e.key === 'ArrowDown')  { dy =  step; e.preventDefault(); }
      if (dx !== 0 || dy !== 0) {
        setConfig((c) => ({
          ...c,
          [selected]: {
            ...c[selected],
            x: Math.max(0, (c[selected]?.x ?? 0) + dx),
            y: Math.max(0, (c[selected]?.y ?? 0) + dy),
          },
        }));
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected]);

  // ── Sample preview rendering ──────────────────────────────────────────────
  useEffect(() => {
    if (!previewMode || !previewCanvasRef.current || !template?.templateImageUrl) return;
    const sampleData = SAMPLE_DATA[templateDept]?.[templateSide] ?? {};
    buildSamplePreview(previewCanvasRef.current, template.templateImageUrl, config, defs, sampleData)
      .catch((err) => console.warn('[preview]', err.message));
  }, [previewMode, config, template, templateDept, templateSide, defs]);

  function updateProp(key, field, value) {
    setConfig((c) => ({ ...c, [key]: { ...c[key], [field]: value } }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveConfig(id, side, config);
      showToast('success', 'Configuration saved successfully.');
    } catch (err) {
      const msg = err.response?.data?.error?.message || 'Failed to save. Please try again.';
      showToast('error', msg);
    } finally {
      setSaving(false);
    }
  }

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  const selDef    = selected ? defs.find((d) => d.key === selected) : null;
  const selConfig = selected ? config[selected] : null;
  const sideLabel = templateSide === 'front' ? 'Front' : 'Back';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: theme.accent }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-up">

      {/* ── Sticky top bar ─────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-6 bg-white border-b"
        style={{ height: `${TOPBAR_H}px`, borderColor: 'var(--color-border)', boxShadow: 'var(--shadow-sm)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/admin/templates')}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium border flex-shrink-0 transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)', background: 'white' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
          <div className="w-px h-5 bg-gray-200 flex-shrink-0" />
          <span className="font-serif text-xl flex-shrink-0" style={{ color: 'var(--color-text-1)' }}>
            Placeholder Editor
          </span>
          {template && (
            <span className="text-sm truncate" style={{ color: 'var(--color-muted)' }}>
              — {template.name} · {sideLabel} Side
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {template && (
            previewMode ? (
              <button
                onClick={() => setPreviewMode(false)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium border transition-colors"
                style={{ borderColor: theme.accent, color: theme.accent, background: `${theme.accent}10` }}
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back to Edit
              </button>
            ) : (
              <button
                onClick={() => setPreviewMode(true)}
                disabled={Object.keys(config).length === 0}
                className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-sm font-medium border transition-colors"
                style={{
                  borderColor: Object.keys(config).length === 0 ? 'var(--color-border)' : theme.accent,
                  color:       Object.keys(config).length === 0 ? 'var(--color-muted)'  : theme.accent,
                  background: 'white',
                  cursor:      Object.keys(config).length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <Eye className="w-3.5 h-3.5" /> Preview Sample
              </button>
            )
          )}
          <button
            onClick={handleSave}
            disabled={saving || enabled.size === 0}
            className="flex items-center gap-1.5 h-8 px-4 rounded-lg text-sm font-semibold text-white transition-all"
            style={{
              background: saving || enabled.size === 0 ? 'var(--color-muted)' : theme.accent,
              cursor: saving || enabled.size === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Toast ──────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg"
          style={
            toast.type === 'success'
              ? { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #BBF7D0' }
              : { background: 'var(--color-danger-bg)',  color: 'var(--color-danger)',  border: '1px solid #FECACA' }
          }
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* ── Main layout — page scrolls, right panel is sticky ──────────────── */}
      <div className="flex" style={{ alignItems: 'flex-start' }}>

        {/* Canvas column */}
        <div className="flex-1 min-w-0 p-6 space-y-3">

          {/* Instructions / preview label */}
          <div className="flex items-center justify-between gap-4">
            {previewMode ? (
              <p className="text-xs font-medium" style={{ color: theme.accent }}>
                Preview with sample data — positions and fonts match the real generated ID.
              </p>
            ) : (
              <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
                Drag to move · Handles to resize image/QR boxes · ↑↓←→ nudge (Shift = 10px)
              </p>
            )}
            {!previewMode && selDef && selConfig && (
              <p className="text-xs font-mono flex-shrink-0 px-2 py-1 rounded"
                style={{ background: 'var(--color-surface)', color: selDef.color, border: `1px solid ${selDef.color}30` }}>
                x:{selConfig.x ?? 0} y:{selConfig.y ?? 0}
                {selDef.type === TEXT_TYPE
                  ? selConfig.maxWidth ? ` · wrap:${selConfig.maxWidth}px` : ''
                  : ` · ${selConfig.width ?? 0}×${selConfig.height ?? 0}px`}
              </p>
            )}
          </div>

          {/* Sample-data preview canvas (always mounted so ref works; hidden in edit mode) */}
          <div
            className="relative rounded-xl overflow-hidden"
            style={{
              border:   `2px solid ${theme.accent}30`,
              display:  previewMode ? 'block' : 'none',
            }}
          >
            <canvas ref={previewCanvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
          </div>

          {/* Editor: image + overlays (shown in edit mode) */}
          {!previewMode && (
            <div
              ref={containerRef}
              className="relative select-none rounded-xl overflow-hidden"
              style={{ border: `2px solid ${theme.accent}30` }}
            >
              {template?.templateImageUrl ? (
                <img
                  src={template.templateImageUrl}
                  alt="Template"
                  className="block w-full"
                  draggable={false}
                  onLoad={handleImgLoad}
                />
              ) : (
                <div className="flex items-center justify-center h-64"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                  Template image not available
                </div>
              )}

              {/* Overlays */}
              {defs.map((def) => {
                if (!enabled.has(def.key)) return null;
                const cfg   = config[def.key];
                if (!cfg) return null;
                const isSel = selected === def.key;

                // ── WYSIWYG text overlay ────────────────────────────────────
                if (def.type === TEXT_TYPE) {
                  const sampleVal     = `[ ${def.label} ]`;
                  const displayVal    = cfg.allCaps ? sampleVal.toUpperCase() : sampleVal;
                  const effectiveMaxW = cfg.maxWidth || Math.max(60, imgNatural.w - cfg.x - 8);
                  return (
                    <div key={def.key}>
                      {/* Label badge above the text */}
                      <div
                        style={{
                          position:      'absolute',
                          left:          cfg.x * scale,
                          top:           Math.max(0, cfg.y * scale - 14),
                          padding:       '1px 5px',
                          background:    def.color,
                          color:         'white',
                          fontSize:      '9px',
                          fontWeight:    600,
                          borderRadius:  '3px',
                          whiteSpace:    'nowrap',
                          display:       'flex',
                          alignItems:    'center',
                          gap:           '3px',
                          zIndex:        isSel ? 25 : 12,
                          pointerEvents: 'none',
                          opacity:       isSel ? 1 : 0.55,
                        }}
                      >
                        <Type size={7} /> {def.label}
                      </div>

                      {/* Live styled text — draggable */}
                      <div
                        onMouseDown={(e) => onMoveMouseDown(e, def.key)}
                        title={`${def.label} · drag to reposition`}
                        style={{
                          position:          'absolute',
                          left:              cfg.x * scale,
                          top:               cfg.y * scale,
                          width:             effectiveMaxW * scale,
                          fontFamily:        cfg.fontFamily || 'Arial',
                          fontSize:          `${(cfg.fontSize || 10) * scale}px`,
                          fontWeight:        cfg.fontWeight || 'normal',
                          fontStyle:         cfg.fontStyle  || 'normal',
                          textDecoration:    cfg.textDecoration === 'underline' ? 'underline' : 'none',
                          color:             cfg.color || '#000000',
                          textAlign:         cfg.textAlign  || 'left',
                          textTransform:     cfg.allCaps ? 'uppercase' : 'none',
                          WebkitTextStroke:  (cfg.strokeWidth ?? 0) > 0 && cfg.strokeColor
                            ? `${cfg.strokeWidth * scale}px ${cfg.strokeColor}`
                            : undefined,
                          paintOrder:        'stroke fill',
                          lineHeight:        cfg.lineHeight ?? 1.35,
                          whiteSpace:        'pre-wrap',
                          wordBreak:         'break-word',
                          cursor:            'move',
                          userSelect:        'none',
                          zIndex:            isSel ? 20 : 10,
                          outline:           isSel
                            ? `2px solid ${def.color}`
                            : `1px dashed ${def.color}99`,
                          outlineOffset:     '2px',
                          background:        isSel ? `${def.color}08` : 'transparent',
                          boxSizing:         'border-box',
                        }}
                      >
                        {displayVal}
                      </div>

                      {/* Wrap-width edge line (selected only) */}
                      {isSel && (
                        <div
                          style={{
                            position:      'absolute',
                            left:          (cfg.x + effectiveMaxW) * scale,
                            top:           cfg.y * scale - 4,
                            width:         2,
                            height:        Math.max(20, (cfg.fontSize || 10) * scale * 3),
                            borderLeft:    `2px dashed ${def.color}80`,
                            zIndex:        15,
                            pointerEvents: 'none',
                          }}
                        />
                      )}
                    </div>
                  );
                }

                // ── Children Table: WYSIWYG grid preview ───────────────────
                if (def.key === 'childrenTable') {
                  const tableW = (cfg.width  || 300) * scale;
                  const tableH = (cfg.height || 140) * scale;
                  const rowH   = tableH / 6;
                  const c1     = tableW * 0.35;
                  const c2     = tableW * 0.28;
                  const c3     = tableW * 0.10;
                  const fz     = (cfg.fontSize || 8) * scale;
                  const boxR   = displayBox(def, cfg, scale);
                  const cellSt = (left, width) => ({
                    position: 'absolute', top: 0, bottom: 0, left, width,
                    display: 'flex', alignItems: 'center', paddingLeft: 3,
                    fontFamily:     cfg.fontFamily || 'Arial',
                    fontSize:       fz,
                    color:          cfg.color || '#111',
                    fontWeight:     cfg.fontWeight || 'normal',
                    fontStyle:      cfg.fontStyle  || 'normal',
                    textDecoration: cfg.textDecoration === 'underline' ? 'underline' : 'none',
                    textTransform:  cfg.allCaps ? 'uppercase' : 'none',
                    overflow: 'hidden', whiteSpace: 'nowrap',
                  });
                  return (
                    <div key={def.key}>
                      {/* Label badge */}
                      <div style={{
                        position: 'absolute',
                        left: cfg.x * scale,
                        top: Math.max(0, cfg.y * scale - 14),
                        padding: '1px 5px',
                        background: def.color, color: 'white',
                        fontSize: '9px', fontWeight: 600,
                        borderRadius: '3px', whiteSpace: 'nowrap',
                        display: 'flex', alignItems: 'center', gap: '3px',
                        zIndex: isSel ? 25 : 12,
                        pointerEvents: 'none', opacity: isSel ? 1 : 0.6,
                      }}>
                        <Table2 size={7} /> Children Table
                      </div>

                      {/* Draggable grid */}
                      <div
                        onMouseDown={(e) => onMoveMouseDown(e, def.key)}
                        style={{
                          position: 'absolute',
                          left: cfg.x * scale, top: cfg.y * scale,
                          width: tableW, height: tableH,
                          cursor: 'move', userSelect: 'none',
                          zIndex: isSel ? 20 : 10,
                          outline: isSel ? `2px solid ${def.color}` : `1px dashed ${def.color}99`,
                          outlineOffset: '2px',
                          boxSizing: 'border-box', overflow: 'hidden',
                          background: `${def.color}08`,
                        }}
                      >
                        {/* Grid lines are part of the template image — not rendered here */}
                        {/* Sample data rows */}
                        {SAMPLE_CHILDREN.map((child, i) => {
                          const born = new Date(child.birthdate);
                          const now  = new Date();
                          let age    = now.getFullYear() - born.getFullYear();
                          if (now.getMonth() - born.getMonth() < 0 ||
                             (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())) age--;
                          const bday = `${born.getMonth()+1}/${born.getDate()}/${born.getFullYear()}`;
                          const name = `${child.lastName}, ${child.firstName}`;
                          return (
                            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * rowH, height: rowH }}>
                              <div style={cellSt(0,           c1              )}>{name}</div>
                              <div style={cellSt(c1,          c2              )}>{bday}</div>
                              <div style={cellSt(c1+c2,       c3              )}>{age}</div>
                              <div style={cellSt(c1+c2+c3,    tableW-c1-c2-c3 )}>{child.relationship}</div>
                            </div>
                          );
                        })}
                        {/* Empty rows (faint placeholders) */}
                        {[2,3,4,5].map(i => (
                          <div key={i} style={{ position: 'absolute', left: 3, top: i * rowH, height: rowH, display: 'flex', alignItems: 'center', opacity: 0.25, fontFamily: 'Arial', fontSize: fz, color: '#555' }}>—</div>
                        ))}
                      </div>

                      {/* Resize handles */}
                      {isSel && boxR && RESIZE_HANDLES.map((h) => (
                        <div
                          key={h.id}
                          onMouseDown={(e) => onResizeMouseDown(e, def.key, h.id)}
                          style={{
                            position: 'absolute',
                            left: boxR.left + h.rx * boxR.width  - HANDLE_SIZE / 2,
                            top:  boxR.top  + h.ry * boxR.height - HANDLE_SIZE / 2,
                            width: HANDLE_SIZE, height: HANDLE_SIZE,
                            background: 'white', border: `2px solid ${def.color}`,
                            borderRadius: 2, cursor: h.cursor,
                            zIndex: 30, boxSizing: 'border-box',
                          }}
                        />
                      ))}
                    </div>
                  );
                }

                // ── Image / Special: box + resize handles ───────────────────
                const box       = displayBox(def, cfg, scale);
                if (!box) return null;
                const hasResize = isSel && (def.type === IMAGE_TYPE || def.type === SPECIAL_TYPE);

                return (
                  <div key={def.key}>
                    <div
                      onMouseDown={(e) => onMoveMouseDown(e, def.key)}
                      title={`${def.label} — x:${cfg.x} y:${cfg.y}`}
                      style={{
                        position:     'absolute',
                        left:         box.left,
                        top:          box.top,
                        width:        box.width,
                        height:       box.height,
                        border:       `2px solid ${def.color}`,
                        background:   `${def.color}${isSel ? '28' : '14'}`,
                        cursor:       'move',
                        boxSizing:    'border-box',
                        boxShadow:    isSel ? `0 0 0 2px white, 0 0 0 4px ${def.color}` : 'none',
                        zIndex:       isSel ? 20 : 10,
                        borderRadius: '3px',
                      }}
                    >
                      <div
                        style={{
                          position:      'absolute',
                          top: 0, left: 0,
                          padding:       '1px 5px',
                          background:    def.color,
                          color:         'white',
                          fontSize:      '9px',
                          fontWeight:    600,
                          lineHeight:    1.4,
                          borderRadius:  '0 0 4px 0',
                          whiteSpace:    'nowrap',
                          display:       'flex',
                          alignItems:    'center',
                          gap:           '3px',
                          pointerEvents: 'none',
                        }}
                      >
                        {def.type === IMAGE_TYPE   && <ImageIcon size={7} />}
                        {def.type === SPECIAL_TYPE && <Table2     size={7} />}
                        {def.label}
                      </div>
                    </div>

                    {hasResize && RESIZE_HANDLES.map((h) => (
                      <div
                        key={h.id}
                        onMouseDown={(e) => onResizeMouseDown(e, def.key, h.id)}
                        style={{
                          position:     'absolute',
                          left:         box.left + h.rx * box.width  - HANDLE_SIZE / 2,
                          top:          box.top  + h.ry * box.height - HANDLE_SIZE / 2,
                          width:        HANDLE_SIZE,
                          height:       HANDLE_SIZE,
                          background:   'white',
                          border:       `2px solid ${def.color}`,
                          borderRadius: 2,
                          cursor:       h.cursor,
                          zIndex:       30,
                          boxSizing:    'border-box',
                        }}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Right panel — sticky ────────────────────────────────────────── */}
        <div
          className="w-80 flex-shrink-0 border-l overflow-y-auto"
          style={{
            position:   'sticky',
            top:        `${TOPBAR_H}px`,
            maxHeight:  `calc(100vh - ${TOPBAR_H}px)`,
            alignSelf:  'flex-start',
            borderColor: 'var(--color-border)',
            background:  'var(--color-surface)',
          }}
        >
          {/* Placeholder list */}
          <div className="px-4 pt-4 pb-3">
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
              Placeholders
            </p>
            <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--color-muted)' }}>
              {sideLabel} · {templateDept.replace(/_/g, ' ')}
            </p>
            {defs.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No placeholders for this template type.</p>
            ) : (
              <div className="space-y-1">
                {defs.map((def) => {
                  const on = enabled.has(def.key);
                  return (
                    <button
                      key={def.key}
                      onClick={() => { togglePlaceholder(def.key); if (on) {} else setSelected(def.key); }}
                      className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg text-left transition-all"
                      style={{
                        background: on ? 'white' : 'transparent',
                        border:     on ? `1px solid ${def.color}50` : '1px solid transparent',
                        boxShadow:  selected === def.key ? `0 0 0 2px ${def.color}40` : on ? 'var(--shadow-sm)' : 'none',
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ background: on ? def.color : 'var(--color-border)' }} />
                        <span className="text-xs font-medium"
                          style={{ color: on ? 'var(--color-text-1)' : 'var(--color-muted)' }}>
                          {def.label}
                        </span>
                      </div>
                      {on
                        ? <ToggleRight className="w-4 h-4 flex-shrink-0" style={{ color: def.color }} />
                        : <ToggleLeft  className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-muted)' }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Property panel */}
          {selDef && selConfig && (
            <div className="border-t px-4 pt-4 pb-6" style={{ borderColor: 'var(--color-border)' }}>
              {/* Header */}
              <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg"
                style={{ background: `${selDef.color}15`, border: `1px solid ${selDef.color}30` }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: selDef.color }} />
                <p className="text-xs font-semibold" style={{ color: selDef.color }}>{selDef.label}</p>
                <span className="ml-auto text-xs px-1.5 py-0.5 rounded font-mono"
                  style={{ background: selDef.color, color: 'white', fontSize: '9px' }}>
                  {selDef.type}
                </span>
              </div>

              <div className="space-y-4">

                {/* ── Position ── */}
                <Section label="Position">
                  <div className="grid grid-cols-2 gap-2">
                    <PropInput label="X (px)" value={selConfig.x ?? 0} onChange={(v) => updateProp(selected, 'x', Number(v))} />
                    <PropInput label="Y (px)" value={selConfig.y ?? 0} onChange={(v) => updateProp(selected, 'y', Number(v))} />
                  </div>
                </Section>

                {/* ── Composite separator (combined fields only) ── */}
                {selDef.composite && (
                  <Section label="Combined Field">
                    <div className="px-3 py-2 rounded-lg text-xs leading-relaxed"
                      style={{ background: `${selDef.color}12`, border: `1px solid ${selDef.color}30`, color: 'var(--color-text-2)' }}>
                      Combines <strong>{selDef.compositeKeys.join(' + ')}</strong> into one text field.
                      Set the separator between them below.
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-2)' }}>
                        Separator
                      </label>
                      <input
                        type="text"
                        value={selConfig.separator ?? ' / '}
                        onChange={(e) => updateProp(selected, 'separator', e.target.value)}
                        placeholder=" / "
                        className="w-full h-8 px-2 rounded-lg border text-xs font-mono"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', background: 'white', outline: 'none' }}
                        onFocus={(e) => { e.target.style.borderColor = selDef.color; }}
                        onBlur={(e)  => { e.target.style.borderColor = 'var(--color-border)'; }}
                      />
                      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                        Preview: <span className="font-mono" style={{ color: selDef.color }}>
                          March 10, 1992{selConfig.separator ?? ' / '}San Jose City, Nueva Ecija
                        </span>
                      </p>
                    </div>
                  </Section>
                )}

                {/* ── Size (image / special) ── */}
                {(selDef.type === IMAGE_TYPE || selDef.type === SPECIAL_TYPE) && (
                  <Section label="Size">
                    <div className="grid grid-cols-2 gap-2">
                      <PropInput label="Width (px)"  value={selConfig.width  ?? 0} onChange={(v) => updateProp(selected, 'width',  Math.max(MIN_DIM, Number(v)))} />
                      <PropInput label="Height (px)" value={selConfig.height ?? 0} onChange={(v) => updateProp(selected, 'height', Math.max(MIN_DIM, Number(v)))} />
                    </div>
                    <p className="text-xs mt-1.5" style={{ color: 'var(--color-muted)' }}>
                      Drag the corner/edge handles on the canvas to resize visually.
                    </p>
                  </Section>
                )}

                {/* ── Typography (text + children table) ── */}
                {(selDef.type === TEXT_TYPE || selDef.key === 'childrenTable') && (
                  <Section label="Typography">
                    {/* Font size */}
                    <PropInput
                      label="Font size (pt)"
                      value={selConfig.fontSize ?? (selDef.key === 'childrenTable' ? 8 : 10)}
                      onChange={(v) => updateProp(selected, 'fontSize', Number(v))}
                    />

                    {/* Font family — visual picker */}
                    <FontFamilyPicker
                      value={selConfig.fontFamily ?? 'Arial'}
                      onChange={(v) => updateProp(selected, 'fontFamily', v)}
                      accentColor={selDef.color}
                    />

                    {/* Style toggles: B / I / U */}
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                        Style
                      </label>
                      <div className="flex gap-1.5">
                        <StyleToggle
                          active={selConfig.fontWeight === 'bold'}
                          onClick={() => updateProp(selected, 'fontWeight', selConfig.fontWeight === 'bold' ? 'normal' : 'bold')}
                          accentColor={selDef.color}
                          title="Bold"
                          textStyle={{ fontWeight: 'bold' }}
                        >B</StyleToggle>
                        <StyleToggle
                          active={selConfig.fontStyle === 'italic'}
                          onClick={() => updateProp(selected, 'fontStyle', selConfig.fontStyle === 'italic' ? 'normal' : 'italic')}
                          accentColor={selDef.color}
                          title="Italic"
                          textStyle={{ fontStyle: 'italic' }}
                        >I</StyleToggle>
                        <StyleToggle
                          active={selConfig.textDecoration === 'underline'}
                          onClick={() => updateProp(selected, 'textDecoration', selConfig.textDecoration === 'underline' ? 'none' : 'underline')}
                          accentColor={selDef.color}
                          title="Underline"
                          textStyle={{ textDecoration: 'underline' }}
                        >U</StyleToggle>
                        <StyleToggle
                          active={selConfig.allCaps ?? false}
                          onClick={() => updateProp(selected, 'allCaps', !(selConfig.allCaps ?? false))}
                          accentColor={selDef.color}
                          title="ALL CAPS"
                          textStyle={{ fontSize: '9px', letterSpacing: '0.05em' }}
                        >AA</StyleToggle>
                      </div>
                    </div>

                    {/* Text align */}
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
                        Alignment
                      </label>
                      <div className="flex gap-1">
                        {[
                          { v: 'left' },
                          { v: 'center' },
                          { v: 'right' },
                        ].map(({ v }) => {
                          const active = (selConfig.textAlign ?? 'left') === v;
                          const labels = { left: 'Left', center: 'Center', right: 'Right' };
                          return (
                            <button
                              key={v}
                              onClick={() => updateProp(selected, 'textAlign', v)}
                              className="flex-1 h-8 rounded-lg text-xs font-semibold border transition-all"
                              style={active
                                ? { background: selDef.color, color: 'white', borderColor: selDef.color }
                                : { background: 'white', color: 'var(--color-text-2)', borderColor: 'var(--color-border)' }
                              }
                            >
                              {labels[v]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </Section>
                )}

                {/* ── Text Stroke / Outline (text + children table) ── */}
                {(selDef.type === TEXT_TYPE || selDef.key === 'childrenTable') && (
                  <Section label="Text Stroke">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-2)' }}>
                          Stroke color
                        </label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="color"
                            value={/^#[0-9a-fA-F]{6}$/.test(selConfig.strokeColor ?? '') ? selConfig.strokeColor : '#ffffff'}
                            onChange={(e) => updateProp(selected, 'strokeColor', e.target.value)}
                            className="w-8 h-8 rounded border cursor-pointer p-0.5 flex-shrink-0"
                            style={{ borderColor: 'var(--color-border)' }}
                          />
                          <input
                            type="text"
                            value={selConfig.strokeColor ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) updateProp(selected, 'strokeColor', v.startsWith('#') || v === '' ? v : `#${v}`);
                            }}
                            placeholder="#ffffff"
                            className="flex-1 h-8 px-2 rounded-lg border text-xs font-mono"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', background: 'white', outline: 'none' }}
                            onFocus={(e) => { e.target.style.borderColor = selDef.color; }}
                            onBlur={(e)  => { e.target.style.borderColor = 'var(--color-border)'; }}
                          />
                        </div>
                      </div>
                      <div style={{ width: 72 }}>
                        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-2)' }}>
                          Width (px)
                        </label>
                        <input
                          type="number"
                          min={0} max={8} step={0.5}
                          value={selConfig.strokeWidth ?? 0}
                          onChange={(e) => updateProp(selected, 'strokeWidth', Number(e.target.value))}
                          className="w-full h-8 px-2 rounded-lg border text-xs"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', background: 'white', outline: 'none' }}
                          onFocus={(e) => { e.target.style.borderColor = selDef.color; }}
                          onBlur={(e)  => { e.target.style.borderColor = 'var(--color-border)'; }}
                        />
                      </div>
                    </div>
                    {(selConfig.strokeWidth ?? 0) > 0 && selConfig.strokeColor && (
                      <div className="mt-2 px-3 py-2 rounded-lg flex items-center justify-center"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                        <span style={{
                          fontFamily: selConfig.fontFamily || 'Arial',
                          fontWeight: selConfig.fontWeight || 'normal',
                          fontStyle: selConfig.fontStyle || 'normal',
                          fontSize: '16px',
                          color: selConfig.color || '#000000',
                          WebkitTextStroke: `${selConfig.strokeWidth}px ${selConfig.strokeColor}`,
                          paintOrder: 'stroke fill',
                        }}>
                          AaBb Cc 123
                        </span>
                      </div>
                    )}
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                      Adds a colored outline around letters — common on ID cards for white-bordered text.
                    </p>
                  </Section>
                )}

                {/* ── Text Area (text only) ── */}
                {selDef.type === TEXT_TYPE && (
                  <Section label="Text Area">
                    {/* Wrap width */}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-2)' }}>
                        Wrap width (px)
                      </label>
                      <input
                        type="number"
                        value={selConfig.maxWidth ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateProp(selected, 'maxWidth', v === '' || Number(v) <= 0 ? null : Number(v));
                        }}
                        placeholder="Auto (fills to canvas edge)"
                        min={20}
                        className="w-full h-8 px-2 rounded-lg border text-xs"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', background: 'white', outline: 'none' }}
                        onFocus={(e)  => { e.target.style.borderColor = selDef.color; }}
                        onBlur={(e)   => { e.target.style.borderColor = 'var(--color-border)'; }}
                      />
                      <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                        The dashed line on the canvas shows where text wraps.
                      </p>
                    </div>

                    {/* Line spacing */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium" style={{ color: 'var(--color-text-2)' }}>
                          Line spacing
                        </label>
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                          style={{ background: `${selDef.color}15`, color: selDef.color }}>
                          {(selConfig.lineHeight ?? 1.35).toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.8} max={3.0} step={0.05}
                        value={selConfig.lineHeight ?? 1.35}
                        onChange={(e) => updateProp(selected, 'lineHeight', Number(e.target.value))}
                        className="w-full"
                        style={{ accentColor: selDef.color }}
                      />
                      <div className="flex justify-between text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        <span>Tight (0.8)</span>
                        <span>Normal (1.35)</span>
                        <span>Wide (3.0)</span>
                      </div>
                    </div>
                  </Section>
                )}

                {/* ── Color (text + children table) ── */}
                {(selDef.type === TEXT_TYPE || selDef.key === 'childrenTable') && (
                  <Section label="Color">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(selConfig.color ?? '') ? selConfig.color : '#000000'}
                        onChange={(e) => updateProp(selected, 'color', e.target.value)}
                        className="w-9 h-9 rounded-lg border cursor-pointer p-0.5 flex-shrink-0"
                        style={{ borderColor: 'var(--color-border)' }}
                      />
                      <input
                        type="text"
                        value={selConfig.color ?? '#000000'}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^#[0-9a-fA-F]{0,6}$/.test(v)) updateProp(selected, 'color', v);
                        }}
                        placeholder="#000000"
                        className="flex-1 h-9 px-2 rounded-lg border text-xs font-mono"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', background: 'white', outline: 'none' }}
                        onFocus={(e) => { e.target.style.borderColor = selDef.color; }}
                        onBlur={(e)  => { e.target.style.borderColor = 'var(--color-border)'; }}
                      />
                    </div>
                    {/* Color preview swatch */}
                    <div className="mt-2 h-6 rounded-lg border" style={{ background: selConfig.color ?? '#000000', borderColor: 'var(--color-border)' }} />
                  </Section>
                )}
              </div>
            </div>
          )}

          {!selected && (
            <div className="px-4 py-6 text-center">
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Enable a placeholder using the toggles above, then click it on the canvas to configure its position and appearance.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Utility components ────────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>
        {label}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PropInput({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-2)' }}>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 px-2 rounded-lg border text-xs"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', background: 'white', outline: 'none' }}
        min={0}
      />
    </div>
  );
}

function FontFamilyPicker({ value, onChange, accentColor }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
        Font family
      </label>
      <div className="grid grid-cols-2 gap-1" style={{ maxHeight: 200, overflowY: 'auto' }}>
        {FONT_FAMILIES.map((f) => {
          const active = value === f.value;
          return (
            <button
              key={f.value}
              onClick={() => onChange(f.value)}
              title={f.label}
              style={{
                textAlign:    'left',
                padding:      '5px 8px',
                borderRadius: '6px',
                border:       `1px solid ${active ? accentColor : 'var(--color-border)'}`,
                background:   active ? accentColor : 'white',
                cursor:       'pointer',
                overflow:     'hidden',
                whiteSpace:   'nowrap',
                textOverflow: 'ellipsis',
                lineHeight:   1.3,
              }}
            >
              <span style={{ display: 'block', fontSize: '8px', opacity: 0.65, color: active ? 'rgba(255,255,255,0.85)' : 'var(--color-muted)', fontFamily: 'sans-serif' }}>
                {f.label}
              </span>
              <span style={{ fontFamily: f.value, fontSize: '12px', color: active ? 'white' : 'var(--color-text-1)' }}>
                AaBb 123
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StyleToggle({ active, onClick, accentColor, title, textStyle, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width:        36,
        height:       32,
        borderRadius: '8px',
        border:       `1.5px solid ${active ? accentColor : 'var(--color-border)'}`,
        background:   active ? accentColor : 'white',
        color:        active ? 'white' : 'var(--color-text-2)',
        cursor:       'pointer',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        fontSize:     '13px',
        transition:   'all 0.12s',
        flexShrink:   0,
        ...textStyle,
      }}
    >
      {children}
    </button>
  );
}
