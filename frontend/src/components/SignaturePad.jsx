import { useState, useRef, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { PenLine, UploadCloud, Trash2, CheckCircle2, RefreshCw, Camera } from 'lucide-react';
import { cn } from '../lib/utils';
import { applicantService } from '../services/applicantService';
import CameraCapture from './CameraCapture';
import { toast } from 'sonner';

// ── Component ──────────────────────────────────────────────────────────────────
export default function SignaturePad({ applicantId, existingSignatureUrl, onComplete, accentColor = '#334155' }) {
  const [tab, setTab]               = useState('draw');
  const [saving, setSaving]         = useState(false);
  // Start null when existingSignatureUrl is an API path — useEffect will fetch as blob
  const [savedUrl, setSavedUrl]     = useState(
    existingSignatureUrl?.startsWith('blob:') ? existingSignatureUrl : null
  );
  const [isSaved, setIsSaved]       = useState(!!existingSignatureUrl);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreview, setUploadPreview] = useState(null);
  const sigCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const savedBlob    = useRef(null); // tracks blob URL for cleanup

  // Load existingSignatureUrl as an authenticated blob URL
  useEffect(() => {
    if (!existingSignatureUrl || existingSignatureUrl.startsWith('blob:')) return;
    applicantService.fetchFileBlob(existingSignatureUrl)
      .then((blobUrl) => {
        if (savedBlob.current) URL.revokeObjectURL(savedBlob.current);
        savedBlob.current = blobUrl;
        setSavedUrl(blobUrl);
      })
      .catch(() => setSavedUrl(null));
  }, [existingSignatureUrl]);

  useEffect(() => () => {
    if (savedBlob.current) URL.revokeObjectURL(savedBlob.current);
  }, []);

  function handleClear() {
    sigCanvasRef.current?.clear();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
      toast.error('Please select a JPEG or PNG image.');
      return;
    }
    setUploadFile(file);
    setUploadPreview(URL.createObjectURL(file));
  }

  // ── Camera capture → reuse the upload save path ────────────────────────────────
  function handleCameraCapture(blob, dataUrl) {
    setUploadFile(blob);
    setUploadPreview(dataUrl);
    setTab('upload');
  }

  async function handleSave() {
    setSaving(true);
    try {
      let result;

      if (tab === 'draw') {
        const canvas = sigCanvasRef.current;
        if (!canvas || canvas.isEmpty()) {
          toast.error('Please draw your signature first.');
          setSaving(false);
          return;
        }
        const dataUrl = canvas.toDataURL('image/png');
        result = await applicantService.uploadSignatureBase64(applicantId, dataUrl);
      } else {
        if (!uploadFile) {
          toast.error('Please select an image file.');
          setSaving(false);
          return;
        }
        result = await applicantService.uploadSignatureFile(applicantId, uploadFile);
      }

      // Fetch the saved signature via authenticated API to get a displayable blob URL
      const apiUrl = result.signatureUrl || applicantService.getFileUrl(result.signaturePath);
      try {
        const blobUrl = await applicantService.fetchFileBlob(apiUrl);
        if (savedBlob.current) URL.revokeObjectURL(savedBlob.current);
        savedBlob.current = blobUrl;
        setSavedUrl(blobUrl);
      } catch {
        setSavedUrl(null);
      }
      setIsSaved(true);
      toast.success('Signature saved.');
      onComplete?.(result);
    } catch (err) {
      toast.error(err?.response?.data?.error?.message ?? 'Failed to save signature. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function handleReplace() {
    setIsSaved(false);
    setSavedUrl(null);
    setUploadFile(null);
    setUploadPreview(null);
    if (sigCanvasRef.current) sigCanvasRef.current.clear();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Saved state ──────────────────────────────────────────────────────────────
  if (isSaved) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider">Signature</p>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-center justify-center min-h-[80px]">
          {savedUrl ? (
            <img src={savedUrl} alt="Signature" className="max-h-16 max-w-full object-contain" />
          ) : (
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span className="text-sm text-green-700 font-medium flex-1">Signature saved</span>
          <button
            onClick={handleReplace}
            className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text-1)] px-2 py-1 rounded transition-colors"
          >
            Replace
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider">Signature</p>

      {/* ── Tabs ──────────────────────────────────────────────────────── */}
      <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden">
        {[
          { key: 'draw',   icon: PenLine,     label: 'Draw' },
          { key: 'camera', icon: Camera,      label: 'Camera' },
          { key: 'upload', icon: UploadCloud, label: 'Upload' },
        ].map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-colors',
              tab === key
                ? 'text-white'
                : 'text-[var(--color-text-2)] hover:bg-[var(--color-surface)]',
            )}
            style={tab === key ? { backgroundColor: accentColor } : {}}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Draw tab ──────────────────────────────────────────────────── */}
      {tab === 'draw' && (
        <div className="space-y-2">
          <div className="rounded-xl border-2 border-[var(--color-border)] overflow-hidden bg-white">
            <SignatureCanvas
              ref={sigCanvasRef}
              penColor="#1A1F2E"
              canvasProps={{
                width: 480,
                height: 120,
                className: 'w-full h-full',
                style: { display: 'block', touchAction: 'none' },
              }}
            />
          </div>
          <p className="text-xs text-[var(--color-muted)] text-center">Sign inside the box above using mouse or touch</p>
          <div className="flex gap-2">
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--color-text-2)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-opacity disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : 'Save Signature'}
            </button>
          </div>
        </div>
      )}

      {/* ── Camera tab ──────────────────────────────────────────────────── */}
      {tab === 'camera' && (
        <div className="space-y-2">
          <CameraCapture
            accentColor={accentColor}
            onCapture={handleCameraCapture}
          />
          <p className="text-xs text-[var(--color-muted)] text-center">
            Point the webcam at the signed paper, then capture.
          </p>
        </div>
      )}

      {/* ── Upload tab ──────────────────────────────────────────────────── */}
      {tab === 'upload' && (
        <div className="space-y-2">
          {uploadPreview ? (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-center justify-center min-h-[80px]">
              <img src={uploadPreview} alt="Signature preview" className="max-h-16 max-w-full object-contain" />
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="rounded-xl border-2 border-dashed border-[var(--color-border)] p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-[var(--color-surface)] transition-colors"
            >
              <UploadCloud className="w-6 h-6 text-[var(--color-muted)]" />
              <p className="text-sm text-[var(--color-text-2)]">Click to upload signature image</p>
              <p className="text-xs text-[var(--color-muted)]">JPEG or PNG</p>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/jpg"
            className="hidden"
            onChange={handleFileChange}
          />
          <div className="flex gap-2">
            {uploadPreview && (
              <button
                onClick={() => { setUploadFile(null); setUploadPreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--color-text-2)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
            <button
              onClick={uploadPreview ? handleSave : () => fileInputRef.current?.click()}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-opacity disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {saving ? <><RefreshCw className="w-4 h-4 animate-spin" /> Saving…</> : uploadPreview ? 'Save Signature' : 'Choose File'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
