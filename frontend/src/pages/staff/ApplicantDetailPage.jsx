import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, CheckCircle2, AlertCircle, Circle, Camera, CreditCard, Loader2 } from 'lucide-react';
import { cn, computeAge, toDateInput, getPrimaryId } from '../../lib/utils';
import {
  PWD_DISABILITY_TYPES, SOLO_PARENT_CATEGORIES, CIVIL_STATUS,
  EMPLOYMENT_STATUS, LIVING_STATUS, PENSION_TYPES, SC_REGISTRATION_CATEGORY,
} from '../../lib/constants';
import { applicantService } from '../../services/applicantService';
import api from '../../services/api';
import BarangayCombobox from '../../components/ui/BarangayCombobox';
import ChildrenForm from '../../components/ChildrenForm';
import PhotoEditor from '../../components/PhotoEditor';
import SignaturePad from '../../components/SignaturePad';

// ── Local constants not in constants.js ─────────────────────────────────────
const PWD_EDU = ['None','Kinder','Elem. Level','Elem. Grad','H.S. Level','H.S. Grad.','JR. H.S.','SR. H.S.','College Level','College Grad.','Vocational','Post Graduate','SPED'];
const PWD_REL_TO_HH = ['Household Head','Spouse','Son/Daughter','Brother/Sister','Son-in-Law/Daughter-in-Law','Grandson/Granddaughter','Father/Mother','Other Relative'];
const SP_EDU = ['No Education','Elementary Level','Elementary Graduate','High School Level','High School Graduate','Vocational / TVET','College Level','College Graduate'];
const SP_INCOME = ['No income','minimum wage and below','(minimum wage +1) to Php 20833','Php 20834 and above'];
const SC_MARITAL = ['Single','Married','Widowed','Separated','Divorced'];
const SC_TX_TYPE = ['New','Replace','Loss','Transfer'];
const DEPT_LABEL    = { PWD: 'Persons with Disability', SOLO_PARENT: 'Solo Parent', SENIOR_CITIZEN: 'Senior Citizen' };
const DEPT_ACCENT   = { PWD: '#1E40AF', SOLO_PARENT: '#9F1239', SENIOR_CITIZEN: '#92400E' };
const DEPT_GRADIENT = {
  PWD:            'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
  SOLO_PARENT:    'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
  SENIOR_CITIZEN: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
};

// ── Section definitions ──────────────────────────────────────────────────────
const SECTIONS = {
  PWD: [
    { id: 'personal',      title: 'Personal Information',   required: ['sex','civilStatus'],                                         allKeys: ['sex','civilStatus','contactNumber','religion','purokStreet'] },
    { id: 'disability',    title: 'Disability Information', required: ['pwd.disabilityType'],                                        allKeys: ['pwd.disabilityType','pwd.causeOfDisability'] },
    { id: 'education',     title: 'Education & Livelihood', required: [],                                                            allKeys: ['pwd.educationalAttainment','pwd.educationalStatus','pwd.occupation','pwd.monthlyIncome','pwd.availableSkill','pwd.skillsDesired','pwd.organization','pwd.hobbies','pwd.relationshipToHH'] },
    { id: 'emergency',     title: 'Emergency Contact',      required: ['emergencyContactName','emergencyContactNumber'],             allKeys: ['emergencyContactName','emergencyContactNumber','emergencyContactAddress','emergencyContactRelation'] },
    { id: 'caseManagement',title: 'Case Management',        required: [],                                                            allKeys: ['pwd.servicesAvailed','pwd.needsProblems','pwd.otherFamilyResources'] },
    { id: 'formTracking',  title: 'Form Tracking',          required: [],                                                            allKeys: ['pwd.uploadedToDOH','pwd.natFormSubmitted','pwd.locFormSubmitted'] },
    { id: 'photoSig',      title: 'Photo & Signature',      required: ['__photo__','__sig__'],                                      allKeys: ['__photo__','__sig__'] },
  ],
  SENIOR_CITIZEN: [
    { id: 'personal',  title: 'Personal Information', required: ['sex','seniorCitizen.maritalStatus'],                                    allKeys: ['sex','seniorCitizen.maritalStatus','contactNumber','seniorCitizen.livingStatus','seniorCitizen.occupation','seniorCitizen.income'] },
    { id: 'health',    title: 'Health Information',   required: [],                                                                         allKeys: ['seniorCitizen.medicalCondition','seniorCitizen.medicine','seniorCitizen.isDisabled'] },
    { id: 'idDetails', title: 'ID Details',           required: ['seniorCitizen.registrationCategory','seniorCitizen.idTransactionType'],   allKeys: ['seniorCitizen.registrationCategory','seniorCitizen.idTransactionType','seniorCitizen.rrn'] },
    { id: 'pension',   title: 'Pension',               required: [],                                                                         allKeys: ['seniorCitizen.isPensioner','seniorCitizen.pensionType','seniorCitizen.pensionAmount'] },
    { id: 'photoSig',  title: 'Photo & Signature',    required: ['__photo__','__sig__'],                                                    allKeys: ['__photo__','__sig__'] },
  ],
  SOLO_PARENT: [
    { id: 'personal',       title: 'Personal Information',   required: ['sex','civilStatus'],                                                           allKeys: ['sex','civilStatus','contactNumber','religion','purokStreet','soloParent.philsysCardNumber','soloParent.email'] },
    { id: 'employment',     title: 'Employment & Education', required: ['soloParent.employmentStatus'],                                                  allKeys: ['soloParent.educationalAttainment','soloParent.employmentStatus','soloParent.occupation','soloParent.monthlyIncome'] },
    { id: 'classification', title: 'Classification',         required: ['soloParent.categoryCode'],                                                      allKeys: ['soloParent.categoryCode','soloParent.benefitCode','soloParent.spicStatus','soloParent.dateSpicIssued','soloParent.pantawidBeneficiary','soloParent.indigenousPerson','soloParent.lgbtq','soloParent.isPWD','soloParent.isSeniorCitizen'] },
    { id: 'children',       title: 'Children',               required: ['soloParent.children'],                                                          allKeys: ['soloParent.children','soloParent.numChildren0to6','soloParent.numChildren7to22','soloParent.numChildrenWSN'] },
    { id: 'emergency',      title: 'Emergency Contact',      required: ['emergencyContactName','emergencyContactNumber','emergencyContactAddress'],       allKeys: ['emergencyContactName','emergencyContactNumber','emergencyContactAddress','emergencyContactRelation'] },
    { id: 'photoSig',       title: 'Photo & Signature',      required: ['__photo__','__sig__'],                                                          allKeys: ['__photo__','__sig__'] },
  ],
};

