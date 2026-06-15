import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Printer, Download, CheckCircle2, Clock,
  CreditCard, AlertCircle, Loader2, RefreshCw, Ban,
  ShieldCheck, LayoutGrid,
} from 'lucide-react';
import {
  generateIDRecord,
  getIDRecordByApplicant,
  fetchIDImageBlob,
  fetchIDBackImageBlob,
  reprintID,
  revokeID,
} from '../../services/idRecordService';
import {
  getBlockchainStatus,
  verifyIntegrity,
  anchorRecord,
} from '../../services/blockchainService';
import api from '../../services/api';
import useAuthStore from '../../stores/authStore';

const DEPT_THEME = {
  PWD:            { accent: '#1E40AF', light: '#EFF6FF', gradient: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)', label: 'Persons with Disability' },
  SOLO_PARENT:    { accent: '#9F1239', light: '#FFF1F2', gradient: 'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)', label: 'Solo Parent' },
  SENIOR_CITIZEN: { accent: '#92400E', light: '#FFFBEB', gradient: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)', label: 'Senior Citizen' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function IDCardPage() {
  const { id: applicantId } = useParams();
  const navigate            = useNavigate();
  const { user }            = useAuthStore();
  const theme               = DEPT_THEME[user?.department] ?? DEPT_THEME.PWD;

  const [applicant,    setApplicant]    = useState(null);
  const [idRecord,     setIDRecord]     = useState(null);
  const [imageUrl,     setImageUrl]     = useState(null);
  const [backImageUrl, setBackImageUrl] = useState(null);
  const [activeTab,    setActiveTab]    = useState('front');
  const [loading,      setLoading]      = useState(true);
  const [generating,   setGenerating]   = useState(false);
  const [reprinting,   setReprinting]   = useState(false);
  const [revoking,     setRevoking]     = useState(false);
  const [revokeModal,      setRevokeModal]      = useState(false);
  const [revokeReason,     setRevokeReason]     = useState('');
  const [error,            setError]            = useState('');
  const [toast,            setToast]            = useState(null);
  const [blockchainStatus, setBlockchainStatus] = useState(null);
  const [verifying,        setVerifying]        = useState(false);
  const [anchoring,        setAnchoring]        = useState(false);

  const imageUrlRef     = useRef(null);
  const backImageUrlRef = useRef(null);

  function setFrontImage(blob) {
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const url = URL.createObjectURL(blob);
    imageUrlRef.current = url;
    setImageUrl(url);
  }

  function setBackImage(blob) {
    if (backImageUrlRef.current) URL.revokeObjectURL(backImageUrlRef.current);
    const url = URL.createObjectURL(blob);
    backImageUrlRef.current = url;
    setBackImageUrl(url);
  }

  useEffect(() => () => {
    if (imageUrlRef.current)     URL.revokeObjectURL(imageUrlRef.current);
    if (backImageUrlRef.current) URL.revokeObjectURL(backImageUrlRef.current);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setActiveTab('front');
    setBlockchainStatus(null);
    try {
      const { data: a } = await api.get(`/applicants/${applicantId}`);
      setApplicant(a);

      try {
        const record = await getIDRecordByApplicant(applicantId);
        setIDRecord(record);
        const blob = await fetchIDImageBlob(record._id);
        setFrontImage(blob);

        if (record.idImageBackUrl) {
          try {
            const backBlob = await fetchIDBackImageBlob(record._id);
            setBackImage(backBlob);
          } catch { /* non-fatal — back might not be generated yet */ }
        }

        try {
          const bc = await getBlockchainStatus(record._id);
          setBlockchainStatus(bc);
        } catch { /* blockchain may be disabled */ }
      } catch (e) {
        if (e.response?.status !== 404) throw e;
        setIDRecord(null);
        setImageUrl(null);
        setBackImageUrl(null);
      }
    } catch (e) {
      setError(e.response?.data?.error?.message || 'Failed to load applicant data.');
    } finally {
      setLoading(false);
    }
  }, [applicantId]);

  useEffect(() => { load(); }, [load]);

  function showToast(type, msg) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  }

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    try {
      const record = await generateIDRecord(applicantId);
      setIDRecord(record);
      const blob = await fetchIDImageBlob(record._id);
      setFrontImage(blob);
      setActiveTab('front');

      if (record.idImageBackUrl) {
        try {
          const backBlob = await fetchIDBackImageBlob(record._id);
          setBackImage(backBlob);
        } catch { /* non-fatal */ }
      } else {
        setBackImageUrl(null);
      }

      showToast('success', 'ID card generated successfully!');
    } catch (e) {
      setError(e.response?.data?.error?.message || 'ID generation failed.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleReprint() {
    if (!idRecord) return;
    setReprinting(true);
    try {
      const updated = await reprintID(idRecord._id);
      setIDRecord(updated);
      showToast('success', `Reprint recorded (total: ${updated.reprintCount}).`);
    } catch (e) {
      showToast('error', e.response?.data?.error?.message || 'Reprint log failed.');
    } finally {
      setReprinting(false);
    }
  }

  async function handleRevoke() {
    if (!idRecord || !revokeReason.trim()) return;
    setRevoking(true);
    try {
      const updated = await revokeID(idRecord._id, revokeReason.trim());
      setIDRecord(updated);
      setRevokeModal(false);
      setRevokeReason('');
      showToast('success', 'ID card has been revoked.');
    } catch (e) {
      showToast('error', e.response?.data?.error?.message || 'Revocation failed.');
    } finally {
      setRevoking(false);
    }
  }

  async function handleVerify() {
    if (!idRecord) return;
    setVerifying(true);
    try {
      const result = await verifyIntegrity(idRecord.idNumber);
      setBlockchainStatus(prev => ({
        ...prev,
        lastCheckedAt:   new Date().toISOString(),
        lastCheckPassed: result.hashMatch,
      }));
      showToast(
        result.hashMatch ? 'success' : 'error',
        result.hashMatch
          ? 'Blockchain integrity verified.'
          : 'Hash mismatch detected — data may have been altered.',
      );
    } catch (e) {
      showToast('error', e.response?.data?.error?.message || 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  }

  async function handleAnchorNow() {
    if (!idRecord) return;
    setAnchoring(true);
    try {
      const result = await anchorRecord(idRecord._id);
      setBlockchainStatus({
        anchored:        true,
        canonicalHash:   result.hash,
        anchoredAt:      result.anchor.anchoredAt,
        lastCheckedAt:   null,
        lastCheckPassed: null,
      });
      showToast('success', 'ID record anchored to blockchain.');
    } catch (e) {
      showToast('error', e.response?.data?.error?.message || 'Anchoring failed.');
    } finally {
      setAnchoring(false);
    }
  }

  function handlePrint() {
    if (!idRecord) return;
    api.post('/id-records/batch-log-print', { ids: [idRecord._id] })
      .then(() => setIDRecord((r) => r ? { ...r, printCount: (r.printCount || 0) + 1, lastPrintedAt: new Date().toISOString() } : r))
      .catch(() => {});
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  function handleDownload() {
    const url = activeTab === 'back' ? backImageUrl : imageUrl;
    if (!url) return;
    const suffix = activeTab === 'back' ? '-back' : '';
    const a = document.createElement('a');
    a.href     = url;
    a.download = `ID-${applicant?.lastName || 'card'}-${idRecord?.idNumber || ''}${suffix}.png`;
    a.click();
  }

  const hasBack      = Boolean(backImageUrl);
  const displayUrl   = activeTab === 'back' ? backImageUrl : imageUrl;

  if (loading) return <LoadingState theme={theme} />;

  return (
    <>
      <style>{`
        @media screen  { .id-print-only { display: none !important; } }
        @media print {
          aside, .no-print { display: none !important; }
          body { margin: 0; background: white; }
          .id-print-only { display: block !important; padding: 10mm; }
          .id-print-grid {
            display: grid;
            grid-template-columns: 85.6mm 85.6mm;
            gap: 4mm;
            width: fit-content;
          }
          .id-print-cell { width: 85.6mm; height: 54mm; overflow: hidden; }
          .id-print-cell img { width: 85.6mm; height: 54mm; display: block; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="animate-fade-up">
        {/* Toast */}
        {toast && (
          <div
            className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium no-print"
            style={
              toast.type === 'success'
                ? { background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid #BBF7D0', boxShadow: 'var(--shadow-md)' }
                : { background: 'var(--color-danger-bg)',  color: 'var(--color-danger)',  border: '1px solid #FECACA', boxShadow: 'var(--shadow-md)' }
            }
          >
            {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {toast.msg}
          </div>
        )}

        {/* ── Dept gradient banner ── */}
        <div
          className="rounded-2xl overflow-hidden mb-6 relative no-print"
          style={{ background: theme.gradient ?? 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)', minHeight: '110px', boxShadow: 'var(--shadow-lg)' }}
        >
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
               style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
               style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />
          <div className="relative z-10 px-8 py-6 flex items-center justify-between">
            <div>
              <h1 className="font-serif text-3xl text-white leading-tight">ID Card</h1>
              <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
                {theme.label}
                {applicant && (
                  <span className="ml-2" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    · {applicant.lastName?.toUpperCase()}, {applicant.firstName}
                  </span>
                )}
              </p>
            </div>
            <button
              onClick={() => navigate(`/staff/applicants/${applicantId}`)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to Applicant
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl mb-5 text-sm no-print"
            style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid #FECACA' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {/* Revoked banner */}
        {idRecord?.status === 'REVOKED' && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl mb-5 text-sm no-print"
            style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid #FECACA' }}>
            <Ban className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">This ID has been revoked</p>
              {idRecord.revokedReason && (
                <p className="mt-0.5" style={{ color: '#7F1D1D' }}>Reason: {idRecord.revokedReason}</p>
              )}
              {idRecord.revokedAt && (
                <p className="mt-0.5 text-xs" style={{ color: '#7F1D1D' }}>Revoked on {fmtDate(idRecord.revokedAt)}</p>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-5 no-print" style={{ gridTemplateColumns: imageUrl ? '1fr 320px' : '1fr' }}>

          {/* ID image card */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-card)' }}>
            {/* Card header with tab switcher */}
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <CreditCard className="w-4 h-4" style={{ color: 'var(--color-muted)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-1)' }}>ID Card Preview</span>

              {hasBack && imageUrl ? (
                <div className="ml-auto flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-surface)' }}>
                  <TabBtn label="Front" active={activeTab === 'front'} onClick={() => setActiveTab('front')} accent={theme.accent} />
                  <TabBtn label="Back"  active={activeTab === 'back'}  onClick={() => setActiveTab('back')}  accent={theme.accent} />
                </div>
              ) : idRecord ? (
                <span className="ml-auto text-xs font-mono px-2 py-0.5 rounded"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
                  {idRecord.idNumber}
                </span>
              ) : null}
            </div>

            <div className="flex items-center justify-center p-8"
              style={{ background: 'var(--color-surface)', minHeight: '280px' }}>
              {displayUrl ? (
                <div>
                  <img
                    src={displayUrl}
                    alt={`${activeTab === 'back' ? 'Back' : 'Front'} ID Card`}
                    className="rounded-lg"
                    style={{ maxWidth: '100%', maxHeight: '320px', objectFit: 'contain', boxShadow: 'var(--shadow-lg)' }}
                  />
                </div>
              ) : (
                <NoIDState theme={theme} onGenerate={handleGenerate} generating={generating} applicant={applicant} />
              )}
            </div>
          </div>

          {/* Right panel */}
          {imageUrl && idRecord && (
            <div className="flex flex-col gap-4">

              {/* Actions */}
              <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
                  Actions
                </p>
                <div className="flex flex-col gap-2">
                  <ActionBtn icon={<Printer className="w-4 h-4" />} label="Print ID Card" onClick={handlePrint} accent={theme.accent} primary />
                  <ActionBtn
                    icon={<LayoutGrid className="w-4 h-4" />}
                    label="Batch Print Queue"
                    onClick={() => navigate('/staff/batch-print')}
                  />
                  <ActionBtn
                    icon={<Download className="w-4 h-4" />}
                    label={`Download ${hasBack ? (activeTab === 'back' ? 'Back' : 'Front') : ''} PNG`}
                    onClick={handleDownload}
                  />
                  <ActionBtn
                    icon={reprinting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    label={reprinting ? 'Logging...' : 'Log Reprint'}
                    onClick={handleReprint}
                    disabled={reprinting}
                  />
                  {idRecord.status !== 'REVOKED' && (
                    <ActionBtn
                      icon={<Ban className="w-4 h-4" />}
                      label="Revoke ID"
                      onClick={() => { setRevokeReason(''); setRevokeModal(true); }}
                      danger
                    />
                  )}
                </div>
              </div>

              {/* ID details */}
              <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
                  ID Details
                </p>
                <dl className="space-y-2.5">
                  <InfoRow label="ID Number" value={idRecord.idNumber} mono />
                  <InfoRow label="Issued"    value={fmtDate(idRecord.issuedDate)} />
                  <InfoRow label="Expires"   value={idRecord.expiryDate ? fmtDate(idRecord.expiryDate) : 'No Expiry'} />
                  <InfoRow label="Status"    value={<StatusPill status={idRecord.status} />} />
                  {idRecord.reprintCount > 0 && <InfoRow label="Reprints" value={`${idRecord.reprintCount}×`} />}
                  {hasBack && (
                    <InfoRow label="Sides" value={
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-text-2)' }}>
                        Front + Back
                      </span>
                    } />
                  )}
                  {(idRecord.printCount || 0) > 0 && (
                    <InfoRow label="Print Count" value={`${idRecord.printCount}×`} />
                  )}
                  {idRecord.lastPrintedAt && (
                    <InfoRow label="Last Printed" value={fmtDate(idRecord.lastPrintedAt)} />
                  )}
                </dl>
              </div>

              {/* Reprint Log */}
              {idRecord.reprintHistory?.length > 0 && (
                <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
                    Reprint Log ({idRecord.reprintHistory.length})
                  </p>
                  <div className="space-y-2">
                    {[...idRecord.reprintHistory].reverse().map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex flex-col gap-0.5 pb-2 text-xs"
                        style={{
                          borderBottom: idx < idRecord.reprintHistory.length - 1 ? '1px solid var(--color-border)' : 'none',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium" style={{ color: 'var(--color-text-1)' }}>
                            {entry.reprintedBy
                              ? `${entry.reprintedBy.firstName} ${entry.reprintedBy.lastName}`
                              : 'Unknown'}
                          </span>
                          <span className="flex-shrink-0" style={{ color: 'var(--color-muted)' }}>
                            {fmtDateTime(entry.reprintedAt)}
                          </span>
                        </div>
                        {entry.reason && (
                          <span style={{ color: 'var(--color-text-2)' }}>{entry.reason}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blockchain */}
              <div className="bg-white rounded-2xl p-5" style={{ boxShadow: 'var(--shadow-card)' }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--color-muted)' }}>
                  Blockchain Integrity
                </p>
                <BlockchainStatusPanel
                  status={blockchainStatus}
                  onVerify={handleVerify}
                  onAnchor={handleAnchorNow}
                  verifying={verifying}
                  anchoring={anchoring}
                  canAnchor={user?.role === 'SUPERADMIN' || user?.role === 'ADMIN'}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Print-only output: front + back side by side */}
      <div className="id-print-only">
        <div className="id-print-grid">
          {imageUrl    && <div className="id-print-cell"><img src={imageUrl}     alt="" /></div>}
          {backImageUrl && <div className="id-print-cell"><img src={backImageUrl} alt="" /></div>}
        </div>
      </div>

      {/* Revoke confirmation modal */}
      {revokeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print"
          style={{ background: 'rgba(15,22,35,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setRevokeModal(false); }}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md p-6 flex flex-col gap-5"
            style={{ boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'var(--color-danger-bg)' }}>
                <Ban className="w-5 h-5" style={{ color: 'var(--color-danger)' }} />
              </div>
              <div>
                <h2 className="font-serif text-xl" style={{ color: 'var(--color-text-1)' }}>Revoke ID Card</h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-text-2)' }}>
                  This will permanently invalidate{' '}
                  <span className="font-semibold font-mono">{idRecord?.idNumber}</span>.
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                Reason for Revocation <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <textarea
                rows={3}
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                placeholder="e.g. Duplicate record, applicant deceased, reported lost..."
                className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none transition-all"
                style={{
                  border: '1.5px solid var(--color-border)',
                  color: 'var(--color-text-1)',
                  background: 'var(--color-surface)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-danger)'; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                autoFocus
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRevokeModal(false)}
                className="h-10 px-5 rounded-xl text-sm font-semibold border transition-colors"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-2)', background: 'white' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
              >
                Cancel
              </button>
              <button
                onClick={handleRevoke}
                disabled={revoking || !revokeReason.trim()}
                className="flex items-center gap-2 h-10 px-5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{
                  background: revoking || !revokeReason.trim() ? 'var(--color-muted)' : 'var(--color-danger)',
                  cursor: revoking || !revokeReason.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {revoking
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Revoking...</>
                  : <><Ban className="w-4 h-4" /> Revoke ID</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TabBtn({ label, active, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className="h-7 px-3 rounded-md text-xs font-semibold transition-all"
      style={
        active
          ? { background: accent, color: 'white' }
          : { background: 'transparent', color: 'var(--color-text-2)' }
      }
    >
      {label}
    </button>
  );
}

function NoIDState({ theme, onGenerate, generating, applicant }) {
  const hasPhoto = Boolean(applicant?.photoPath);
  return (
    <div className="flex flex-col items-center text-center py-6">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: theme.light }}>
        <CreditCard className="w-8 h-8" style={{ color: theme.accent }} strokeWidth={1.5} />
      </div>
      <h3 className="font-serif text-xl mb-2" style={{ color: 'var(--color-text-1)' }}>No ID Generated Yet</h3>
      <p className="text-sm mb-6" style={{ color: 'var(--color-muted)', maxWidth: '340px' }}>
        {hasPhoto
          ? 'Click the button below to generate the ID card for this applicant.'
          : 'A photo must be uploaded before an ID can be generated.'}
      </p>
      {hasPhoto ? (
        <button
          onClick={onGenerate}
          disabled={generating}
          className="flex items-center gap-2 h-10 px-6 rounded-xl text-sm font-semibold text-white transition-all"
          style={{ background: generating ? 'var(--color-muted)' : theme.accent, cursor: generating ? 'not-allowed' : 'pointer' }}
        >
          {generating
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
            : <><CreditCard className="w-4 h-4" /> Generate ID Card</>}
        </button>
      ) : (
        <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
          Upload a photo first on the applicant's profile page.
        </p>
      )}
    </div>
  );
}

function ActionBtn({ icon, label, onClick, primary, accent, disabled, danger }) {
  function baseStyle() {
    if (primary) return { background: accent, color: 'white' };
    if (danger)  return { background: 'var(--color-danger-bg)', color: 'var(--color-danger)', border: '1px solid #FECACA' };
    return { background: 'white', color: 'var(--color-text-1)', border: '1px solid var(--color-border)' };
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2.5 w-full h-10 px-4 rounded-xl text-sm font-semibold transition-all"
      style={{ ...baseStyle(), opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.filter = 'brightness(0.95)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
    >
      {icon} {label}
    </button>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs" style={{ color: 'var(--color-muted)', flexShrink: 0 }}>{label}</dt>
      <dd className={`text-xs font-medium text-right ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--color-text-1)' }}>
        {value}
      </dd>
    </div>
  );
}

function StatusPill({ status }) {
  const s = {
    ACTIVE:  { bg: 'var(--color-success-bg)', color: 'var(--color-success)', label: 'Active'  },
    EXPIRED: { bg: '#F3F4F6',                 color: '#4B5563',              label: 'Expired' },
    REVOKED: { bg: 'var(--color-danger-bg)',  color: 'var(--color-danger)',  label: 'Revoked' },
  }[status] ?? { bg: '#F3F4F6', color: '#4B5563', label: status };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />{s.label}
    </span>
  );
}

function BlockchainStatusPanel({ status, onVerify, onAnchor, verifying, anchoring, canAnchor }) {
  if (status === null) {
    return (
      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking status...
      </div>
    );
  }

  if (!status.anchored) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--color-warning-bg)' }}>
          <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} />
          <div>
            <p className="text-xs font-semibold" style={{ color: '#92400E' }}>Pending Anchor</p>
            <p className="text-xs mt-0.5" style={{ color: '#92400E' }}>
              Not yet recorded on the blockchain.
            </p>
          </div>
        </div>
        {canAnchor && (
          <button
            onClick={onAnchor}
            disabled={anchoring}
            className="flex items-center justify-center gap-2 w-full h-9 px-4 rounded-xl text-xs font-semibold border transition-all"
            style={{
              borderColor: 'var(--color-border)',
              color: anchoring ? 'var(--color-muted)' : 'var(--color-text-1)',
              background: 'white',
              opacity: anchoring ? 0.6 : 1,
              cursor: anchoring ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => { if (!anchoring) e.currentTarget.style.filter = 'brightness(0.97)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
          >
            {anchoring
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Anchoring...</>
              : <><ShieldCheck className="w-3.5 h-3.5" /> Anchor Now</>}
          </button>
        )}
      </div>
    );
  }

  const hashPreview  = status.canonicalHash ? `${status.canonicalHash.slice(0, 10)}…` : '—';
  const txPreview    = status.txId ? `${status.txId.slice(0, 10)}…` : null;
  const everChecked  = status.lastCheckedAt != null;
  const checkPassed  = status.lastCheckPassed;

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-start gap-3 p-3 rounded-lg"
        style={{ background: everChecked && !checkPassed ? 'var(--color-danger-bg)' : 'var(--color-success-bg)' }}
      >
        <ShieldCheck
          className="w-4 h-4 flex-shrink-0 mt-0.5"
          style={{ color: everChecked && !checkPassed ? 'var(--color-danger)' : 'var(--color-success)' }}
        />
        <div className="flex-1 min-w-0">
          <p
            className="text-xs font-semibold"
            style={{ color: everChecked && !checkPassed ? 'var(--color-danger)' : 'var(--color-success)' }}
          >
            {everChecked && !checkPassed ? 'Hash Mismatch Detected' : 'Anchored on Blockchain'}
          </p>
          <p className="text-xs mt-0.5 font-mono truncate" style={{ color: 'var(--color-text-2)' }}>
            Hash: {hashPreview}
          </p>
          {txPreview && (
            <p className="text-xs font-mono truncate" style={{ color: 'var(--color-text-2)' }}>
              TxID: {txPreview}
            </p>
          )}
          {status.blockNumber != null && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Block #{status.blockNumber}
            </p>
          )}
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Anchored {fmtDate(status.anchoredAt)}
          </p>
          {everChecked && (
            <p
              className="text-xs mt-1 font-medium"
              style={{ color: checkPassed ? 'var(--color-success)' : 'var(--color-danger)' }}
            >
              {checkPassed ? '✓ Integrity verified' : '✗ Data may have been altered'}
              {' · '}{fmtDate(status.lastCheckedAt)}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={onVerify}
        disabled={verifying}
        className="flex items-center justify-center gap-2 w-full h-9 px-4 rounded-xl text-xs font-semibold border transition-all"
        style={{
          borderColor: 'var(--color-border)',
          color: verifying ? 'var(--color-muted)' : 'var(--color-text-1)',
          background: 'white',
          opacity: verifying ? 0.6 : 1,
          cursor: verifying ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => { if (!verifying) e.currentTarget.style.filter = 'brightness(0.97)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
      >
        {verifying
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verifying...</>
          : <><ShieldCheck className="w-3.5 h-3.5" /> Verify Integrity</>}
      </button>
    </div>
  );
}

function LoadingState({ theme }) {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: theme.accent }} />
    </div>
  );
}
