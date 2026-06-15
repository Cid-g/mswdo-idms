import { useState, useRef, useCallback, useEffect } from 'react';
import ReactCrop, { makeAspectCrop, centerCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { UploadCloud, RotateCcw, Wand2, CheckCircle2, RefreshCw, Camera } from 'lucide-react';
import { cn } from '../lib/utils';
import { applicantService } from '../services/applicantService';
import CameraCapture from './CameraCapture';
import { toast } from 'sonner';

// 3:4 portrait aspect — standard ID photo
const ASPECT = 3 / 4;

function initialCrop(width, height) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 80 }, ASPECT, width, height),
    width, height
  );
}

// Draw the cropped region to an off-screen canvas and return a Blob
function getCroppedBlob(imgEl, crop) {
  return new Promise((resolve, reject) => {
    if (!crop?.width || !crop?.height) return reject(new Error('No crop'));

    const scaleX = imgEl.naturalWidth  / imgEl.width;
    const scaleY = imgEl.naturalHeight / imgEl.height;

    const canvas = document.createElement('canvas');
    const ctx    = canvas.getContext('2d');

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width  = crop.width  * scaleX * pixelRatio;
    canvas.height = crop.height * scaleY * pixelRatio;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      imgEl,
      crop.x * scaleX, crop.y * scaleY,
      crop.width * scaleX, crop.height * scaleY,
      0, 0,
      crop.width * scaleX, crop.height * scaleY,
    );

    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Canvas empty')), 'image/png', 1);
  });
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function PhotoEditor({ applicantId, existingPhotoUrl, onComplete, accentColor = '#334155' }) {
  const [stage, setStage]         = useState(existingPhotoUrl ? 'done' : 'idle');
  const [rawSrc, setRawSrc]       = useState(null);
  const [crop, setCrop]           = useState(null);
  const [completedCrop, setCompletedCrop] = useState(null);
  // Start null when existingPhotoUrl is an API path — useEffect will fetch as blob
  const [resultUrl, setResultUrl] = useState(
    existingPhotoUrl?.startsWith('blob:') ? existingPhotoUrl : null
  );
  const [processing, setProcessing] = useState(false);
  const imgRef      = useRef(null);
  const inputRef    = useRef(null);
  const resultBlob  = useRef(null); // tracks blob URL for cleanup

  // Load existingPhotoUrl as an authenticated blob URL
  useEffect(() => {
    if (!existingPhotoUrl || existingPhotoUrl.startsWith('blob:')) return;
    applicantService.fetchFileBlob(existingPhotoUrl)
      .then((blobUrl) => {
        if (resultBlob.current) URL.revokeObjectURL(resultBlob.current);
        resultBlob.current = blobUrl;
        setResultUrl(blobUrl);
      })
      .catch(() => setResultUrl(null));
  }, [existingPhotoUrl]);

  useEffect(() => () => {
    if (resultBlob.current) URL.revokeObjectURL(resultBlob.current);
  }, []);

  // ── File chosen ──────────────────────────────────────────────────────────────
  function handleFile(file) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/jpg', 'image/webp'].includes(file.type)) {
      toast.error('Please select a JPEG or PNG image.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    setRawSrc(url);
    setCrop(null);
    setCompletedCrop(null);
    setStage('crop');
  }

  function handleDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  }

  // ── Camera capture → feed into the crop pipeline ───────────────────────────────
  function handleCameraCapture(blob) {
    const url = URL.createObjectURL(blob);
    setRawSrc(url);
    setCrop(null);
    setCompletedCrop(null);
    setStage('crop');
  }

  function onImgLoad(e) {
    const { width, height } = e.currentTarget;
    setCrop(initialCrop(width, height));
  }

  // ── Upload & process ──────────────────────────────────────────────────────────
  const handleProcess = useCallback(async () => {
    if (!imgRef.current || !completedCrop) {
      toast.error('Please adjust the crop area first.');
      return;
    }
    setProcessing(true);
    try {
      const blob   = await getCroppedBlob(imgRef.current, completedCrop);
      const result = await applicantService.uploadPhoto(applicantId, blob);

      // Fetch the server-processed image (background removed) via authenticated API
      const apiUrl = result.photoUrl || applicantService.getFileUrl(result.photoPath);
      try {
        const blobUrl = await applicantService.fetchFileBlob(apiUrl);
        if (resultBlob.current) URL.revokeObjectURL(resultBlob.current);
        resultBlob.current = blobUrl;
        setResultUrl(blobUrl);
      } catch {
        setResultUrl(null); // upload succeeded — green check shows even without preview
      }

      setStage('done');
      toast.success('Photo processed and saved.');
      onComplete?.(result);
    } catch (err) {
      toast.error(err?.response?.data?.error?.message ?? 'Failed to process photo. Please try again.');
    } finally {
      setProcessing(false);
    }
  }, [applicantId, completedCrop, onComplete]);

  // ── Reset ─────────────────────────────────────────────────────────────────────
  function handleReset() {
    setStage('idle');
    setRawSrc(null);
    setCrop(null);
    setCompletedCrop(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider">Photo</p>

      {/* IDLE — drop zone */}
      {stage === 'idle' && (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={cn(
            'border-2 border-dashed border-[var(--color-border)] rounded-xl p-8',
            'flex flex-col items-center justify-center gap-3 cursor-pointer',
            'hover:border-[var(--color-muted)] hover:bg-[var(--color-surface)] transition-colors',
          )}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ backgroundColor: `${accentColor}15` }}
          >
            <UploadCloud className="w-6 h-6" style={{ color: accentColor }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--color-text-1)]">Click or drag a photo here</p>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">JPEG or PNG · max 5 MB</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/jpg,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      )}

      {/* IDLE — camera shortcut */}
      {stage === 'idle' && (
        <button
          type="button"
          onClick={() => setStage('camera')}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-[var(--color-text-2)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors"
        >
          <Camera className="w-4 h-4" style={{ color: accentColor }} />
          Use Camera
        </button>
      )}

      {/* CAMERA — webcam capture */}
      {stage === 'camera' && (
        <CameraCapture
          accentColor={accentColor}
          aspect={ASPECT}
          onCapture={handleCameraCapture}
          onCancel={handleReset}
        />
      )}

      {/* CROP — crop tool */}
      {stage === 'crop' && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]">
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={ASPECT}
              minWidth={60}
              keepSelection
            >
              <img
                ref={imgRef}
                src={rawSrc}
                alt="Preview"
                onLoad={onImgLoad}
                className="max-h-72 w-full object-contain"
                style={{ display: 'block' }}
              />
            </ReactCrop>
          </div>
          <p className="text-xs text-[var(--color-muted)] text-center">
            Drag the crop box to frame the face · 3:4 portrait ratio locked
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--color-text-2)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Choose Different
            </button>
            <button
              onClick={handleProcess}
              disabled={!completedCrop || processing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-opacity disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {processing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Removing Background…
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  Remove Background &amp; Save
                </>
              )}
            </button>
          </div>
          {processing && (
            <p className="text-xs text-[var(--color-muted)] text-center animate-pulse">
              Processing may take 10–30 seconds on first run while the AI model loads…
            </p>
          )}
        </div>
      )}

      {/* DONE — show result */}
      {stage === 'done' && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)] flex items-center justify-center p-2">
            {resultUrl ? (
              <img
                src={resultUrl}
                alt="Processed photo"
                className="max-h-48 max-w-full object-contain rounded-lg"
                style={{ background: 'repeating-conic-gradient(#e5e7eb 0% 25%, white 0% 50%) 0 0 / 16px 16px' }}
              />
            ) : (
              <div className="w-28 h-36 rounded-lg bg-[var(--color-surface-2)] flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
            <span className="text-sm text-green-700 font-medium flex-1">Photo saved successfully</span>
            <button
              onClick={handleReset}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text-1)] px-2 py-1 rounded transition-colors"
            >
              Replace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
