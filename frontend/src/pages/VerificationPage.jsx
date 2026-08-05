import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  ShieldCheck, ShieldX,
  CheckCircle2, XCircle, Clock, Loader2,
  AlertCircle,
} from 'lucide-react';

const DEPT_COLOR = {
  PWD:            { accent: '#1E40AF', light: '#EFF6FF', label: 'Persons with Disability' },
  SOLO_PARENT:    { accent: '#9F1239', light: '#FFF1F2', label: 'Solo Parent' },
  SENIOR_CITIZEN: { accent: '#92400E', light: '#FFFBEB', label: 'Senior Citizen' },
};

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function VerificationPage() {
  const [params]  = useSearchParams();
  const token     = params.get('token');
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error,   setError]   = useState('');

  useEffect(() => {
    if (!token) return undefined;

    let active = true;
    axios.get(`/api/verify/${token}`)
      .then((res) => { if (active) setResult(res.data); })
      .catch((err) => {
        if (!active) return;
        const msg = err.response?.data?.message || err.response?.data?.error?.message;
        setError(msg || 'This QR code could not be verified.');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [token]);

  const displayError = token ? error : 'No verification token found in this URL.';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F7F8FA' }}>
      {/* Header */}
      <header className="w-full py-4 px-6 flex items-center gap-3 bg-white border-b" style={{ borderColor: '#DDE1EA' }}>
        <img src="/GERONA-LOGO-small-scaled.png" alt="Gerona Seal" className="w-8 h-8 object-contain" />
        <div>
          <p className="text-sm font-bold leading-tight" style={{ color: '#1A1F2E' }}>MSWDO — Gerona, Tarlac</p>
          <p className="text-xs" style={{ color: '#8B92A5' }}>Municipal Social Welfare and Development Office</p>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">

          <h1 className="text-center font-serif text-2xl mb-1" style={{ color: '#1A1F2E' }}>
            ID Verification
          </h1>
          <p className="text-center text-sm mb-8" style={{ color: '#8B92A5' }}>
            Official QR-based verification powered by Hyperledger Fabric
          </p>

          {loading && <LoadingCard />}
          {!loading && displayError && <ErrorCard message={displayError} />}
          {!loading && !displayError && result && <ResultCard result={result} />}
        </div>
      </main>

      <footer className="py-4 text-center text-xs" style={{ color: '#8B92A5' }}>
        Municipal Government of Gerona, Tarlac · MSWDO ID Management System
      </footer>
    </div>
  );
}

// ── Loading ───────────────────────────────────────────────────────────────────
function LoadingCard() {
  return (
    <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-3 text-center"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06)' }}>
      <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#1E40AF' }} />
      <p className="text-sm font-medium" style={{ color: '#4B5468' }}>Verifying ID record…</p>
    </div>
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────
function ErrorCard({ message }) {
  return (
    <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-4 text-center"
      style={{ boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06)' }}>
      <div className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{ background: '#FEF2F2' }}>
        <AlertCircle className="w-8 h-8" style={{ color: '#DC2626' }} />
      </div>
      <div>
        <p className="font-semibold text-base" style={{ color: '#1A1F2E' }}>Verification Failed</p>
        <p className="text-sm mt-1" style={{ color: '#8B92A5' }}>{message}</p>
      </div>
      <p className="text-xs px-4 py-2 rounded-lg" style={{ background: '#FEF2F2', color: '#DC2626' }}>
        If you believe this is an error, please contact the MSWDO office.
      </p>
    </div>
  );
}

// ── Result ────────────────────────────────────────────────────────────────────
function ResultCard({ result }) {
  const dept    = DEPT_COLOR[result.idType] ?? { accent: '#4B5468', light: '#F7F8FA', label: result.idType };
  const isValid = result.status === 'ACTIVE';
  const isRevoked  = result.status === 'REVOKED';

  return (
    <div className="flex flex-col gap-4">

      {/* Status banner */}
      <div
        className="rounded-2xl p-6 flex flex-col items-center gap-3 text-center"
        style={{
          background: isValid ? '#F0FDF4' : isRevoked ? '#FEF2F2' : '#F9FAFB',
          border: `1.5px solid ${isValid ? '#BBF7D0' : isRevoked ? '#FECACA' : '#E5E7EB'}`,
        }}
      >
        <div className="w-16 h-16 rounded-full flex items-center justify-center"
          style={{ background: isValid ? '#DCFCE7' : isRevoked ? '#FEE2E2' : '#F3F4F6' }}>
          {isValid
            ? <CheckCircle2 className="w-9 h-9" style={{ color: '#16A34A' }} />
            : isRevoked
              ? <XCircle className="w-9 h-9" style={{ color: '#DC2626' }} />
              : <Clock className="w-9 h-9" style={{ color: '#6B7280' }} />}
        </div>
        <div>
          <p className="text-xl font-bold"
            style={{ color: isValid ? '#15803D' : isRevoked ? '#B91C1C' : '#4B5563' }}>
            {isValid ? 'VALID ID' : isRevoked ? 'REVOKED ID' : 'EXPIRED ID'}
          </p>
          <p className="text-sm mt-0.5"
            style={{ color: isValid ? '#166534' : isRevoked ? '#991B1B' : '#6B7280' }}>
            {isValid
              ? 'This ID is active and legitimate.'
              : isRevoked
                ? 'This ID has been officially revoked.'
                : 'This ID has expired.'}
          </p>
        </div>

        {/* Dept badge */}
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
          style={{ background: dept.light, color: dept.accent }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: dept.accent }} />
          {dept.label}
        </span>
      </div>

      {/* ID details */}
      <div className="bg-white rounded-2xl p-5"
        style={{ boxShadow: '0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.05)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#8B92A5' }}>
          ID Information
        </p>
        <dl className="space-y-2.5">
          <Row label="ID Number"    value={<span className="font-mono">{result.idNumber}</span>} />
          <Row label="Name"         value={result.maskedName} />
          <Row label="ID Type"      value={result.idTypeLabel} />
          <Row label="Date Issued"  value={fmtDate(result.issuedDate)} />
          <Row label="Expiry"       value={result.expiryDate ? fmtDate(result.expiryDate) : 'No Expiry'} />
          {result.releasedAt && <Row label="Released" value={fmtDate(result.releasedAt)} />}
          {isRevoked && result.revokedReason && (
            <Row label="Revocation Reason" value={
              <span style={{ color: '#DC2626' }}>{result.revokedReason}</span>
            } />
          )}
        </dl>
      </div>

      {/* Blockchain integrity */}
      <BlockchainBadge blockchain={result.blockchain} />

      {/* Verified at */}
      <p className="text-center text-xs" style={{ color: '#8B92A5' }}>
        Verified at {fmtDateTime(result.verifiedAt)}
      </p>
    </div>
  );
}

function BlockchainBadge({ blockchain }) {
  if (!blockchain) return null;

  if (!blockchain.anchored) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-2xl"
        style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}>
        <Clock className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#D97706' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#92400E' }}>Pending Blockchain Anchor</p>
          <p className="text-xs mt-0.5" style={{ color: '#92400E' }}>
            This record has not yet been anchored to the Hyperledger Fabric blockchain.
          </p>
        </div>
      </div>
    );
  }

  const hashMatch = blockchain.hashMatch;
  const isVerified = hashMatch === true;
  const isMismatch = hashMatch === false;

  return (
    <div
      className="flex items-start gap-3 p-4 rounded-2xl"
      style={{
        background: isMismatch ? '#FEF2F2' : '#F0FDF4',
        border: `1px solid ${isMismatch ? '#FECACA' : '#BBF7D0'}`,
      }}
    >
      {isMismatch
        ? <ShieldX  className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#DC2626' }} />
        : <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#16A34A' }} />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold"
          style={{ color: isMismatch ? '#B91C1C' : '#15803D' }}>
          {isMismatch
            ? 'Blockchain Integrity Warning'
            : isVerified
              ? 'Blockchain Integrity Verified'
              : 'Anchored on Blockchain'}
        </p>
        <p className="text-xs mt-0.5" style={{ color: isMismatch ? '#991B1B' : '#166534' }}>
          {isMismatch
            ? 'The current record does not match the blockchain hash. Data may have been altered.'
            : isVerified
              ? 'Record matches the on-chain hash. Data integrity confirmed.'
              : 'This record is anchored on the Hyperledger Fabric blockchain.'}
        </p>
        {blockchain.txId && (
          <p className="text-xs mt-1.5 font-mono truncate" style={{ color: '#6B7280' }}>
            TxID: {blockchain.txId}
          </p>
        )}
        {blockchain.blockNumber != null && (
          <p className="text-xs font-mono" style={{ color: '#6B7280' }}>
            Block #{blockchain.blockNumber} · {fmtDate(blockchain.anchoredAt)}
          </p>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-xs flex-shrink-0" style={{ color: '#8B92A5' }}>{label}</dt>
      <dd className="text-xs font-medium text-right" style={{ color: '#1A1F2E' }}>{value}</dd>
    </div>
  );
}
