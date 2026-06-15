import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, LayoutGrid, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import api from '../../services/api';
import { applicantService } from '../../services/applicantService';
import useAuthStore from '../../stores/authStore';
import { CIVIL_STATUS, EMPLOYMENT_STATUS, LIVING_STATUS, SC_REGISTRATION_CATEGORY, SC_TRANSACTION_TYPE } from '../../lib/constants';
import PhotoEditor from '../../components/PhotoEditor';
import SignaturePad from '../../components/SignaturePad';
import PWDQuickEncodeFields from '../../components/forms/PWDQuickEncodeFields';
import SoloParentQuickEncodeFields from '../../components/forms/SoloParentQuickEncodeFields';
import SeniorCitizenQuickEncodeFields from '../../components/forms/SeniorCitizenQuickEncodeFields';

// ── Constants ────────────────────────────────────────────────────────────────

const DEPT_ACCENT = {
  PWD:            '#1E40AF',
  SOLO_PARENT:    '#9F1239',
  SENIOR_CITIZEN: '#92400E',
};

const DEPT_GRADIENT = {
  PWD:            'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 60%, #2563EB 100%)',
  SOLO_PARENT:    'linear-gradient(135deg, #881337 0%, #9F1239 60%, #BE123C 100%)',
  SENIOR_CITIZEN: 'linear-gradient(135deg, #78350F 0%, #92400E 60%, #B45309 100%)',
};

const DEPT_LABEL = {
  PWD:            'Persons with Disability',
  SOLO_PARENT:    'Solo Parent',
  SENIOR_CITIZEN: 'Senior Citizen',
};

const DEPT_BADGE_CLS = {
  PWD:            'bg-blue-50 text-blue-800 border border-blue-200',
  SOLO_PARENT:    'bg-rose-50 text-rose-800 border border-rose-200',
  SENIOR_CITIZEN: 'bg-amber-50 text-amber-800 border border-amber-200',
};

const STEPS = [
  { label: 'Basic Info' },
  { label: 'Photo & Signature' },
  { label: 'Generate ID' },
];

// Optional field option lists
const SEX_OPTIONS         = ['Male', 'Female'];
const EDUCATIONAL_OPTS    = ['No formal education', 'Elementary', 'High School', 'Vocational', 'College', 'Post-graduate'];
const MARITAL_STATUS_OPTS = ['Single', 'Married', 'Widow/er', 'Separated', 'Annulled', 'Cohabitation', 'Divorced'];
const RELATIONSHIP_TO_HH_OPTS    = [
  'Household Head', 'Spouse', 'Son/Daughter', 'Brother/Sister',
  'Son-in-Law/Daughter-in-Law', 'Grandson/Granddaughter', 'Father/Mother', 'Other Relative',
];

// Input styles for optional accordion
const optInputCls =
  'w-full border border-border rounded-xl px-3.5 py-2.5 text-sm bg-white ' +
  'focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-muted/60';

const optSelectCls = cn(optInputCls, 'cursor-pointer');

// ── Helper sub-components ─────────────────────────────────────────────────────

