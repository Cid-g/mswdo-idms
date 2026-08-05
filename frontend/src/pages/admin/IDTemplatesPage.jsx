import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard, Upload, Settings2, Eye, AlertCircle, CheckCircle2,
  Layers, X, History, RotateCcw, ImagePlus,
} from 'lucide-react';
import {
  getTemplate,
  createVersion,
  listVersions,
  activateVersion,
  fetchPreviewBlob,
} from '../../services/templateService';
import useAuthStore from '../../stores/authStore';

const DEPT_THEME = {
  PWD:            { accent: '#1E40AF', light: '#EFF6FF', label: 'Persons with Disability' },
  SOLO_PARENT:    { accent: '#9F1239', light: '#FFF1F2', label: 'Solo Parent' },
  SENIOR_CITIZEN: { accent: '#92400E', light: '#FFFBEB', label: 'Senior Citizen' },
};
const DEFAULT_THEME = { accent: '#475569', light: '#F8FAFC', label: 'All Departments' };
const DEPT_HAS_BACK = { PWD: true, SOLO_PARENT: true, SENIOR_CITIZEN: true };
const DEPARTMENTS   = ['PWD', 'SOLO_PARENT', 'SENIOR_CITIZEN'];
const DEPT_LABELS   = { PWD: 'PWD', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen' };

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function uploaderName(u) {
  if (!u) return 'Unknown';
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || 'Unknown';
}

function FilePreview({ file, sideLabel, theme }) {
  const [previewUrl] = useState(() => URL.createObjectURL(file));

  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);

  return (
    <img
      src={previewUrl}
      alt={`${sideLabel} preview`}
      className="rounded-lg max-h-32 object-contain w-full mb-1"
      style={{ border: `1px solid ${theme.accent}40` }}
    />
  );
}