const REQUIRED_FLAT = {
  PWD:            ['sex','civilStatus','pwd.disabilityType','emergencyContactName','emergencyContactNumber'],
  SENIOR_CITIZEN: ['sex','seniorCitizen.maritalStatus','seniorCitizen.registrationCategory','seniorCitizen.idTransactionType'],
  SOLO_PARENT:    ['sex','civilStatus','soloParent.categoryCode','soloParent.employmentStatus','soloParent.children','emergencyContactName','emergencyContactNumber','emergencyContactAddress'],
};

// ── Styles ───────────────────────────────────────────────────────────────────
const inputCls = 'w-full border border-border rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-muted/60';
const selectCls = cn(inputCls, 'cursor-pointer');
const textareaCls = cn(inputCls, 'resize-none');

// ── Field label wrapper (no closure needed) ──────────────────────────────────
function FL({ label, req, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-2 mb-1">
        {label}{req && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isFilled(form, key) {
  const v = form[key];
  if (Array.isArray(v)) return v.length > 0;
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return true;
  return v !== '';
}

function toForm(a) {
  return {
    lastName: a.lastName ?? '', firstName: a.firstName ?? '',
    middleName: a.middleName ?? '', extensionName: a.extensionName ?? '',
    birthdate: toDateInput(a.birthdate), sex: a.sex ?? '',
    civilStatus: a.civilStatus ?? '', contactNumber: a.contactNumber ?? '',
    religion: a.religion ?? '', purokStreet: a.purokStreet ?? '',
    barangay: a.barangay ?? '', birthplace: a.birthplace ?? '',
    emergencyContactName: a.emergencyContactName ?? '',
    emergencyContactNumber: a.emergencyContactNumber ?? '',
    emergencyContactAddress: a.emergencyContactAddress ?? '',
    emergencyContactRelation: a.emergencyContactRelation ?? '',
    'pwd.disabilityType':      a.pwd?.disabilityType ?? '',
    'pwd.causeOfDisability':   a.pwd?.causeOfDisability ?? '',
    'pwd.educationalAttainment': a.pwd?.educationalAttainment ?? '',
    'pwd.educationalStatus':   a.pwd?.educationalStatus ?? '',
    'pwd.occupation':          a.pwd?.occupation ?? '',
    'pwd.monthlyIncome':       a.pwd?.monthlyIncome ?? '',
    'pwd.availableSkill':      a.pwd?.availableSkill ?? '',
    'pwd.skillsDesired':       a.pwd?.skillsDesired ?? '',
    'pwd.organization':        a.pwd?.organization ?? '',
    'pwd.hobbies':             a.pwd?.hobbies ?? '',
    'pwd.relationshipToHH':    a.pwd?.relationshipToHH ?? '',
    'pwd.uploadedToDOH':       a.pwd?.uploadedToDOH ?? false,
    'pwd.natFormSubmitted':    a.pwd?.natFormSubmitted ?? false,
    'pwd.locFormSubmitted':    a.pwd?.locFormSubmitted ?? false,
    'pwd.servicesAvailed':     a.pwd?.servicesAvailed ?? '',
    'pwd.needsProblems':       a.pwd?.needsProblems ?? '',
    'pwd.otherFamilyResources': a.pwd?.otherFamilyResources ?? '',
    'soloParent.categoryCode':  a.soloParent?.categoryCode  ?? '',
    'soloParent.benefitCode':   a.soloParent?.benefitCode   ?? '',
    'soloParent.spicStatus':    a.soloParent?.spicStatus    ?? '',
    'soloParent.dateSpicIssued': toDateInput(a.soloParent?.dateSpicIssued),
    'soloParent.philsysCardNumber': a.soloParent?.philsysCardNumber ?? '',
    'soloParent.email':        a.soloParent?.email ?? '',
    'soloParent.educationalAttainment': a.soloParent?.educationalAttainment ?? '',
    'soloParent.employmentStatus': a.soloParent?.employmentStatus ?? '',
    'soloParent.occupation':   a.soloParent?.occupation ?? '',
    'soloParent.monthlyIncome': a.soloParent?.monthlyIncome ?? '',
    'soloParent.numChildren0to6': a.soloParent?.numChildren0to6 ?? '',
    'soloParent.numChildren7to22': a.soloParent?.numChildren7to22 ?? '',
    'soloParent.numChildrenWSN': a.soloParent?.numChildrenWSN ?? '',
    'soloParent.children':     a.soloParent?.children ?? [],
    'soloParent.pantawidBeneficiary': a.soloParent?.pantawidBeneficiary ?? null,
    'soloParent.indigenousPerson': a.soloParent?.indigenousPerson ?? '',
    'soloParent.lgbtq':        a.soloParent?.lgbtq ?? null,
    'soloParent.isPWD':        a.soloParent?.isPWD ?? null,
    'soloParent.isSeniorCitizen': a.soloParent?.isSeniorCitizen ?? null,
    'soloParent.modeOfAdmission':     a.soloParent?.modeOfAdmission     ?? '',
    'soloParent.comBasedAssistance':  a.soloParent?.comBasedAssistance  ?? '',
    'soloParent.aicsReferral':        a.soloParent?.aicsReferral        ?? '',
    'soloParent.psychosocialServices': a.soloParent?.psychosocialServices ?? '',
    'soloParent.referralToAgencies':  a.soloParent?.referralToAgencies  ?? '',
    'soloParent.remarks':             a.soloParent?.remarks             ?? '',
    'seniorCitizen.maritalStatus':       a.seniorCitizen?.maritalStatus ?? '',
    'seniorCitizen.registrationCategory': a.seniorCitizen?.registrationCategory ?? '',
    'seniorCitizen.idTransactionType':   a.seniorCitizen?.idTransactionType ?? '',
    'seniorCitizen.livingStatus':        a.seniorCitizen?.livingStatus ?? '',
    'seniorCitizen.occupation':          a.seniorCitizen?.occupation ?? '',
    'seniorCitizen.income':              a.seniorCitizen?.income ?? '',
    'seniorCitizen.medicalCondition':    a.seniorCitizen?.medicalCondition ?? '',
    'seniorCitizen.medicine':            a.seniorCitizen?.medicine ?? '',
    'seniorCitizen.isDisabled':          a.seniorCitizen?.isDisabled ?? null,
    'seniorCitizen.rrn':                 a.seniorCitizen?.rrn ?? '',
    'seniorCitizen.isPensioner':         a.seniorCitizen?.isPensioner ?? null,
    'seniorCitizen.pensionType':         a.seniorCitizen?.pensionType ?? '',
    'seniorCitizen.pensionAmount':       a.seniorCitizen?.pensionAmount ?? '',
  };
}

function computeProgress(form, dept, photoPath, sigPath) {
  const sections = SECTIONS[dept] ?? [];
  const req = new Set();
  sections.forEach((s) => s.required.forEach((k) => req.add(k)));
  const total = req.size;
  if (!total) return { percent: 100, remaining: 0 };
  let filled = 0;
  req.forEach((k) => {
    if (k === '__photo__') { if (photoPath) filled++; }
    else if (k === '__sig__') { if (sigPath) filled++; }
    else if (isFilled(form, k)) filled++;
  });
  return { percent: Math.round((filled / total) * 100), remaining: total - filled };
}

function getSectionMissingCount(sectionDef, form, photoPath, sigPath) {
  if (!sectionDef) return 0;
  const { required = [] } = sectionDef;
  return required.filter((k) => {
    if (k === '__photo__') return !photoPath;
    if (k === '__sig__') return !sigPath;
    return !isFilled(form, k);
  }).length;
}

function getSectionStatus(sectionDef, form, photoPath, sigPath) {
  if (!sectionDef) return 'not_started';
  const { required = [], allKeys = [] } = sectionDef;
  const filled = (k) => k === '__photo__' ? !!photoPath : k === '__sig__' ? !!sigPath : isFilled(form, k);
  const uniq = [...new Set([...required, ...allKeys])];
  const anyFilled = uniq.some(filled);
  if (!required.length) return anyFilled ? 'partial' : 'not_started';
  if (required.every(filled)) return 'complete';
  return anyFilled ? 'partial' : 'not_started';
}

const BASE_KEYS = [
  'lastName','firstName','middleName','extensionName','birthdate','sex','civilStatus',
  'contactNumber','religion','purokStreet','barangay','birthplace',
  'emergencyContactName','emergencyContactNumber','emergencyContactAddress','emergencyContactRelation',
];

// ── AccordionSection ──────────────────────────────────────────────────────────
function AccordionSection({ id, title, status, missingCount = 0, isOpen, onToggle, saving, saved, onSave, children }) {
  const icon =
    status === 'complete' ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" /> :
    status === 'partial'  ? <AlertCircle  className="w-4 h-4 text-amber-500 flex-shrink-0" /> :
                            <Circle       className="w-4 h-4 text-border flex-shrink-0" />;
  const badge =
    status === 'complete' ? 'bg-green-50 text-green-700 border-green-200' :
    status === 'partial'  ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-surface text-muted border-border';
  const badgeLabel =
    status === 'complete' ? 'Complete' :
    status === 'partial' && missingCount > 0 ? `${missingCount} missing` :
    status === 'partial' ? 'In Progress' :
    'Not started';
  return (
    <div className="bg-white border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-surface/60 transition-colors"
      >
        {icon}
        <span className="flex-1 text-sm font-medium text-text-1">{title}</span>
        {saving && <span className="text-xs text-muted animate-pulse">Saving…</span>}
        {saved && !saving && <span className="text-xs text-green-600">Saved ✓</span>}
        <span className={cn('text-xs px-2 py-0.5 rounded-full border', badge)}>{badgeLabel}</span>
        <ChevronDown className={cn('w-4 h-4 text-muted flex-shrink-0 transition-transform duration-200', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-border">
          <div className="space-y-3">{children}</div>
          <div className="flex items-center justify-end gap-2.5 mt-5 pt-4 border-t border-border/50">
            {saved && !saving && (
              <span className="flex items-center gap-1 text-xs text-green-600 mr-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="flex items-center gap-1.5 h-8 px-4 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: saving ? 'var(--color-surface)' : '#1E293B',
                color: saving ? 'var(--color-muted)' : 'white',
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              {saving
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
                : 'Save section'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ApplicantDetailPage() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm]                     = useState(null);
  const [openSections, setOpenSections]     = useState(null);
  const [savingSection, setSavingSection]   = useState(null);
  const [savedSection, setSavedSection]     = useState(null);
  const [saveError, setSaveError]           = useState('');
  const [toast, setToast]                   = useState(null);
  const [headerPhotoUrl, setHeaderPhotoUrl] = useState(null);
  const [isDirty, setIsDirty]               = useState(false);
  const isDirtyRef   = useRef(false);
  const previousStatusRef = useRef(null);

  const { data: applicant, isLoading, error } = useQuery({
    queryKey: ['applicant', id],
    queryFn: () => applicantService.getApplicantById(id),
  });

  // Check whether an ID card has been generated (null = none, object = exists)
  const { data: idRecord } = useQuery({
    queryKey: ['id-record-check', id],
    queryFn: async () => {
      try {
        const { data } = await api.get('/id-records', { params: { applicantId: id } });
        return data;
      } catch (e) {
        if (e.response?.status === 404) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (applicant && form === null) {
      const f = toForm(applicant);
      setForm(f);
      const secs = SECTIONS[applicant.department] ?? [];
      const pp = applicant.photoPath, sp = applicant.signaturePath;
      const first = secs.find((s) => getSectionStatus(s, f, pp, sp) !== 'complete');
      setOpenSections(new Set(first ? [first.id] : []));
    }
  }, [applicant]);

  useEffect(() => {
    if (!applicant) return;
    if (previousStatusRef.current === 'PARTIAL' && applicant.status === 'COMPLETE') {
      showToast('Profile complete. Blockchain sync queued.', 'success');
    }
    previousStatusRef.current = applicant.status;
  }, [applicant?.status]);

  // Fetch header thumbnail as authenticated blob URL to avoid 401 on plain <img src>
  useEffect(() => {
    if (!applicant?.photoPath) { setHeaderPhotoUrl(null); return; }
    const apiUrl = applicantService.getFileUrl(applicant.photoPath);
    let active = true;
    applicantService.fetchFileBlob(apiUrl)
      .then((blobUrl) => { if (active) setHeaderPhotoUrl(blobUrl); })
      .catch(() => { if (active) setHeaderPhotoUrl(null); });
    return () => { active = false; };
  }, [applicant?.photoPath]);

  // Warn on browser close/refresh when there are unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (formData) => {
      const basePayload = Object.fromEntries(BASE_KEYS.map((k) => [k, formData[k]]));
      const calls = [applicantService.updateApplicant(id, basePayload)];
      const dept = applicant.department;
      if (dept === 'PWD') {
        calls.push(applicantService.updatePwdDetails(id,
          Object.fromEntries(Object.entries(formData).filter(([k]) => k.startsWith('pwd.')).map(([k,v]) => [k.slice(4), v]))));
      } else if (dept === 'SOLO_PARENT') {
        calls.push(applicantService.updateSoloParentDetails(id,
          Object.fromEntries(Object.entries(formData).filter(([k]) => k.startsWith('soloParent.')).map(([k,v]) => [k.slice(11), v]))));
      } else if (dept === 'SENIOR_CITIZEN') {
        calls.push(applicantService.updateSeniorCitizenDetails(id,
          Object.fromEntries(Object.entries(formData).filter(([k]) => k.startsWith('seniorCitizen.')).map(([k,v]) => [k.slice(14), v]))));
      }
      await Promise.all(calls);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicant', id] });
      setSaveError('');
    },
    onError: (err) => setSaveError(err?.response?.data?.message ?? 'Save failed. Please try again.'),
  });

  function showToast(message, type = 'info') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
    isDirtyRef.current = true;
  }

  function clearDirty() {
    setIsDirty(false);
    isDirtyRef.current = false;
  }

  async function handleSectionSave(sectionId) {
    setSavingSection(sectionId);
    try {
      await saveMutation.mutateAsync(form);
      clearDirty();
      setSavedSection(sectionId);
      setTimeout(() => setSavedSection((s) => (s === sectionId ? null : s)), 2500);
    } catch { /* handled in onError */ }
    finally { setSavingSection(null); }
  }

  async function saveAll() {
    if (!form) return;
    setSavingSection('__all__');
    try {
      await saveMutation.mutateAsync(form);
      clearDirty();
    } catch { /* handled in onError */ }
    finally { setSavingSection(null); }
  }

  function handleToggle(sectionId) {
    if (openSections?.has(sectionId)) handleSectionSave(sectionId);
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId); else next.add(sectionId);
      return next;
    });
  }

  function expandAllIncomplete() {
    if (!applicant || !form) return;
    const secs = SECTIONS[applicant.department] ?? [];
    const pp = applicant.photoPath, sp = applicant.signaturePath;
    setOpenSections(new Set(secs.filter((s) => getSectionStatus(s, form, pp, sp) !== 'complete').map((s) => s.id)));
  }

  // ── Loading / error ────────────────────────────────────────────────────────
  if (isLoading || !form || !openSections) {
    return (
      <div className="space-y-4">
        <div className="h-5 w-32 bg-gray-200 rounded animate-pulse" />
        <div className="h-40 bg-gray-200 rounded-2xl animate-pulse" />
        {[...Array(6)].map((_, i) => <div key={i} className="h-14 bg-gray-200 rounded-xl animate-pulse" />)}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-16">
        <p className="font-medium text-text-1">Could not load applicant.</p>
        <button onClick={() => navigate('/staff/applicants')} className="mt-2 text-sm text-muted hover:text-text-1 transition-colors">← Back to list</button>
      </div>
    );
  }

  const dept      = applicant.department;
  const accent    = DEPT_ACCENT[dept] ?? '#334155';
  const photoPath = applicant.photoPath;
  const sigPath   = applicant.signaturePath;
  const { label: idLabel, value: idValue } = getPrimaryId(applicant);
  const age       = applicant.birthdate ? computeAge(applicant.birthdate) : null;
  const initials  = `${applicant.firstName?.[0] ?? ''}${applicant.lastName?.[0] ?? ''}`.toUpperCase();
  const { percent, remaining } = computeProgress(form, dept, photoPath, sigPath);

  const sections   = SECTIONS[dept] ?? [];
  const secStatus  = (sid) => getSectionStatus(sections.find((s) => s.id === sid), form, photoPath, sigPath);
  const accProps   = (sid) => {
    const sectionDef = sections.find((s) => s.id === sid);
    return {
      id: sid,
      title: sectionDef?.title ?? sid,
      status: secStatus(sid),
      missingCount: getSectionMissingCount(sectionDef, form, photoPath, sigPath),
      isOpen: openSections.has(sid),
      onToggle: handleToggle,
      saving: savingSection === sid || savingSection === '__all__',
      saved: savedSection === sid,
      onSave: () => handleSectionSave(sid),
    };
  };

  const reqFlat = REQUIRED_FLAT[dept] ?? [];
  const miss    = (key) => reqFlat.includes(key) && !isFilled(form, key);
  const ic      = (key) => cn(inputCls,   miss(key) && 'border-amber-400 bg-amber-50/50');
  const sc      = (key) => cn(selectCls,  miss(key) && 'border-amber-400 bg-amber-50/50');
  const Warn    = ({ fkey }) => miss(fkey) ? <p className="mt-0.5 text-xs text-amber-600">Not yet filled</p> : null;

  function BoolSel({ fkey }) {
    const v = form[fkey];
    return (
      <select
        value={v === null || v === undefined ? '' : String(v)}
        onChange={(e) => setField(fkey, e.target.value === '' ? null : e.target.value === 'true')}
        className={selectCls}
      >
        <option value="">— Select —</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-up">
      {/* Toast */}
      {toast && (
        <div role="status" aria-live="polite" className={cn(
          'fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium max-w-sm',
          toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-slate-800 text-white',
        )}>
          {toast.message}
        </div>
      )}

      {/* ── Dept gradient banner with profile ── */}
      <div
        className="rounded-2xl overflow-hidden mb-4 relative"
        style={{ background: DEPT_GRADIENT[dept] ?? 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />

        <div className="relative z-10 px-8 py-6">
          {/* Top row: back + complete-profile action */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() => navigate('/staff/applicants')}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
              style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.2)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              All Applicants
            </button>
            <div className="flex items-center gap-2">
              {applicant.status === 'PARTIAL' && (
                <button
                  onClick={expandAllIncomplete}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                  Complete Profile
                </button>
              )}
              <button
                onClick={() => navigate(`/staff/applicants/${id}/id-card`)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
              >
                <CreditCard className="w-4 h-4" aria-hidden="true" />
                {idRecord === null ? 'Generate ID' : 'View ID Card'}
              </button>
            </div>
          </div>

          {/* Profile row */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0"
              style={{ border: '2px solid rgba(255,255,255,0.35)' }}
            >
              {headerPhotoUrl
                ? <img src={headerPhotoUrl} alt={`Photo of ${applicant.firstName}`} className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-white font-bold text-xl font-sans"
                       style={{ background: 'rgba(255,255,255,0.18)' }}>{initials}</div>
              }
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="font-serif text-2xl text-white leading-tight">
                {applicant.lastName}, {applicant.firstName}
                {applicant.middleName ? ` ${applicant.middleName[0]}.` : ''}
                {applicant.extensionName ? ` ${applicant.extensionName}` : ''}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                {applicant.status === 'PARTIAL' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: 'rgba(251,191,36,0.25)', color: '#FCD34D', border: '1px solid rgba(251,191,36,0.35)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" /> Partial
                  </span>
                )}
                {applicant.status === 'COMPLETE' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: 'rgba(134,239,172,0.2)', color: '#86EFAC', border: '1px solid rgba(134,239,172,0.3)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-300" /> Complete
                  </span>
                )}
                {applicant.status === 'REVOKED' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold"
                        style={{ background: 'rgba(252,165,165,0.2)', color: '#FCA5A5', border: '1px solid rgba(252,165,165,0.3)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-300" /> Revoked
                  </span>
                )}
                {idValue && idValue !== '—' && (
                  <span className="text-xs font-mono" style={{ color: 'rgba(255,255,255,0.6)' }}>{idLabel}: {idValue}</span>
                )}
                {age !== null && (
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>{age} yrs old</span>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5" style={{ color: 'rgba(255,255,255,0.65)' }}>
              <span>Profile completion: <strong className="text-white">{percent}%</strong></span>
              {remaining > 0
                ? <span style={{ color: '#FCD34D' }}>{remaining} required field{remaining !== 1 ? 's' : ''} remaining</span>
                : <span style={{ color: '#86EFAC' }}>All required fields filled</span>}
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${percent}%`, background: percent === 100 ? '#86EFAC' : 'rgba(255,255,255,0.85)' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="mb-3 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{saveError}
        </div>
      )}

      {/* ── Unsaved changes banner ───────────────────────────────────────── */}
      {isDirty && (
        <div
          className="mb-3 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl text-sm"
          style={{ background: '#FEF9C3', border: '1px solid #FDE047', color: '#713F12' }}
        >
          <span className="flex items-center gap-2 font-medium">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse flex-shrink-0" />
            You have unsaved changes — save before leaving this page.
          </span>
          <button
            onClick={saveAll}
            disabled={Boolean(savingSection)}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity"
            style={{ background: '#92400E', opacity: savingSection ? 0.6 : 1, cursor: savingSection ? 'not-allowed' : 'pointer' }}
          >
            {savingSection === '__all__'
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
              : 'Save all'}
          </button>
        </div>
      )}

      {/* ── Accordion sections ────────────────────────────────────────────── */}
      <div className="space-y-2">

        {/* ════════════ PWD SECTIONS ════════════ */}
        {dept === 'PWD' && (<>
          <AccordionSection {...accProps('personal')}>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Last Name" req><input value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} className={inputCls} /></FL>
              <FL label="First Name" req><input value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} className={inputCls} /></FL>
              <FL label="Middle Name"><input value={form.middleName} onChange={(e) => setField('middleName', e.target.value)} placeholder="Optional" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Suffix">
                <select value={form.extensionName} onChange={(e) => setField('extensionName', e.target.value)} className={selectCls}>
                  <option value="">— None —</option>
                  {['Jr.','Sr.','II','III'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
              <FL label="Sex" req>
                <select value={form.sex} onChange={(e) => setField('sex', e.target.value)} className={sc('sex')}>
                  <option value="">— Select —</option>
                  <option value="Male">Male</option><option value="Female">Female</option>
                </select>
                <Warn fkey="sex" />
              </FL>
              <FL label="Civil Status" req>
                <select value={form.civilStatus} onChange={(e) => setField('civilStatus', e.target.value)} className={sc('civilStatus')}>
                  <option value="">— Select —</option>
                  {CIVIL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Warn fkey="civilStatus" />
              </FL>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Date of Birth" req>
                <div className="flex items-center gap-2">
                  <input type="date" value={form.birthdate} onChange={(e) => setField('birthdate', e.target.value)} max={new Date().toISOString().split('T')[0]} className={cn(inputCls,'flex-1 min-w-0')} />
                  {form.birthdate && <span className="flex-shrink-0 text-xs text-muted bg-surface px-2 py-1 rounded-md">{computeAge(form.birthdate)} yrs</span>}
                </div>
              </FL>
              <FL label="Contact Number"><input value={form.contactNumber} onChange={(e) => setField('contactNumber', e.target.value)} placeholder="09XX-XXX-XXXX" className={inputCls} /></FL>
              <FL label="Religion"><input value={form.religion} onChange={(e) => setField('religion', e.target.value)} className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Barangay" req><BarangayCombobox value={form.barangay} onChange={(v) => setField('barangay', v)} /></FL>
              <FL label="Purok / Street"><input value={form.purokStreet} onChange={(e) => setField('purokStreet', e.target.value)} className={inputCls} /></FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('disability')}>
            <FL label="Type of Disability" req>
              <select value={form['pwd.disabilityType']} onChange={(e) => setField('pwd.disabilityType', e.target.value)} className={sc('pwd.disabilityType')}>
                <option value="">— Select —</option>
                {PWD_DISABILITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Warn fkey="pwd.disabilityType" />
            </FL>
            <FL label="Cause of Disability"><input value={form['pwd.causeOfDisability']} onChange={(e) => setField('pwd.causeOfDisability', e.target.value)} placeholder="e.g. Congenital, Acquired, Accident" className={inputCls} /></FL>
          </AccordionSection>

          <AccordionSection {...accProps('education')}>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Educational Attainment">
                <select value={form['pwd.educationalAttainment']} onChange={(e) => setField('pwd.educationalAttainment', e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {PWD_EDU.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
              <FL label="Educational Status"><input value={form['pwd.educationalStatus']} onChange={(e) => setField('pwd.educationalStatus', e.target.value)} placeholder="e.g. ISY, OSY, Student" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Occupation"><input value={form['pwd.occupation']} onChange={(e) => setField('pwd.occupation', e.target.value)} className={inputCls} /></FL>
              <FL label="Monthly Income"><input value={form['pwd.monthlyIncome']} onChange={(e) => setField('pwd.monthlyIncome', e.target.value)} placeholder="e.g. 5000" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Available Skill"><input value={form['pwd.availableSkill']} onChange={(e) => setField('pwd.availableSkill', e.target.value)} placeholder="e.g. Carpentry, Baking" className={inputCls} /></FL>
              <FL label="Skills / Training Desired"><input value={form['pwd.skillsDesired']} onChange={(e) => setField('pwd.skillsDesired', e.target.value)} placeholder="e.g. Baking seminar" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Organization / Federation"><input value={form['pwd.organization']} onChange={(e) => setField('pwd.organization', e.target.value)} className={inputCls} /></FL>
              <FL label="Hobbies"><input value={form['pwd.hobbies']} onChange={(e) => setField('pwd.hobbies', e.target.value)} placeholder="e.g. Gardening, Reading" className={inputCls} /></FL>
            </div>
            <FL label="Relationship to Household Head">
              <select value={form['pwd.relationshipToHH']} onChange={(e) => setField('pwd.relationshipToHH', e.target.value)} className={selectCls}>
                <option value="">— Select —</option>
                {PWD_REL_TO_HH.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FL>
          </AccordionSection>

          <AccordionSection {...accProps('emergency')}>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Contact Person" req>
                <input value={form.emergencyContactName} onChange={(e) => setField('emergencyContactName', e.target.value)} placeholder="Full name" className={ic('emergencyContactName')} />
                <Warn fkey="emergencyContactName" />
              </FL>
              <FL label="Contact Number" req>
                <input value={form.emergencyContactNumber} onChange={(e) => setField('emergencyContactNumber', e.target.value)} placeholder="09XXXXXXXXX" className={ic('emergencyContactNumber')} />
                <Warn fkey="emergencyContactNumber" />
              </FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Address"><input value={form.emergencyContactAddress} onChange={(e) => setField('emergencyContactAddress', e.target.value)} className={inputCls} /></FL>
              <FL label="Relationship"><input value={form.emergencyContactRelation} onChange={(e) => setField('emergencyContactRelation', e.target.value)} placeholder="e.g. Parent, Sibling" className={inputCls} /></FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('caseManagement')}>
            <FL label="Services Availed (Government — Local & National)">
              <textarea rows={3} value={form['pwd.servicesAvailed']} onChange={(e) => setField('pwd.servicesAvailed', e.target.value)} placeholder="e.g. 4Ps Beneficiary - 2022, PhilHealth - 2023" className={textareaCls} />
            </FL>
            <FL label="Needs / Problems Facing as PWD">
              <textarea rows={3} value={form['pwd.needsProblems']} onChange={(e) => setField('pwd.needsProblems', e.target.value)} placeholder="e.g. Needs wheelchair, Needs financial assistance" className={textareaCls} />
            </FL>
            <FL label="Other Family Resources">
              <textarea rows={2} value={form['pwd.otherFamilyResources']} onChange={(e) => setField('pwd.otherFamilyResources', e.target.value)} placeholder="e.g. Spouse working abroad, Sibling supports financially" className={textareaCls} />
            </FL>
          </AccordionSection>

          <AccordionSection {...accProps('formTracking')}>
            <div className="flex flex-col gap-3">
              {[
                { key: 'pwd.uploadedToDOH',    label: 'Uploaded to DOH System' },
                { key: 'pwd.natFormSubmitted',  label: 'NAT — National Form (Hardcopy) submitted' },
                { key: 'pwd.locFormSubmitted',  label: 'LOC — Local Form submitted' },
              ].map(({ key, label }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form[key] === true}
                    onChange={(e) => setField(key, e.target.checked)}
                    className="w-4 h-4 rounded border-border cursor-pointer accent-blue-600"
                  />
                  <span className="text-sm text-text-1">{label}</span>
                </label>
              ))}
            </div>
          </AccordionSection>
        </>)}

        {/* ════════════ SENIOR CITIZEN SECTIONS ════════════ */}
        {dept === 'SENIOR_CITIZEN' && (<>
          <AccordionSection {...accProps('personal')}>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Last Name" req><input value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} className={inputCls} /></FL>
              <FL label="First Name" req><input value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} className={inputCls} /></FL>
              <FL label="Middle Name"><input value={form.middleName} onChange={(e) => setField('middleName', e.target.value)} placeholder="Optional" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Suffix">
                <select value={form.extensionName} onChange={(e) => setField('extensionName', e.target.value)} className={selectCls}>
                  <option value="">— None —</option>
                  {['Jr.','Sr.','II','III'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
              <FL label="Sex" req>
                <select value={form.sex} onChange={(e) => setField('sex', e.target.value)} className={sc('sex')}>
                  <option value="">— Select —</option>
                  <option value="Male">Male</option><option value="Female">Female</option>
                </select>
                <Warn fkey="sex" />
              </FL>
              <FL label="Marital Status" req>
                <select value={form['seniorCitizen.maritalStatus']} onChange={(e) => setField('seniorCitizen.maritalStatus', e.target.value)} className={sc('seniorCitizen.maritalStatus')}>
                  <option value="">— Select —</option>
                  {SC_MARITAL.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Warn fkey="seniorCitizen.maritalStatus" />
              </FL>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Date of Birth" req>
                <div className="flex items-center gap-2">
                  <input type="date" value={form.birthdate} onChange={(e) => setField('birthdate', e.target.value)} max={new Date().toISOString().split('T')[0]} className={cn(inputCls,'flex-1 min-w-0')} />
                  {form.birthdate && <span className="flex-shrink-0 text-xs text-muted bg-surface px-2 py-1 rounded-md">{computeAge(form.birthdate)} yrs</span>}
                </div>
              </FL>
              <FL label="Contact Number"><input value={form.contactNumber} onChange={(e) => setField('contactNumber', e.target.value)} placeholder="09XX-XXX-XXXX" className={inputCls} /></FL>
              <FL label="Living Status">
                <select value={form['seniorCitizen.livingStatus']} onChange={(e) => setField('seniorCitizen.livingStatus', e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {LIVING_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
            </div>
            <FL label="Barangay" req><BarangayCombobox value={form.barangay} onChange={(v) => setField('barangay', v)} /></FL>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Occupation"><input value={form['seniorCitizen.occupation']} onChange={(e) => setField('seniorCitizen.occupation', e.target.value)} placeholder="e.g. Retired, Farmer, None" className={inputCls} /></FL>
              <FL label="Income"><input value={form['seniorCitizen.income']} onChange={(e) => setField('seniorCitizen.income', e.target.value)} placeholder="Monthly income" className={inputCls} /></FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('health')}>
            <FL label="Medical Condition">
              <textarea rows={3} value={form['seniorCitizen.medicalCondition']} onChange={(e) => setField('seniorCitizen.medicalCondition', e.target.value)} placeholder="e.g. Hypertension, Diabetes, Arthritis" className={textareaCls} />
            </FL>
            <FL label="Medicine / Maintenance">
              <input value={form['seniorCitizen.medicine']} onChange={(e) => setField('seniorCitizen.medicine', e.target.value)} placeholder="e.g. Amlodipine, Metformin" className={inputCls} />
            </FL>
            <FL label="Person with Disability (PWD)?"><BoolSel fkey="seniorCitizen.isDisabled" /></FL>
          </AccordionSection>

          <AccordionSection {...accProps('idDetails')}>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Registration Category" req>
                <select value={form['seniorCitizen.registrationCategory']} onChange={(e) => setField('seniorCitizen.registrationCategory', e.target.value)} className={sc('seniorCitizen.registrationCategory')}>
                  <option value="">— Select —</option>
                  {SC_REGISTRATION_CATEGORY.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Warn fkey="seniorCitizen.registrationCategory" />
              </FL>
              <FL label="ID Transaction Type" req>
                <select value={form['seniorCitizen.idTransactionType']} onChange={(e) => setField('seniorCitizen.idTransactionType', e.target.value)} className={sc('seniorCitizen.idTransactionType')}>
                  <option value="">— Select —</option>
                  {SC_TX_TYPE.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Warn fkey="seniorCitizen.idTransactionType" />
              </FL>
            </div>
            <FL label="RRN (Registry Reference Number)">
              <input value={form['seniorCitizen.rrn']} onChange={(e) => setField('seniorCitizen.rrn', e.target.value)} placeholder="03-6906-000-XXXXXXX" className={inputCls} />
            </FL>
          </AccordionSection>

          <AccordionSection {...accProps('pension')}>
            <FL label="Pensioner?"><BoolSel fkey="seniorCitizen.isPensioner" /></FL>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Pension Type">
                <select value={form['seniorCitizen.pensionType']} onChange={(e) => setField('seniorCitizen.pensionType', e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {PENSION_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
              <FL label="Pension Amount">
                <input type="number" value={form['seniorCitizen.pensionAmount']} onChange={(e) => setField('seniorCitizen.pensionAmount', e.target.value)} placeholder="Monthly amount" className={inputCls} />
              </FL>
            </div>
          </AccordionSection>
        </>)}

        {/* ════════════ SOLO PARENT SECTIONS ════════════ */}
        {dept === 'SOLO_PARENT' && (<>
          <AccordionSection {...accProps('personal')}>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Last Name" req><input value={form.lastName} onChange={(e) => setField('lastName', e.target.value)} className={inputCls} /></FL>
              <FL label="First Name" req><input value={form.firstName} onChange={(e) => setField('firstName', e.target.value)} className={inputCls} /></FL>
              <FL label="Middle Name"><input value={form.middleName} onChange={(e) => setField('middleName', e.target.value)} placeholder="Optional" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Suffix">
                <select value={form.extensionName} onChange={(e) => setField('extensionName', e.target.value)} className={selectCls}>
                  <option value="">— None —</option>
                  {['Jr.','Sr.','II','III'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
              <FL label="Sex" req>
                <select value={form.sex} onChange={(e) => setField('sex', e.target.value)} className={sc('sex')}>
                  <option value="">— Select —</option>
                  <option value="Male">Male</option><option value="Female">Female</option>
                </select>
                <Warn fkey="sex" />
              </FL>
              <FL label="Civil Status" req>
                <select value={form.civilStatus} onChange={(e) => setField('civilStatus', e.target.value)} className={sc('civilStatus')}>
                  <option value="">— Select —</option>
                  {CIVIL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Warn fkey="civilStatus" />
              </FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Date of Birth" req>
                <div className="flex items-center gap-2">
                  <input type="date" value={form.birthdate} onChange={(e) => setField('birthdate', e.target.value)} max={new Date().toISOString().split('T')[0]} className={cn(inputCls,'flex-1 min-w-0')} />
                  {form.birthdate && <span className="flex-shrink-0 text-xs text-muted bg-surface px-2 py-1 rounded-md">{computeAge(form.birthdate)} yrs</span>}
                </div>
              </FL>
              <FL label="Place of Birth" req><input value={form.birthplace} onChange={(e) => setField('birthplace', e.target.value)} placeholder="e.g. Gerona, Tarlac" className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Barangay" req><BarangayCombobox value={form.barangay} onChange={(v) => setField('barangay', v)} /></FL>
              <FL label="Purok / Street"><input value={form.purokStreet} onChange={(e) => setField('purokStreet', e.target.value)} className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Contact Number"><input value={form.contactNumber} onChange={(e) => setField('contactNumber', e.target.value)} placeholder="09XX-XXX-XXXX" className={inputCls} /></FL>
              <FL label="Religion"><input value={form.religion} onChange={(e) => setField('religion', e.target.value)} className={inputCls} /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="PhilSys Card Number"><input value={form['soloParent.philsysCardNumber']} onChange={(e) => setField('soloParent.philsysCardNumber', e.target.value)} placeholder="NNNN-NNNN-NNNN-NNNN" className={inputCls} /></FL>
              <FL label="Email Address"><input type="email" value={form['soloParent.email']} onChange={(e) => setField('soloParent.email', e.target.value)} className={inputCls} /></FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('employment')}>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Educational Attainment">
                <select value={form['soloParent.educationalAttainment']} onChange={(e) => setField('soloParent.educationalAttainment', e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  {SP_EDU.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
              <FL label="Employment Status" req>
                <select value={form['soloParent.employmentStatus']} onChange={(e) => setField('soloParent.employmentStatus', e.target.value)} className={sc('soloParent.employmentStatus')}>
                  <option value="">— Select —</option>
                  {EMPLOYMENT_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <Warn fkey="soloParent.employmentStatus" />
              </FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Occupation / Work"><input value={form['soloParent.occupation']} onChange={(e) => setField('soloParent.occupation', e.target.value)} placeholder="e.g. Teacher, Laundrywoman" className={inputCls} /></FL>
              <FL label="Monthly Income">
                <select value={form['soloParent.monthlyIncome']} onChange={(e) => setField('soloParent.monthlyIncome', e.target.value)} className={selectCls}>
                  <option value="">— Select bracket —</option>
                  {SP_INCOME.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('classification')}>
            <FL label="Category Code as Solo Parent" req>
              <select value={form['soloParent.categoryCode']} onChange={(e) => setField('soloParent.categoryCode', e.target.value)} className={sc('soloParent.categoryCode')}>
                <option value="">— Select category —</option>
                {SOLO_PARENT_CATEGORIES.map(({ code, label }) => <option key={code} value={code}>[{code}] {label}</option>)}
              </select>
              <Warn fkey="soloParent.categoryCode" />
            </FL>
            <div className="grid grid-cols-2 gap-3">
              <FL label="SPIC Status">
                <select value={form['soloParent.spicStatus']} onChange={(e) => setField('soloParent.spicStatus', e.target.value)} className={selectCls}>
                  <option value="">— Select —</option>
                  <option value="New">New</option><option value="Renewal">Renewal</option>
                </select>
              </FL>
              <FL label="Date SPIC Issued">
                <input type="date" value={form['soloParent.dateSpicIssued']} onChange={(e) => setField('soloParent.dateSpicIssued', e.target.value)} className={inputCls} />
              </FL>
            </div>
            <FL label="Benefit Qualification Code">
              <input
                value={form['soloParent.benefitCode']}
                onChange={(e) => setField('soloParent.benefitCode', e.target.value)}
                placeholder="e.g. SP-WELFARE-01"
                className={inputCls}
              />
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>Printed on ID front — enter the benefit code applicable to this solo parent</p>
            </FL>
            <div className="grid grid-cols-3 gap-3">
              <FL label="Pantawid Beneficiary?"><BoolSel fkey="soloParent.pantawidBeneficiary" /></FL>
              <FL label="LGBTQ+?"><BoolSel fkey="soloParent.lgbtq" /></FL>
              <FL label="Person with Disability?"><BoolSel fkey="soloParent.isPWD" /></FL>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Indigenous Person (IP)">
                <input value={form['soloParent.indigenousPerson']} onChange={(e) => setField('soloParent.indigenousPerson', e.target.value)} placeholder="No, or tribal name (e.g. Aeta)" className={inputCls} />
              </FL>
              <FL label="Senior Citizen?"><BoolSel fkey="soloParent.isSeniorCitizen" /></FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('children')}>
            {miss('soloParent.children') && (
              <p className="text-xs text-amber-600 mb-1">At least one child is required</p>
            )}
            <ChildrenForm
              value={form['soloParent.children']}
              onChange={(children) => setForm((f) => ({ ...f, 'soloParent.children': children }))}
            />
            <div className="grid grid-cols-3 gap-3 mt-2">
              <FL label="No. of Children (0–6 yrs)">
                <input type="number" min="0" value={form['soloParent.numChildren0to6']} onChange={(e) => setField('soloParent.numChildren0to6', e.target.value)} className={inputCls} />
              </FL>
              <FL label="No. of Children (7–22 yrs)">
                <input type="number" min="0" value={form['soloParent.numChildren7to22']} onChange={(e) => setField('soloParent.numChildren7to22', e.target.value)} className={inputCls} />
              </FL>
              <FL label="No. of Children (22+ WSN)">
                <input type="number" min="0" value={form['soloParent.numChildrenWSN']} onChange={(e) => setField('soloParent.numChildrenWSN', e.target.value)} className={inputCls} />
              </FL>
            </div>
          </AccordionSection>

          <AccordionSection {...accProps('emergency')}>
            <div className="grid grid-cols-2 gap-3">
              <FL label="Contact Person" req>
                <input value={form.emergencyContactName} onChange={(e) => setField('emergencyContactName', e.target.value)} placeholder="Full name" className={ic('emergencyContactName')} />
                <Warn fkey="emergencyContactName" />
              </FL>
              <FL label="Contact Number" req>
                <input value={form.emergencyContactNumber} onChange={(e) => setField('emergencyContactNumber', e.target.value)} placeholder="09XXXXXXXXX" className={ic('emergencyContactNumber')} />
                <Warn fkey="emergencyContactNumber" />
              </FL>
            </div>
            <FL label="Contact Address" req>
              <input value={form.emergencyContactAddress} onChange={(e) => setField('emergencyContactAddress', e.target.value)} placeholder="Full address" className={ic('emergencyContactAddress')} />
              <Warn fkey="emergencyContactAddress" />
            </FL>
            <FL label="Relationship to Solo Parent">
              <input value={form.emergencyContactRelation} onChange={(e) => setField('emergencyContactRelation', e.target.value)} placeholder="e.g. Parent, Sibling" className={inputCls} />
            </FL>
          </AccordionSection>

        </>)}

        {/* ════════════ PHOTO & SIGNATURE (all depts) ════════════ */}
        <AccordionSection {...accProps('photoSig')}>
          {!photoPath && !sigPath && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <Camera className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Upload a photo and signature to complete this record.</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <PhotoEditor
              applicantId={id}
              existingPhotoUrl={photoPath ? applicantService.getFileUrl(photoPath) : null}
              accentColor={accent}
              onComplete={() => queryClient.invalidateQueries({ queryKey: ['applicant', id] })}
            />
            <SignaturePad
              applicantId={id}
              existingSignatureUrl={sigPath ? applicantService.getFileUrl(sigPath) : null}
              accentColor={accent}
              onComplete={() => queryClient.invalidateQueries({ queryKey: ['applicant', id] })}
            />
          </div>
        </AccordionSection>

      </div>
    </div>
  );
}