function StepIndicator({ current, accent }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((step, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all',
                  done   && 'border-transparent text-white',
                  active && 'text-white ring-4',
                  !done && !active && 'bg-surface border-border text-muted',
                )}
                style={
                  done   ? { backgroundColor: accent, borderColor: accent } :
                  active ? { backgroundColor: accent, borderColor: accent, '--tw-ring-color': `${accent}30` } :
                  {}
                }
              >
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={cn('mt-1.5 text-xs font-medium', active || done ? 'text-text-1' : 'text-muted')}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="h-px w-20 mb-4 mx-3 transition-colors"
                style={{ backgroundColor: i < current ? accent : 'var(--color-border)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm py-1.5 border-b border-border/50 last:border-0">
      <span className="text-muted">{label}</span>
      <span className="text-text-1 font-medium">{value}</span>
    </div>
  );
}

function formatDateDisplay(iso) {
  if (!iso) return null;
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function OptField({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-2 mb-1">{label}</label>
      {children}
    </div>
  );
}

function OptSectionDivider({ label }) {
  return (
    <div className="flex items-center gap-3 mt-5 mb-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted whitespace-nowrap">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function OptBoolSel({ value, onChange, disabled }) {
  return (
    <select
      value={value === null || value === undefined ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'true')}
      className={optSelectCls}
      disabled={disabled}
    >
      <option value="">— Select —</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard component
// ─────────────────────────────────────────────────────────────────────────────

export default function NewApplicantPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const dept   = user?.department;
  const accent = DEPT_ACCENT[dept] ?? '#334155';

  // Wizard state
  const [currentStep,  setCurrentStep]  = useState(1);
  const [applicantId,  setApplicantId]  = useState(null);
  const [photoDone,    setPhotoDone]    = useState(false);
  const [sigDone,      setSigDone]      = useState(false);
  const [photoUrl,     setPhotoUrl]     = useState(null);
  const [sigUrl,       setSigUrl]       = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Step 1 state
  const [isSubmitting,  setIsSubmitting]  = useState(false);
  const [errors,        setErrors]        = useState({});
  const [showOptional,  setShowOptional]  = useState(false);

  const [form, setForm] = useState({
    // Required personal
    firstName:             '',
    lastName:              '',
    middleName:            '',
    extensionName:         '',
    birthdate:             '',
    barangay:              '',
    birthplace:            '',
    emergencyContactName:    '',
    emergencyContactNumber:  '',
    emergencyContactAddress: '',
    emergencyContactRelation:'',
    // Optional shared
    sex:           '',
    civilStatus:   '',
    contactNumber: '',
    religion:      '',
    purokStreet:   '',
    // PWD dept-specific
    pwd: {
      disabilityType:        '',
      causeOfDisability:     '',
      educationalAttainment: '',
      educationalStatus:     '',
      occupation:            '',
      monthlyIncome:         '',
      organization:          '',
      skillsDesired:         '',
      availableSkill:        '',
      hobbies:               '',
      relationshipToHH:      '',
      servicesAvailed:       '',
      needsProblems:         '',
      otherFamilyResources:  '',
      uploadedToDOH:         false,
      natFormSubmitted:      false,
      locFormSubmitted:      false,
    },
    // Solo Parent dept-specific
    soloParent: {
      categoryCode:          '',
      benefitCode:           '',
      philsysCardNumber:     '',
      email:                 '',
      children: [{ lastName: '', firstName: '', middleName: '', birthdate: '', sex: '', relationship: '' }],
      educationalAttainment: '',
      employmentStatus:      '',
      occupation:            '',
      monthlyIncome:         '',
      numChildren0to6:       '',
      numChildren7to22:      '',
      numChildrenWSN:        '',
      pantawidBeneficiary:   null,
      indigenousPerson:      '',
      lgbtq:                 null,
      isPWD:                 null,
      isSeniorCitizen:       null,
    },
    // Senior Citizen dept-specific
    seniorCitizen: {
      maritalStatus:        '',
      livingStatus:         '',
      occupation:           '',
      income:               '',
      medicalCondition:     '',
      medicine:             '',
      isDisabled:           null,
      isPensioner:          null,
      pensionType:          '',
      pensionAmount:        '',
      registrationCategory: '',
      idTransactionType:    '',
      dateIssued:           '',
      rrn:                  '',
    },
  });

  function setField(path, value) {
    const keys = path.split('.');
    if (keys.length === 1) {
      setForm((f) => ({ ...f, [path]: value }));
    } else {
      setForm((f) => ({
        ...f,
        [keys[0]]: { ...f[keys[0]], [keys[1]]: value },
      }));
    }
    if (errors[path]) setErrors((e) => { const ne = { ...e }; delete ne[path]; return ne; });
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim())  e.lastName  = 'Required';
    if (!form.birthdate)        e.birthdate = 'Required';
    if (!form.barangay)         e.barangay  = 'Required';

    if (dept === 'PWD') {
      if (!form.pwd.disabilityType)     e['pwd.disabilityType']  = 'Required';
      if (!form.emergencyContactName)   e.emergencyContactName   = 'Required';
      if (!form.emergencyContactNumber) e.emergencyContactNumber = 'Required';
    }

    if (dept === 'SOLO_PARENT') {
      if (!form.birthplace)              e.birthplace                = 'Required';
      if (!form.soloParent.categoryCode) e['soloParent.categoryCode'] = 'Required';
      if (!form.emergencyContactName)    e.emergencyContactName       = 'Required';
      if (!form.emergencyContactNumber)  e.emergencyContactNumber     = 'Required';
      if (!form.emergencyContactAddress) e.emergencyContactAddress    = 'Required';
      const c = form.soloParent.children[0];
      if (!c?.firstName || !c?.lastName || !c?.birthdate || !c?.relationship) {
        e['soloParent.children'] = 'At least one child (name, birthdate, relationship) is required';
      }
    }

    return e;
  }

  async function handleStep1Submit(e) {
    e.preventDefault();

    if (applicantId) {
      setCurrentStep(2);
      return;
    }

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        firstName:    form.firstName.trim(),
        lastName:     form.lastName.trim(),
        middleName:   form.middleName.trim() || undefined,
        extensionName:form.extensionName || undefined,
        birthdate:    form.birthdate,
        barangay:     form.barangay,
        birthplace:   dept === 'SOLO_PARENT' ? form.birthplace : undefined,
        emergencyContactName:     form.emergencyContactName || undefined,
        emergencyContactNumber:   form.emergencyContactNumber || undefined,
        emergencyContactAddress:  form.emergencyContactAddress || undefined,
        emergencyContactRelation: form.emergencyContactRelation || undefined,
        department: dept,
      };

      // Optional shared fields — include only if filled
      if (form.sex)           payload.sex           = form.sex;
      if (form.civilStatus)   payload.civilStatus   = form.civilStatus;
      if (form.contactNumber) payload.contactNumber = form.contactNumber;
      if (form.religion)      payload.religion      = form.religion;
      if (form.purokStreet)   payload.purokStreet   = form.purokStreet;

      if (dept === 'PWD') {
        payload.pwd = {
          disabilityType: form.pwd.disabilityType,
          ...(form.pwd.causeOfDisability     && { causeOfDisability:    form.pwd.causeOfDisability }),
          ...(form.pwd.educationalAttainment && { educationalAttainment: form.pwd.educationalAttainment }),
          ...(form.pwd.educationalStatus     && { educationalStatus:    form.pwd.educationalStatus }),
          ...(form.pwd.occupation            && { occupation:           form.pwd.occupation }),
          ...(form.pwd.monthlyIncome         && { monthlyIncome:        form.pwd.monthlyIncome }),
          ...(form.pwd.organization          && { organization:         form.pwd.organization }),
          ...(form.pwd.skillsDesired         && { skillsDesired:        form.pwd.skillsDesired }),
          ...(form.pwd.availableSkill        && { availableSkill:       form.pwd.availableSkill }),
          ...(form.pwd.hobbies               && { hobbies:              form.pwd.hobbies }),
          ...(form.pwd.relationshipToHH      && { relationshipToHH:     form.pwd.relationshipToHH }),
          ...(form.pwd.servicesAvailed       && { servicesAvailed:      form.pwd.servicesAvailed }),
          ...(form.pwd.needsProblems         && { needsProblems:        form.pwd.needsProblems }),
          ...(form.pwd.otherFamilyResources  && { otherFamilyResources: form.pwd.otherFamilyResources }),
          uploadedToDOH:    form.pwd.uploadedToDOH,
          natFormSubmitted: form.pwd.natFormSubmitted,
          locFormSubmitted: form.pwd.locFormSubmitted,
        };
      }

      if (dept === 'SOLO_PARENT') {
        const sp = form.soloParent;
        payload.soloParent = {
          categoryCode: sp.categoryCode,
          children: sp.children.filter((c) => c.firstName || c.lastName),
          ...(sp.benefitCode           && { benefitCode:           sp.benefitCode }),
          ...(sp.philsysCardNumber     && { philsysCardNumber:     sp.philsysCardNumber }),
          ...(sp.email                 && { email:                 sp.email }),
          ...(sp.educationalAttainment && { educationalAttainment: sp.educationalAttainment }),
          ...(sp.employmentStatus      && { employmentStatus:      sp.employmentStatus }),
          ...(sp.occupation            && { occupation:            sp.occupation }),
          ...(sp.monthlyIncome         && { monthlyIncome:         sp.monthlyIncome }),
          ...(sp.numChildren0to6       && { numChildren0to6:       sp.numChildren0to6 }),
          ...(sp.numChildren7to22      && { numChildren7to22:      sp.numChildren7to22 }),
          ...(sp.numChildrenWSN        && { numChildrenWSN:        sp.numChildrenWSN }),
          ...(sp.pantawidBeneficiary !== null && { pantawidBeneficiary: sp.pantawidBeneficiary }),
          ...(sp.indigenousPerson      && { indigenousPerson:      sp.indigenousPerson }),
          ...(sp.lgbtq          !== null && { lgbtq:          sp.lgbtq }),
          ...(sp.isPWD          !== null && { isPWD:          sp.isPWD }),
          ...(sp.isSeniorCitizen !== null && { isSeniorCitizen: sp.isSeniorCitizen }),
        };
      }

      if (dept === 'SENIOR_CITIZEN') {
        const sc = form.seniorCitizen;
        const scPayload = {};
        if (sc.maritalStatus)         scPayload.maritalStatus        = sc.maritalStatus;
        if (sc.livingStatus)          scPayload.livingStatus         = sc.livingStatus;
        if (sc.occupation)            scPayload.occupation           = sc.occupation;
        if (sc.income)                scPayload.income               = sc.income;
        if (sc.medicalCondition)      scPayload.medicalCondition     = sc.medicalCondition;
        if (sc.medicine)              scPayload.medicine             = sc.medicine;
        if (sc.isDisabled  !== null)  scPayload.isDisabled           = sc.isDisabled;
        if (sc.isPensioner !== null)  scPayload.isPensioner          = sc.isPensioner;
        if (sc.pensionType)           scPayload.pensionType          = sc.pensionType;
        if (sc.pensionAmount)         scPayload.pensionAmount        = sc.pensionAmount;
        if (sc.registrationCategory)  scPayload.registrationCategory = sc.registrationCategory;
        if (sc.idTransactionType)     scPayload.idTransactionType    = sc.idTransactionType;
        if (sc.dateIssued)            scPayload.dateIssued           = sc.dateIssued;
        if (sc.rrn)                   scPayload.rrn                  = sc.rrn;
        if (Object.keys(scPayload).length > 0) payload.seniorCitizen = scPayload;
      }

      const res = await api.post('/applicants', payload);
      setApplicantId(res.data._id);
      if (res.data.duplicateWarning) {
        toast.warning(res.data.duplicateWarning.message, { duration: 8000 });
      }
      setCurrentStep(2);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'Failed to save applicant.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGenerateID() {
    setIsGenerating(true);
    try {
      await api.post('/id-records', { applicantId });
      toast.success('ID card generated successfully!');
      navigate(`/staff/applicants/${applicantId}/id-card`);
    } catch (err) {
      toast.error(err.response?.data?.error?.message || 'ID generation failed. Please try again.');
      setIsGenerating(false);
    }
  }

  const gradient = DEPT_GRADIENT[dept] ?? 'linear-gradient(135deg, #1E293B 0%, #334155 60%, #475569 100%)';

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-up">
      {/* ── Dept gradient banner ── */}
      <div
        className="rounded-2xl overflow-hidden mb-6 relative"
        style={{ background: gradient, minHeight: '110px', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.05)', transform: 'translate(30%,-40%)' }} />
        <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full pointer-events-none"
             style={{ background: 'rgba(255,255,255,0.04)', transform: 'translate(-30%,40%)' }} />
        <div className="relative z-10 px-8 py-6 flex items-center justify-between">
          <div>
            <h1 className="font-serif text-3xl text-white leading-tight">New Applicant</h1>
            <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.65)' }}>
              {DEPT_LABEL[dept] ?? 'All Departments'} · Quick Encode
            </p>
          </div>
          {currentStep === 1 && (
            <button
              onClick={() => navigate('/staff/applicants')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.28)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.18)')}
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              Back to Applicants
            </button>
          )}
        </div>
      </div>

      <StepIndicator current={currentStep - 1} accent={accent} />

      {/* ══ STEP 1 — Basic Info ═══════════════════════════════════════════ */}
      {currentStep === 1 && (
        <form
          onSubmit={handleStep1Submit}
          className="max-w-[560px] mx-auto bg-white border border-border rounded-2xl p-6 space-y-4 animate-fade-up"
          style={{ boxShadow: 'var(--shadow-card)' }}
          noValidate
        >
          {dept === 'PWD' && (
            <PWDQuickEncodeFields
              form={form}
              setField={setField}
              errors={errors}
              isSubmitting={isSubmitting}
            />
          )}

          {dept === 'SOLO_PARENT' && (
            <SoloParentQuickEncodeFields
              form={form}
              setField={setField}
              setForm={setForm}
              errors={errors}
              isSubmitting={isSubmitting}
            />
          )}

          {dept === 'SENIOR_CITIZEN' && (
            <SeniorCitizenQuickEncodeFields
              form={form}
              setField={setField}
              errors={errors}
              isSubmitting={isSubmitting}
            />
          )}

          {!dept && (
            <p className="text-sm text-danger py-4 text-center">
              No department assigned. Contact your administrator.
            </p>
          )}

          {/* ── Optional complete-profile accordion ─────────────────── */}
          {dept && (
            <div>
              <button
                type="button"
                onClick={() => setShowOptional((v) => !v)}
                className="w-full flex items-center justify-between gap-2 px-4 py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted hover:border-slate-300 hover:text-text-2 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4" />
                  {showOptional ? 'Hide optional profile fields' : 'Complete profile now (optional)'}
                </span>
                <ChevronDown className={cn('w-4 h-4 transition-transform duration-200', showOptional && 'rotate-180')} />
              </button>

              {showOptional && (
                <div className="mt-3 p-5 border border-border rounded-xl bg-surface">

                  {/* ── PWD optional ──────────────────────────────── */}
                  {dept === 'PWD' && (
                    <div className="space-y-3">
                      <OptSectionDivider label="Disability Details" />
                      <OptField label="Cause of Disability">
                        <input value={form.pwd.causeOfDisability} onChange={(e) => setField('pwd.causeOfDisability', e.target.value)} placeholder="e.g. Congenital, Acquired, Accident" className={optInputCls} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Personal Information" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Sex">
                          <select value={form.sex} onChange={(e) => setField('sex', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {SEX_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="Civil Status">
                          <select value={form.civilStatus} onChange={(e) => setField('civilStatus', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {CIVIL_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Contact Number">
                          <input value={form.contactNumber} onChange={(e) => setField('contactNumber', e.target.value)} placeholder="09XXXXXXXXX" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Religion">
                          <input value={form.religion} onChange={(e) => setField('religion', e.target.value)} placeholder="e.g. Roman Catholic" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Purok / Street">
                        <input value={form.purokStreet} onChange={(e) => setField('purokStreet', e.target.value)} placeholder="e.g. Purok 3, Sitio Mabuhay" className={optInputCls} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Socio-Economic" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Educational Attainment">
                          <select value={form.pwd.educationalAttainment} onChange={(e) => setField('pwd.educationalAttainment', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {EDUCATIONAL_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="Educational Status">
                          <input value={form.pwd.educationalStatus} onChange={(e) => setField('pwd.educationalStatus', e.target.value)} placeholder="e.g. Currently Enrolled" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Occupation">
                          <input value={form.pwd.occupation} onChange={(e) => setField('pwd.occupation', e.target.value)} placeholder="e.g. Vendor" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Monthly Income (₱)">
                          <input value={form.pwd.monthlyIncome} onChange={(e) => setField('pwd.monthlyIncome', e.target.value)} placeholder="e.g. 5000" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>

                      <OptSectionDivider label="Org & Skills" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Organization">
                          <input value={form.pwd.organization} onChange={(e) => setField('pwd.organization', e.target.value)} placeholder="Organization name" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Desired Skills">
                          <input value={form.pwd.skillsDesired} onChange={(e) => setField('pwd.skillsDesired', e.target.value)} placeholder="e.g. Livelihood training" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Available Skill">
                          <input value={form.pwd.availableSkill} onChange={(e) => setField('pwd.availableSkill', e.target.value)} placeholder="e.g. Carpentry, Sewing" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Hobbies">
                          <input value={form.pwd.hobbies} onChange={(e) => setField('pwd.hobbies', e.target.value)} placeholder="e.g. Gardening" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>

                      <OptSectionDivider label="Case Management" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Relationship to Household Head">
                          <select value={form.pwd.relationshipToHH} onChange={(e) => setField('pwd.relationshipToHH', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {RELATIONSHIP_TO_HH_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="Other Family Resources">
                          <input value={form.pwd.otherFamilyResources} onChange={(e) => setField('pwd.otherFamilyResources', e.target.value)} placeholder="e.g. 4Ps beneficiary" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Services Availed">
                        <input value={form.pwd.servicesAvailed} onChange={(e) => setField('pwd.servicesAvailed', e.target.value)} placeholder="e.g. Medical assistance, Livelihood" className={optInputCls} disabled={isSubmitting} />
                      </OptField>
                      <OptField label="Needs / Problems">
                        <input value={form.pwd.needsProblems} onChange={(e) => setField('pwd.needsProblems', e.target.value)} placeholder="Identified needs or problems" className={optInputCls} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Form Tracking" />
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.pwd.uploadedToDOH} onChange={(e) => setField('pwd.uploadedToDOH', e.target.checked)} className="w-4 h-4 rounded" disabled={isSubmitting} />
                          <span className="text-sm text-text-2">Uploaded to DOH Registry</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.pwd.natFormSubmitted} onChange={(e) => setField('pwd.natFormSubmitted', e.target.checked)} className="w-4 h-4 rounded" disabled={isSubmitting} />
                          <span className="text-sm text-text-2">National Form Submitted</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={form.pwd.locFormSubmitted} onChange={(e) => setField('pwd.locFormSubmitted', e.target.checked)} className="w-4 h-4 rounded" disabled={isSubmitting} />
                          <span className="text-sm text-text-2">Local Form Submitted</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ── SOLO PARENT optional ───────────────────────── */}
                  {dept === 'SOLO_PARENT' && (
                    <div className="space-y-3">
                      <OptSectionDivider label="Personal Details" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Sex">
                          <select value={form.sex} onChange={(e) => setField('sex', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {SEX_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="Civil Status">
                          <select value={form.civilStatus} onChange={(e) => setField('civilStatus', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {CIVIL_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Contact Number">
                          <input value={form.contactNumber} onChange={(e) => setField('contactNumber', e.target.value)} placeholder="09XXXXXXXXX" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Religion">
                          <input value={form.religion} onChange={(e) => setField('religion', e.target.value)} placeholder="e.g. Roman Catholic" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="PhilSys Card Number">
                          <input value={form.soloParent.philsysCardNumber} onChange={(e) => setField('soloParent.philsysCardNumber', e.target.value)} placeholder="e.g. 1234-5678-9012" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Email Address">
                          <input type="email" value={form.soloParent.email} onChange={(e) => setField('soloParent.email', e.target.value)} placeholder="e.g. juan@email.com" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Purok / Street">
                        <input value={form.purokStreet} onChange={(e) => setField('purokStreet', e.target.value)} placeholder="e.g. Purok 3, Sitio Mabuhay" className={optInputCls} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Employment" />
                      <OptField label="Educational Attainment">
                        <select value={form.soloParent.educationalAttainment} onChange={(e) => setField('soloParent.educationalAttainment', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                          <option value="">— Select —</option>
                          {EDUCATIONAL_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </OptField>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Employment Status">
                          <select value={form.soloParent.employmentStatus} onChange={(e) => setField('soloParent.employmentStatus', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {EMPLOYMENT_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="Occupation">
                          <input value={form.soloParent.occupation} onChange={(e) => setField('soloParent.occupation', e.target.value)} placeholder="e.g. Vendor" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Monthly Income (₱)">
                        <input value={form.soloParent.monthlyIncome} onChange={(e) => setField('soloParent.monthlyIncome', e.target.value)} placeholder="e.g. 5000" className={optInputCls} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Children Summary" />
                      <div className="grid grid-cols-3 gap-3">
                        <OptField label="Ages 0–6">
                          <input type="number" min="0" value={form.soloParent.numChildren0to6} onChange={(e) => setField('soloParent.numChildren0to6', e.target.value)} placeholder="0" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Ages 7–22">
                          <input type="number" min="0" value={form.soloParent.numChildren7to22} onChange={(e) => setField('soloParent.numChildren7to22', e.target.value)} placeholder="0" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="With Spec. Needs">
                          <input type="number" min="0" value={form.soloParent.numChildrenWSN} onChange={(e) => setField('soloParent.numChildrenWSN', e.target.value)} placeholder="0" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Pantawid Beneficiary?">
                        <OptBoolSel value={form.soloParent.pantawidBeneficiary} onChange={(v) => setField('soloParent.pantawidBeneficiary', v)} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Classifications" />
                      <OptField label="Indigenous Person / Ethnicity">
                        <input value={form.soloParent.indigenousPerson} onChange={(e) => setField('soloParent.indigenousPerson', e.target.value)} placeholder="e.g. Aeta, Igorot (leave blank if N/A)" className={optInputCls} disabled={isSubmitting} />
                      </OptField>
                      <div className="grid grid-cols-3 gap-3">
                        <OptField label="LGBTQ+?">
                          <OptBoolSel value={form.soloParent.lgbtq} onChange={(v) => setField('soloParent.lgbtq', v)} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="PWD?">
                          <OptBoolSel value={form.soloParent.isPWD} onChange={(v) => setField('soloParent.isPWD', v)} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Senior Citizen?">
                          <OptBoolSel value={form.soloParent.isSeniorCitizen} onChange={(v) => setField('soloParent.isSeniorCitizen', v)} disabled={isSubmitting} />
                        </OptField>
                      </div>

                      <OptSectionDivider label="ID Details" />
                      <OptField label="Benefit Qualification Code">
                        <input
                          value={form.soloParent.benefitCode}
                          onChange={(e) => setField('soloParent.benefitCode', e.target.value)}
                          placeholder="e.g. SP-WELFARE-01"
                          className={optInputCls}
                          disabled={isSubmitting}
                        />
                        <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>Printed on the ID card front</p>
                      </OptField>

                    </div>
                  )}

                  {/* ── SENIOR CITIZEN optional ────────────────────── */}
                  {dept === 'SENIOR_CITIZEN' && (
                    <div className="space-y-3">
                      <OptSectionDivider label="Personal Details" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Sex">
                          <select value={form.sex} onChange={(e) => setField('sex', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {SEX_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="Marital Status">
                          <select value={form.seniorCitizen.maritalStatus} onChange={(e) => setField('seniorCitizen.maritalStatus', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {MARITAL_STATUS_OPTS.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Contact Number">
                          <input value={form.contactNumber} onChange={(e) => setField('contactNumber', e.target.value)} placeholder="09XXXXXXXXX" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Religion">
                          <input value={form.religion} onChange={(e) => setField('religion', e.target.value)} placeholder="e.g. Roman Catholic" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Purok / Street">
                        <input value={form.purokStreet} onChange={(e) => setField('purokStreet', e.target.value)} placeholder="e.g. Purok 3, Sitio Mabuhay" className={optInputCls} disabled={isSubmitting} />
                      </OptField>
                      <OptField label="Living Status">
                        <select value={form.seniorCitizen.livingStatus} onChange={(e) => setField('seniorCitizen.livingStatus', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                          <option value="">— Select —</option>
                          {LIVING_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </select>
                      </OptField>

                      <OptSectionDivider label="Employment" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Occupation">
                          <input value={form.seniorCitizen.occupation} onChange={(e) => setField('seniorCitizen.occupation', e.target.value)} placeholder="e.g. Retired Teacher" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Monthly Income (₱)">
                          <input value={form.seniorCitizen.income} onChange={(e) => setField('seniorCitizen.income', e.target.value)} placeholder="e.g. 3000" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>

                      <OptSectionDivider label="Health" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Medical Condition">
                          <input value={form.seniorCitizen.medicalCondition} onChange={(e) => setField('seniorCitizen.medicalCondition', e.target.value)} placeholder="e.g. Hypertension" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Maintenance Medicine">
                          <input value={form.seniorCitizen.medicine} onChange={(e) => setField('seniorCitizen.medicine', e.target.value)} placeholder="e.g. Amlodipine" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                      <OptField label="Person with Disability?">
                        <OptBoolSel value={form.seniorCitizen.isDisabled} onChange={(v) => setField('seniorCitizen.isDisabled', v)} disabled={isSubmitting} />
                      </OptField>

                      <OptSectionDivider label="Pension" />
                      <OptField label="Pensioner?">
                        <OptBoolSel value={form.seniorCitizen.isPensioner} onChange={(v) => setField('seniorCitizen.isPensioner', v)} disabled={isSubmitting} />
                      </OptField>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Pension Type">
                          <input value={form.seniorCitizen.pensionType} onChange={(e) => setField('seniorCitizen.pensionType', e.target.value)} placeholder="e.g. SSS, GSIS" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="Pension Amount (₱)">
                          <input type="number" min="0" value={form.seniorCitizen.pensionAmount} onChange={(e) => setField('seniorCitizen.pensionAmount', e.target.value)} placeholder="e.g. 2000" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>

                      <OptSectionDivider label="Registration" />
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Registration Category">
                          <select value={form.seniorCitizen.registrationCategory} onChange={(e) => setField('seniorCitizen.registrationCategory', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {SC_REGISTRATION_CATEGORY.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                        <OptField label="ID Transaction Type">
                          <select value={form.seniorCitizen.idTransactionType} onChange={(e) => setField('seniorCitizen.idTransactionType', e.target.value)} className={optSelectCls} disabled={isSubmitting}>
                            <option value="">— Select —</option>
                            {SC_TRANSACTION_TYPE.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        </OptField>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <OptField label="Date OSCA Card Issued">
                          <input type="date" value={form.seniorCitizen.dateIssued} onChange={(e) => setField('seniorCitizen.dateIssued', e.target.value)} className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                        <OptField label="RRN (Reference No.)">
                          <input value={form.seniorCitizen.rrn} onChange={(e) => setField('seniorCitizen.rrn', e.target.value)} placeholder="e.g. 03-6906-000-XXXXXXX" className={optInputCls} disabled={isSubmitting} />
                        </OptField>
                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* ── Submit ─────────────────────────────────────────────────── */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !dept}
              className="w-full h-11 text-white rounded-full text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: accent }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating Record…
                </>
              ) : applicantId ? (
                'Next: Photo & Signature →'
              ) : (
                'Save & Continue →'
              )}
            </button>
            <p className="text-center text-xs text-muted mt-2">
              Only required fields (<span className="text-danger">*</span>) are needed to generate the ID
            </p>
          </div>
        </form>
      )}

      {/* ══ STEP 2 — Photo & Signature ════════════════════════════════════ */}
      {currentStep === 2 && applicantId && (
        <div className="max-w-2xl animate-slide-in">
          <div
            className="bg-white border border-border rounded-2xl p-6"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            <p className="text-sm text-muted mb-5">
              Upload and process the applicant's photo and signature.
              Both are required to generate the ID.
            </p>

            <div className="grid grid-cols-2 gap-6">
              <PhotoEditor
                applicantId={applicantId}
                existingPhotoUrl={photoUrl}
                accentColor={accent}
                onComplete={async (result) => {
                  setPhotoDone(true);
                  try {
                    const apiUrl = result.photoUrl || applicantService.getFileUrl(result.photoPath);
                    setPhotoUrl(await applicantService.fetchFileBlob(apiUrl));
                  } catch {
                    setPhotoUrl(null);
                  }
                }}
              />
              <SignaturePad
                applicantId={applicantId}
                existingSignatureUrl={sigUrl}
                accentColor={accent}
                onComplete={async (result) => {
                  setSigDone(true);
                  try {
                    const apiUrl = result.signatureUrl || applicantService.getFileUrl(result.signaturePath);
                    setSigUrl(await applicantService.fetchFileBlob(apiUrl));
                  } catch {
                    setSigUrl(null);
                  }
                }}
              />
            </div>

            {(!photoDone || !sigDone) && (
              <p className="text-xs text-center text-muted mt-5 pt-4 border-t border-border">
                {!photoDone && !sigDone
                  ? 'Add a photo and signature to continue.'
                  : !photoDone
                    ? 'Add a photo to continue.'
                    : 'Add a signature to continue.'}
              </p>
            )}
          </div>

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="flex items-center gap-1.5 px-4 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              disabled={!photoDone || !sigDone}
              className="flex-1 py-2.5 text-white rounded-xl text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: accent }}
            >
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ══ STEP 3 — Confirm & Generate ═══════════════════════════════════ */}
      {currentStep === 3 && applicantId && (
        <div className="max-w-lg animate-slide-in">
          <div
            className="bg-white border border-border rounded-2xl p-6 mb-4"
            style={{ boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex flex-col items-center text-center mb-6">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt="Applicant photo"
                  className="w-24 h-32 object-cover rounded-xl mb-3"
                  style={{
                    boxShadow: '0 0 0 3px white, 0 0 0 4px var(--color-border)',
                    background: 'repeating-conic-gradient(#e5e7eb 0% 25%, white 0% 50%) 0 0 / 12px 12px',
                  }}
                />
              ) : (
                <div
                  className="w-24 h-32 rounded-xl mb-3"
                  style={{ backgroundColor: 'var(--color-surface-2)' }}
                />
              )}
              <h2 className="font-display text-2xl text-text-1">
                {form.lastName}, {form.firstName}
                {form.extensionName ? ` ${form.extensionName}` : ''}
                {form.middleName ? ` ${form.middleName[0]}.` : ''}
              </h2>
              {dept && (
                <span
                  className={cn(
                    'mt-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold',
                    DEPT_BADGE_CLS[dept] ?? 'bg-gray-100 text-gray-700',
                  )}
                >
                  {DEPT_LABEL[dept] ?? dept}
                </span>
              )}
            </div>

            {sigUrl && (
              <div className="mb-4 p-3 border border-border rounded-lg bg-white flex items-center justify-center min-h-[56px]">
                <img src={sigUrl} alt="Signature" className="max-h-10 max-w-full object-contain" />
              </div>
            )}

            <div>
              <InfoRow label="Date of Birth" value={formatDateDisplay(form.birthdate)} />
              <InfoRow label="Barangay"      value={form.barangay} />
              {dept === 'SOLO_PARENT' && form.birthplace && (
                <InfoRow label="Birthplace" value={form.birthplace} />
              )}
              {dept === 'PWD' && form.pwd.disabilityType && (
                <InfoRow label="Disability Type" value={form.pwd.disabilityType} />
              )}
              {dept === 'SOLO_PARENT' && form.soloParent.categoryCode && (
                <InfoRow label="Category Code" value={`[${form.soloParent.categoryCode}]`} />
              )}
            </div>

            <div
              className="mt-4 pt-3 text-xs text-center text-muted"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              Please verify all information is correct before generating the ID.
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerateID}
            disabled={isGenerating}
            className="w-full py-3.5 text-white rounded-xl font-semibold text-base transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ backgroundColor: accent, boxShadow: `0 4px 14px ${accent}50` }}
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Generating your ID card…
              </>
            ) : (
              'Generate ID Now →'
            )}
          </button>

          <button
            type="button"
            onClick={() => setCurrentStep(2)}
            disabled={isGenerating}
            className="w-full mt-3 py-2.5 border border-border rounded-xl text-sm text-text-2 hover:bg-surface transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Photo &amp; Signature
          </button>

          <p className="text-center mt-4 text-xs text-muted">
            Or{' '}
            <button
              type="button"
              onClick={() => navigate(`/staff/applicants/${applicantId}`)}
              className="underline hover:text-text-1 transition-colors"
            >
              view applicant record
            </button>
            {' '}and generate the ID later.
          </p>
        </div>
      )}
    </div>
  );
}