// ── Drop zone for one side inside the upload modal ────────────────────────────
function SideDropZone({ side, theme, file, setFile, useCurrent, setUseCurrent, currentImageUrl, hasCurrent }) {
  const sideLabel = side === 'front' ? 'Front Side' : 'Back Side';
  const inputId = `template-${side}-input`;

  function handleFile(f) {
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(f.type)) return;
    if (f.size > 20 * 1024 * 1024) return;
    setFile(f);
    setUseCurrent(false);
  }

  const showingCurrent = useCurrent && hasCurrent && !file;
  const showingNew     = !!file;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>{sideLabel}</span>
        {hasCurrent && (
          <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" style={{ color: 'var(--color-text-2)' }}>
            <input
              type="checkbox"
              checked={useCurrent}
              onChange={(e) => {
                setUseCurrent(e.target.checked);
                if (e.target.checked) setFile(null);
              }}
              className="w-3.5 h-3.5"
              style={{ accentColor: theme.accent }}
            />
            Use current
          </label>
        )}
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
        onClick={() => document.getElementById(inputId).click()}
        className="rounded-xl border-2 border-dashed cursor-pointer transition-colors flex flex-col items-center justify-center text-center"
        style={{
          borderColor: showingNew ? theme.accent : showingCurrent ? 'var(--color-border)' : 'var(--color-border)',
          background:  showingNew ? theme.light : showingCurrent ? 'var(--color-surface)' : 'var(--color-surface)',
          minHeight:   '180px',
          padding:     '16px',
        }}
      >
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files[0])}
        />
        {showingNew ? (
          <>
            <FilePreview
              key={`${file.name}-${file.size}-${file.lastModified}`}
              file={file}
              sideLabel={sideLabel}
              theme={theme}
            />
            <span className="text-xs font-medium mt-1" style={{ color: theme.accent }}>New file selected</span>
          </>
        ) : showingCurrent ? (
          <>
            <img src={currentImageUrl} alt={`Current ${sideLabel}`} className="rounded-lg max-h-32 object-contain w-full mb-1 opacity-75" />
            <span className="text-xs font-medium mt-1" style={{ color: 'var(--color-muted)' }}>Keeping current image</span>
          </>
        ) : (
          <>
            <Upload className="w-6 h-6 mb-1.5" style={{ color: 'var(--color-muted)' }} />
            <p className="text-xs font-medium" style={{ color: 'var(--color-text-2)' }}>Click or drop image</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>PNG / JPEG · max 20 MB</p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Upload-new-version modal ──────────────────────────────────────────────────
function UploadModal({ activeVersion, dept, hasBack, theme, nextVersionNumber, onClose, onSuccess }) {
  const hasCurrentFront = !!activeVersion?.front?.imagePath;
  const hasCurrentBack  = !!activeVersion?.back?.imagePath;

  const [frontFile, setFrontFile]               = useState(null);
  const [backFile,  setBackFile]                = useState(null);
  const [useCurrentFront, setUseCurrentFront]   = useState(hasCurrentFront);
  const [useCurrentBack,  setUseCurrentBack]    = useState(hasCurrentBack);
  const [note, setNote]                         = useState('');
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!frontFile && !useCurrentFront) {
      setError('Provide a new front image or enable "Use current".');
      return;
    }
    setLoading(true); setError('');
    try {
      const result = await createVersion({
        department: dept,
        frontFile,
        backFile,
        useCurrentFront,
        useCurrentBack,
        note,
      });
      onSuccess(result);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Upload failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,22,35,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl w-full mx-4 my-6 overflow-hidden flex flex-col"
        style={{ maxWidth: hasBack ? '760px' : '520px', maxHeight: 'calc(100vh - 48px)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: theme.light }}>
              <ImagePlus className="w-5 h-5" style={{ color: theme.accent }} />
            </div>
            <div>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text-1)' }}>
                Upload Template Version {nextVersionNumber}
              </h2>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                This will become the active template. Existing issued IDs are not affected.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5 overflow-y-auto">
          <div className="grid gap-4" style={{ gridTemplateColumns: hasBack ? '1fr 1fr' : '1fr' }}>
            <SideDropZone
              side="front"
              theme={theme}
              file={frontFile}
              setFile={setFrontFile}
              useCurrent={useCurrentFront}
              setUseCurrent={setUseCurrentFront}
              currentImageUrl={activeVersion?.front?.imageUrl}
              hasCurrent={hasCurrentFront}
            />
            {hasBack && (
              <SideDropZone
                side="back"
                theme={theme}
                file={backFile}
                setFile={setBackFile}
                useCurrent={useCurrentBack}
                setUseCurrent={setUseCurrentBack}
                currentImageUrl={activeVersion?.back?.imageUrl}
                hasCurrent={hasCurrentBack}
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-2)' }}>
              Version note <span style={{ color: 'var(--color-muted)' }}>(optional)</span>
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Updated MSWDO logo on front"
              className="w-full h-10 px-3 rounded-lg border text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-1)', outline: 'none' }}
              onFocus={(e) => { e.target.style.borderColor = theme.accent; e.target.style.boxShadow = `0 0 0 3px ${theme.accent}20`; }}
              onBlur={(e)  => { e.target.style.borderColor = 'var(--color-border)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {activeVersion && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs"
              style={{ background: theme.light, border: `1px solid ${theme.accent}30` }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: theme.accent }} />
              <span style={{ color: 'var(--color-text-2)' }}>
                Placeholder positions will be inherited from version {activeVersion.versionNumber}.
                You can adjust them after uploading.
              </span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
              style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}
        </form>

        <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={onClose}
            className="h-9 px-4 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)', background: 'white' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={loading || (!frontFile && !useCurrentFront)}
            className="h-9 px-5 rounded-lg text-sm font-semibold text-white transition-all"
            style={{
              background: loading || (!frontFile && !useCurrentFront) ? 'var(--color-muted)' : theme.accent,
              cursor:     loading || (!frontFile && !useCurrentFront) ? 'not-allowed' : 'pointer',
            }}>
            {loading ? 'Creating...' : `Create Version ${nextVersionNumber}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Active version bar ────────────────────────────────────────────────────────
function ActiveVersionBar({ version, theme, onUpload }) {
  return (
    <div className="bg-white rounded-2xl px-5 py-4 mb-5 flex items-center justify-between gap-4 flex-wrap"
      style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-bold"
          style={{ background: theme.light, color: theme.accent }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: theme.accent }} />
          Version {version.versionNumber} · ACTIVE
        </span>
        <div className="text-xs min-w-0" style={{ color: 'var(--color-muted)' }}>
          <span className="font-medium" style={{ color: 'var(--color-text-2)' }}>{uploaderName(version.uploadedById)}</span>
          {' · '}{fmtDate(version.createdAt)}
          {version.note && (
            <span className="ml-2 italic truncate inline-block max-w-md align-bottom"
              style={{ color: 'var(--color-text-2)' }}>"{version.note}"</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onUpload}
          className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-sm font-semibold text-white transition-all"
          style={{ background: theme.accent }}
          onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.9)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}>
          <Upload className="w-4 h-4" /> Upload New Version
        </button>
      </div>
    </div>
  );
}

// ── Side card (for displaying active version's front/back) ────────────────────
function SideCard({ side, sideData, theme, versionId, navigate, editorBasePath }) {
  const sideLabel  = side === 'front' ? 'Front Side' : 'Back Side';
  const hasImage   = !!sideData?.imagePath;
  const configured = sideData?.placeholderConfig && Object.keys(sideData.placeholderConfig).length > 0;

  return (
    <div className="bg-white rounded-2xl overflow-hidden flex flex-col" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4" style={{ color: theme.accent }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>{sideLabel}</span>
        </div>
        {hasImage && configured && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
            <CheckCircle2 className="w-3 h-3" /> Configured
          </span>
        )}
      </div>

      <div className="flex items-center justify-center p-5 flex-1"
        style={{ background: 'var(--color-surface)', minHeight: '200px' }}>
        {hasImage ? (
          <img
            src={sideData.imageUrl}
            alt={`${sideLabel} template`}
            className="rounded-lg object-contain"
            style={{ maxHeight: '180px', maxWidth: '100%', boxShadow: 'var(--shadow-md)', border: '1px solid var(--color-border)' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 py-4" style={{ color: 'var(--color-muted)' }}>
            <CreditCard className="w-10 h-10" strokeWidth={1} />
            <span className="text-sm">No image for this side</span>
          </div>
        )}
      </div>

      <div className="px-5 pt-4 pb-5 space-y-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--color-muted)' }}>Placeholders</span>
          <span style={{ color: configured ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 600 }}>
            {configured ? `${Object.keys(sideData.placeholderConfig).length} configured` : 'Not configured'}
          </span>
        </div>

        {hasImage && !configured && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg text-xs"
            style={{ background: 'var(--color-warning-bg)', border: '1px solid #FDE68A' }}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
            <span style={{ color: '#92400E' }}>Configure placeholders before generating IDs.</span>
          </div>
        )}

        {hasImage && (
          <div className="flex flex-col gap-2">
            <button
              onClick={() => navigate(`${editorBasePath}/${versionId}?side=${side}`)}
              className="flex items-center gap-2 w-full h-9 px-4 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: theme.accent }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(0.9)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}>
              <Settings2 className="w-4 h-4" /> Configure Placeholders
            </button>
            <button
              onClick={async () => {
                try {
                  const blob = await fetchPreviewBlob(versionId, side);
                  const url  = URL.createObjectURL(blob);
                  window.open(url, '_blank');
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                } catch { /* silent */ }
              }}
              className="flex items-center gap-2 w-full h-9 px-4 rounded-xl text-sm font-semibold border transition-all"
              style={{ background: 'white', color: 'var(--color-text-1)', border: '1px solid var(--color-border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}>
              <Eye className="w-4 h-4" /> Preview Raw Image
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state when no template exists yet ───────────────────────────────────
function EmptyState({ theme, onUpload }) {
  return (
    <div className="bg-white rounded-2xl p-10 text-center" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
        style={{ background: theme.light }}>
        <CreditCard className="w-8 h-8" style={{ color: theme.accent }} strokeWidth={1.5} />
      </div>
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text-1)' }}>No template yet</h3>
      <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
        Upload the first ID template version to get started.
      </p>
      <button onClick={onUpload}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl text-sm font-semibold text-white"
        style={{ background: theme.accent }}>
        <Upload className="w-4 h-4" /> Upload First Version
      </button>
    </div>
  );
}

// ── Version history panel ─────────────────────────────────────────────────────
function VersionHistory({ versions, activeVersionId, theme, onActivate }) {
  if (versions.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 mt-5 text-center text-sm" style={{ boxShadow: 'var(--shadow-card)', color: 'var(--color-muted)' }}>
        Loading version history...
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl mt-5 overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
        <History className="w-4 h-4" style={{ color: theme.accent }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>Version History</span>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>· {versions.length} total</span>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
        {versions.map((v) => {
          const isActive = String(v._id) === String(activeVersionId);
          return (
            <li key={v._id} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors">
              <div className="flex-shrink-0">
                <span className="inline-flex items-center justify-center h-8 w-12 rounded-lg text-xs font-bold"
                  style={{
                    background: isActive ? theme.accent : 'var(--color-surface)',
                    color:      isActive ? 'white'      : 'var(--color-text-2)',
                    border:     isActive ? 'none'       : '1px solid var(--color-border)',
                  }}>
                  v{v.versionNumber}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {[v.front, v.back].map((s, i) => (
                  s?.imageUrl ? (
                    <img key={i} src={s.imageUrl} alt="" className="h-10 w-14 object-cover rounded border"
                      style={{ borderColor: 'var(--color-border)' }} />
                  ) : (
                    <div key={i} className="h-10 w-14 rounded border flex items-center justify-center"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      <CreditCard className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
                    </div>
                  )
                ))}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-1)' }}>
                  {v.note || <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>(no note)</span>}
                </div>
                <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {fmtDate(v.createdAt)} · {uploaderName(v.uploadedById)}
                </div>
              </div>

              <div className="flex-shrink-0">
                {isActive ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold"
                    style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                ) : (
                  <button onClick={() => onActivate(v)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold border transition-colors"
                    style={{ background: 'white', color: theme.accent, borderColor: `${theme.accent}50` }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = theme.light; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}>
                    <RotateCcw className="w-3 h-3" /> Set Active
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Activation confirmation modal ─────────────────────────────────────────────
function ActivateConfirmModal({ version, theme, onClose, onConfirm, busy }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(15,22,35,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="bg-white rounded-2xl w-full mx-4" style={{ maxWidth: '440px', boxShadow: 'var(--shadow-lg)' }}>
        <div className="px-6 pt-6 pb-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: theme.light }}>
            <RotateCcw className="w-5 h-5" style={{ color: theme.accent }} />
          </div>
          <div>
            <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--color-text-1)' }}>
              Activate Version {version.versionNumber}?
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-2)' }}>
              New IDs generated from now on will use this version's template.
              <span className="block mt-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                Existing issued IDs are <strong>not</strong> affected — they keep the template they were generated with.
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button onClick={onClose} disabled={busy}
            className="h-9 px-4 rounded-lg text-sm font-medium border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)', background: 'white' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="h-9 px-5 rounded-lg text-sm font-semibold text-white"
            style={{ background: busy ? 'var(--color-muted)' : theme.accent, cursor: busy ? 'not-allowed' : 'pointer' }}>
            {busy ? 'Activating...' : 'Activate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IDTemplatesPage() {
  const navigate     = useNavigate();
  const { user }     = useAuthStore();
  const isSuperAdmin   = user?.role === 'SUPERADMIN';
  const editorBasePath = (user?.role === 'ADMIN' || user?.role === 'SUPERADMIN')
    ? '/admin/templates/editor'
    : '/staff/templates/editor';

  const [selectedDept, setSelectedDept] = useState(user?.department ?? 'PWD');
  const dept    = isSuperAdmin ? selectedDept : (user?.department ?? 'PWD');
  const theme   = DEPT_THEME[dept] ?? DEFAULT_THEME;
  const hasBack = DEPT_HAS_BACK[dept] ?? false;

  const [template,        setTemplate]        = useState(null);
  const [activeVersion,   setActiveVersion]   = useState(null);
  const [versions,        setVersions]        = useState([]);
  const [historyLoading,  setHistoryLoading]  = useState(false);
  const [loadedDept,      setLoadedDept]      = useState(null);
  const [refreshing,      setRefreshing]      = useState(true);
  const loading = loadedDept !== dept || refreshing;
  const [showUpload,      setShowUpload]      = useState(false);
  const [confirmActivate, setConfirmActivate] = useState(null);
  const [activating,      setActivating]      = useState(false);
  const [successMsg,      setSuccessMsg]      = useState('');

  const loadTemplateData = useCallback(async () => {
    try {
      const result = await getTemplate(dept);
      let nextVersions = [];
      if (result.template?._id) {
        try {
          const history = await listVersions(result.template._id);
          nextVersions = history.versions;
        } catch {
          /* Keep the template visible when only history loading fails. */
        }
      }
      return {
        template: result.template,
        activeVersion: result.activeVersion,
        versions: nextVersions,
      };
    } catch {
      return { template: null, activeVersion: null, versions: [] };
    }
  }, [dept]);

  const applyTemplateData = useCallback((data) => {
    setTemplate(data.template);
    setActiveVersion(data.activeVersion);
    setVersions(data.versions);
    setLoadedDept(dept);
  }, [dept]);

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    setHistoryLoading(true);
    try {
      const data = await loadTemplateData();
      applyTemplateData(data);
    } finally {
      setHistoryLoading(false);
      setRefreshing(false);
    }
  }, [applyTemplateData, loadTemplateData]);

  useEffect(() => {
    let active = true;
    loadTemplateData()
      .then((data) => { if (active) applyTemplateData(data); })
      .finally(() => {
        if (!active) return;
        setHistoryLoading(false);
        setRefreshing(false);
      });
    return () => { active = false; };
  }, [applyTemplateData, loadTemplateData]);

  function handleUploadSuccess(newVersion) {
    setShowUpload(false);
    setSuccessMsg(`Version ${newVersion.versionNumber} created and set as active.`);
    setTimeout(() => setSuccessMsg(''), 5000);
    fetchData();
  }

  async function handleActivate() {
    if (!confirmActivate) return;
    setActivating(true);
    try {
      await activateVersion(confirmActivate._id);
      const versionNum = confirmActivate.versionNumber;
      setConfirmActivate(null);
      setSuccessMsg(`Activated version ${versionNum}.`);
      setTimeout(() => setSuccessMsg(''), 5000);
      await fetchData();
    } catch { /* silent */ } finally {
      setActivating(false);
    }
  }

  const nextVersionNumber = (activeVersion?.versionNumber || 0) + 1;

  return (
    <div className="animate-fade-up">
      {/* Banner */}
      <div className="rounded-2xl overflow-hidden mb-6 relative"
        style={{ background: `linear-gradient(135deg, ${theme.accent}ee 0%, ${theme.accent}bb 100%)`, boxShadow: 'var(--shadow-lg)', minHeight: '140px' }}>
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: 'rgba(255,255,255,0.06)', transform: 'translate(35%, -45%)' }} />
        <div className="relative z-10 px-10 py-8">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'rgba(255,255,255,0.18)' }}>
              <CreditCard className="w-6 h-6 text-white" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="font-serif text-3xl text-white leading-tight mb-1">ID Templates</h1>
              <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.875rem' }}>
                {theme.label} · Versioned {hasBack ? 'front and back' : 'front'} ID card template
              </p>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="flex items-center gap-2 flex-wrap">
              {DEPARTMENTS.map((d) => (
                <button key={d} onClick={() => setSelectedDept(d)}
                  className="h-7 px-3 rounded-lg text-xs font-semibold transition-all"
                  style={
                    d === dept
                      ? { background: 'rgba(255,255,255,0.9)', color: theme.accent }
                      : { background: 'rgba(255,255,255,0.18)', color: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,255,255,0.3)' }
                  }>
                  {DEPT_LABELS[d]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-5 text-sm font-medium"
          style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #BBF7D0' }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> {successMsg}
        </div>
      )}

      {loading ? (
        <div className="grid gap-5 animate-pulse"
          style={{ gridTemplateColumns: hasBack ? '1fr 1fr' : '1fr', maxWidth: hasBack ? 'none' : '580px' }}>
          <div className="bg-white rounded-2xl h-96" style={{ boxShadow: 'var(--shadow-card)' }} />
          {hasBack && <div className="bg-white rounded-2xl h-96" style={{ boxShadow: 'var(--shadow-card)' }} />}
        </div>
      ) : activeVersion ? (
        <>
          <ActiveVersionBar
            version={activeVersion}
            theme={theme}
            onUpload={() => setShowUpload(true)}
          />

          <div className="grid gap-5"
            style={{ gridTemplateColumns: hasBack ? '1fr 1fr' : '1fr', maxWidth: hasBack ? 'none' : '580px' }}>
            <SideCard side="front" sideData={activeVersion.front} theme={theme}
              versionId={activeVersion._id} navigate={navigate} editorBasePath={editorBasePath} />
            {hasBack && (
              <SideCard side="back" sideData={activeVersion.back} theme={theme}
                versionId={activeVersion._id} navigate={navigate} editorBasePath={editorBasePath} />
            )}
          </div>

          {historyLoading ? (
            <div className="bg-white rounded-2xl p-6 mt-5 text-center text-sm"
              style={{ boxShadow: 'var(--shadow-card)', color: 'var(--color-muted)' }}>
              Loading version history...
            </div>
          ) : (
            <VersionHistory versions={versions} activeVersionId={template?.activeVersionId}
              theme={theme} onActivate={setConfirmActivate} />
          )}
        </>
      ) : (
        <EmptyState theme={theme} onUpload={() => setShowUpload(true)} />
      )}

      {showUpload && (
        <UploadModal
          activeVersion={activeVersion}
          dept={dept}
          hasBack={hasBack}
          theme={theme}
          nextVersionNumber={nextVersionNumber}
          onClose={() => setShowUpload(false)}
          onSuccess={handleUploadSuccess}
        />
      )}

      {confirmActivate && (
        <ActivateConfirmModal
          version={confirmActivate}
          theme={theme}
          onClose={() => setConfirmActivate(null)}
          onConfirm={handleActivate}
          busy={activating}
        />
      )}
    </div>
  );
}
