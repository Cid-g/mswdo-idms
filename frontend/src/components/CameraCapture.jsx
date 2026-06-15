import { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, AlertCircle, RotateCcw, X } from 'lucide-react';
import { cn } from '../lib/utils';

// Reusable webcam capture. Requests the camera on mount, shows a live preview,
// and returns a PNG blob + data URL on capture. Lets the staff pick which webcam
// to use when more than one is connected (e.g. external webcam vs laptop cam).
//
// Requires a secure context — works on https and on http://localhost.
export default function CameraCapture({ onCapture, onCancel, accentColor = '#334155', aspect }) {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [devices, setDevices]   = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [error, setError]       = useState(null);
  const [ready, setReady]       = useState(false);

  const startStream = useCallback(async (id) => {
    setError(null);
    setReady(false);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id } } : { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setReady(true);

      // Device labels are only populated after permission is granted.
      const cams = (await navigator.mediaDevices.enumerateDevices())
        .filter((d) => d.kind === 'videoinput');
      setDevices(cams);
      if (!id) {
        const active = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
        if (active) setDeviceId(active);
      }
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow camera permission in your browser, then retry.'
          : err?.name === 'NotFoundError'
            ? 'No camera found. Connect a webcam and try again.'
            : 'Unable to access the camera.',
      );
    }
  }, []);

  useEffect(() => {
    // Synchronizing with the camera (an external system) is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startStream('');
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [startStream]);

  function handleDeviceChange(e) {
    const id = e.target.value;
    setDeviceId(id);
    startStream(id);
  }

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      onCapture?.(blob, canvas.toDataURL('image/png'));
    }, 'image/png', 1);
  }, [ready, onCapture]);

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 flex flex-col items-center gap-3 text-center">
        <AlertCircle className="w-8 h-8 text-[var(--color-danger,#dc2626)]" />
        <p className="text-sm text-[var(--color-text-2)]">{error}</p>
        <div className="flex gap-2">
          <button
            onClick={() => startStream(deviceId)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: accentColor }}
          >
            <RotateCcw className="w-4 h-4" />
            Retry
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--color-text-2)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Live preview ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden border border-[var(--color-border)] bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          className="w-full max-h-72 object-contain"
          style={{ display: 'block' }}
        />
        {aspect && (
          <div
            className="absolute inset-0 m-auto border-2 border-white/70 rounded-md pointer-events-none"
            style={{ aspectRatio: String(aspect), height: '90%' }}
          />
        )}
      </div>

      {devices.length > 1 && (
        <select
          value={deviceId}
          onChange={handleDeviceChange}
          className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-300"
        >
          {devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--color-text-2)] border border-[var(--color-border)] rounded-lg hover:bg-[var(--color-surface)] transition-colors"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
        )}
        <button
          onClick={handleCapture}
          disabled={!ready}
          className={cn(
            'flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-lg transition-opacity disabled:opacity-50',
          )}
          style={{ backgroundColor: accentColor }}
        >
          <Camera className="w-4 h-4" />
          Capture Photo
        </button>
      </div>
    </div>
  );
}
