import { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom'
import AuthHeader from '../../components/AuthHeader'
import { registerUser, getPendingRegistration } from '../../services/auth.service'

const NAME_REGEX = /^[A-Za-z\s'-]+$/

const STUDENT_NUMBER_REGEX = /^\d{4}-(100|200)-\d+$/

const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#_-])[A-Za-z\d@$!%*?&.#_-]{8,}$/

const STEPS = ["Personal Info", "Additional Info", "Account"];

const inputBase =
  "w-full h-10 px-3 border rounded-lg text-sm text-gray-900 bg-white outline-none placeholder-gray-400 transition";
const inputNormal = inputBase + " border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const inputError = inputBase + " border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100";

const selectBase =
  "w-full h-10 px-3 border rounded-lg text-sm text-gray-900 bg-white outline-none transition";
const selectNormal = selectBase + " border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const selectError = selectBase + " border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100";

function Field({ label, required, hint, error, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      {!error && hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function EyeIcon({ visible }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: 19, height: 19 }}
    >
      {visible ? (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 5.2A9.8 9.8 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.1 4" />
          <path d="M6.6 6.6A17 17 0 0 0 2.5 12s3.5 7 9.5 7a9.8 9.8 0 0 0 4.2-.9" />
          <path d="M9.9 9.9A3 3 0 0 0 14.1 14.1" />
        </>
      )}
    </svg>
  )
}

function PasswordStrength({ password }) {
  if (!password) return null

  const hasLength = password.length >= 8
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasNumber = /\d/.test(password)
  const hasSpecial = /[@$!%*?&.#_-]/.test(password)

  const score = [
    hasLength,
    hasLower,
    hasUpper,
    hasNumber,
    hasSpecial,
  ].filter(Boolean).length

  const levels = [
    { label: 'Very Weak', color: '#e74c3c' },
    { label: 'Weak', color: '#e74c3c' },
    { label: 'Fair', color: '#f39c12' },
    { label: 'Good', color: '#f1c40f' },
    { label: 'Strong', color: '#2ecc71' },
    { label: 'Very Strong', color: '#27ae60' },
  ]

  const level = levels[score]

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= score ? level.color : '#e5e7eb',
            }}
          />
        ))}
      </div>

      <p style={{ fontSize: 11, color: level.color, margin: 0 }}>
        {level.label}
      </p>
    </div>
  )
}

function IconInput({ icon, error, ...props }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm pointer-events-none">
        {icon}
      </span>
      <input {...props} className={(error ? inputError : inputNormal) + " pl-8"} />
    </div>
  );
}

function PasswordRequirements({ password }) {
  const requirements = [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /\d/.test(password) },
    { label: 'One special character (@$!%*?&.#_-)', met: /[@$!%*?&.#_-]/.test(password) },
  ]

  return (
    <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
      {requirements.map((req) => (
        <li
          key={req.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: req.met ? '#27ae60' : '#9ca3af',
            marginBottom: 2,
          }}
        >
          <span>{req.met ? '✓' : '○'}</span>
          <span>{req.label}</span>
        </li>
      ))}
    </ul>
  )
}

function StepBar({ current }) {
  return (
    <div className="flex gap-0 mb-6">
      {STEPS.map((label, i) => {
        const idx = i + 1;
        const done = idx < current;
        const active = idx === current;
        return (
          <div key={label} className="flex-1 flex flex-col items-center gap-1">
            <div className={`h-1 w-full rounded-sm transition-all duration-300 ${done || active ? "bg-orange-400" : "bg-gray-200"}`} />
            <span className={`text-[10px] ${active ? "text-blue-600 font-semibold" : done ? "text-orange-400" : "text-gray-400"}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FooterLinks() {
  return (
    <div className="text-center text-xs text-gray-500 mt-4 leading-7">
      Already have an account?{" "}
      <Link to="/login" className="text-blue-600 font-semibold hover:underline">Log in here</Link>
      <br />
      <Link to="/" className="text-gray-400 hover:underline">← Back to Portal</Link>
    </div>
  );
}

/* ── STEP 1 ── */
function Step1({ data, setData, onNext }) {
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!data.firstName.trim()) {
      e.firstName = "First name is required.";
    } else if (!NAME_REGEX.test(data.firstName.trim())) {
      e.firstName = "Invalid first name.";
    }

    if (!data.lastName.trim()) {
      e.lastName = "Last name is required.";
    } else if (!NAME_REGEX.test(data.lastName.trim())) {
      e.lastName = "Invalid last name.";
    }

    if (
      data.middleName.trim() &&
      !NAME_REGEX.test(data.middleName.trim())
    ) {
      e.middleName = "Invalid middle name.";
    }
    if (!data.sex) e.sex = "Please select a sex.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validate()) onNext(); };

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First Name" required error={errors.firstName}>
          <input
            className={errors.firstName ? inputError : inputNormal}
            placeholder="First name"
            value={data.firstName}
            maxLength={30}
            onChange={(e) => {
              const value = e.target.value
              if (/^[A-Za-z\s'-]*$/.test(value)) {
                setData({ ...data, firstName: value })
                setErrors({ ...errors, firstName: "" })
              }
            }}
          />
        </Field>
        <Field label="Last Name" required error={errors.lastName}>
          <input
            className={errors.lastName ? inputError : inputNormal}
            placeholder="Last name"
            value={data.lastName}
            maxLength={30}
            onChange={(e) => {
              const value = e.target.value
              if (/^[A-Za-z\s'-]*$/.test(value)) {
                setData({ ...data, lastName: value })
                setErrors({ ...errors, lastName: "" })
              }
            }}
          />
        </Field>
      </div>

      <Field label="Middle Name">
        <input
          className={inputNormal}
          placeholder="Middle name"
          value={data.middleName}
          maxLength={30}
          onChange={(e) => {
            const value = e.target.value

            if (/^[A-Za-z\s'-]*$/.test(value)) {
              setData({ ...data, middleName: value })
            }
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Suffix">
          <select className={selectNormal} value={data.suffix} onChange={(e) => setData({ ...data, suffix: e.target.value })}>
            <option value="">None</option>
            <option>Jr.</option>
            <option>Sr.</option>
            <option>II</option>
            <option>III</option>
            <option>IV</option>
          </select>
        </Field>
        <Field label="Sex" required error={errors.sex}>
          <select
            className={errors.sex ? selectError : selectNormal}
            value={data.sex}
            onChange={(e) => { setData({ ...data, sex: e.target.value }); setErrors({ ...errors, sex: "" }); }}
          >
            <option value="" disabled selected>Select</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
          </select>
        </Field>
      </div>

      <button onClick={handleNext} className="w-full h-11 bg-orange-400 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold mt-2 transition flex items-center justify-center gap-2">
        Next Step →
      </button>
      <FooterLinks />
    </>
  );
}

/* ── STEP 2 ── */
function Step2({ data, setData, onNext, onBack }) {
  const [errors, setErrors] = useState({});

  const validate = () => {
    const e = {};
    if (!data.studentNo.trim()) {
      e.studentNo = "Student number is required.";
    } else if (!STUDENT_NUMBER_REGEX.test(data.studentNo.trim())) {
      e.studentNo = "Format must be YYYY-100-N or YYYY-200-N.";
    }

    if (!data.yearLevel) {
      e.yearLevel = "Please select a year level.";
    }

    const sectionNum = Number(data.section);

    if (!data.section.trim()) {
      e.section = "Section is required.";
    } else if (
      !Number.isInteger(sectionNum) ||
      sectionNum < 1 ||
      sectionNum > 99
    ) {
      e.section = "Section must be between 1 and 99.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => { if (validate()) onNext(); };

  return (
    <>
      <Field label="Student Number" required error={errors.studentNo}>
        <input
          className={errors.studentNo ? inputError : inputNormal}
          placeholder="e.g. 2026-100-1234"
          value={data.studentNo}
          maxLength={15}
          onChange={(e) => {
            const value = e.target.value;
            if (/^[0-9-]*$/.test(value)) {
              setData({ ...data, studentNo: value });
              setErrors({ ...errors, studentNo: "" });
            }
          }}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Year Level" required error={errors.yearLevel}>
          <select
            className={errors.yearLevel ? selectError : selectNormal}
            value={data.yearLevel}
            onChange={(e) => { setData({ ...data, yearLevel: e.target.value }); setErrors({ ...errors, yearLevel: "" }); }}
          >
            <option value="">Select</option>
            <option>1st Year</option>
            <option>2nd Year</option>
            <option>3rd Year</option>
            <option>4th Year</option>
          </select>
        </Field>
        <Field label="Section" required error={errors.section}>
          <input
            className={errors.section ? inputError : inputNormal}
            placeholder="e.g. 1"
            value={data.section}
            maxLength={2}
            onChange={(e) => {
              const value = e.target.value
              if (/^\d*$/.test(value)) {
                setData({ ...data, section: value })
                setErrors({ ...errors, section: "" })
              }
            }}
          />
        </Field>
      </div>

      <div className="flex gap-2 mt-2">
        <button onClick={onBack} className="h-11 px-5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-1">
          ← Back
        </button>
        <button onClick={handleNext} className="flex-1 h-11 bg-orange-400 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2">
          Next Step →
        </button>
      </div>
      <FooterLinks />
    </>
  );
}

/* ── STEP 3 ── */
function Step3({ data, setData, onBack, onSubmit, serverError }) {
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  const validate = () => {
    const e = {};
    if (!data.hasCvsuEmail) {
      if (!data.email.trim()) e.email = "Email address is required.";
      else if (!/\S+@\S+\.\S+/.test(data.email)) e.email = "Enter a valid email address.";
    }
    if (data.hasCvsuEmail) {
      if (!data.cvsuEmail.trim()) e.cvsuEmail = "CvSU email is required.";
      else if (!data.cvsuEmail.endsWith("@cvsu.edu.ph")) e.cvsuEmail = "Must be a valid @cvsu.edu.ph email.";
    }
    if (!data.password) {
      e.password = "Password is required.";
    } else if (!PASSWORD_REGEX.test(data.password)) {
      e.password =
        "Password must contain uppercase, lowercase, number, special character, and be at least 8 characters.";
    }
    if (!data.confirmPassword) e.confirmPassword = "Please confirm your password.";
    else if (data.password !== data.confirmPassword) e.confirmPassword = "Passwords do not match.";
    if (!data.consent) e.consent = "You must agree before submitting.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => { if (validate()) onSubmit(); };

  return (
    <>
     {/**  <Field label="Email Address" required hint="This will be your login email address." error={errors.email}>
        <IconInput
          type="email"
          placeholder={data.hasCvsuEmail ? "Not required" : "Email address"}
          error={errors.email}
          value={data.email}
          disabled={data.hasCvsuEmail}
          maxLength={254}
          onChange={(e) => { setData({ ...data, email: e.target.value }); setErrors({ ...errors, email: "" }); }}
        />
      </Field>  */}

      {/**{data.hasCvsuEmail && (
        <Field label="CvSU Email" required error={errors.cvsuEmail}>
          <IconInput
            type="email"
            placeholder="name@cvsu.edu.ph"
            error={errors.cvsuEmail}
            value={data.cvsuEmail}
            maxLength={254}
            onChange={(e) => { setData({ ...data, cvsuEmail: e.target.value }); setErrors({ ...errors, cvsuEmail: "" }); }}
          />
        </Field>
      )}*/}

      <Field label={data.hasCvsuEmail ? "CvSU Email" : "Personal Email"} required
        hint={ data.hasCvsuEmail ? "Use your official CvSU email." : "Use your personal email if you don't have a CvSU email." }
        error={data.hasCvsuEmail ? errors.cvsuEmail : errors.email} >
        <IconInput type="email" placeholder={ data.hasCvsuEmail ? "juan.delacruz@cvsu.edu.ph" : "example@gmail.com"}
          value={data.hasCvsuEmail ? data.cvsuEmail : data.email}
          error={data.hasCvsuEmail ? errors.cvsuEmail : errors.email}
          maxLength={254}
          onChange={(e) => {
            if (data.hasCvsuEmail) {
              setData({ ...data, cvsuEmail: e.target.value });
              setErrors({ ...errors, cvsuEmail: "" });
            } else {
              setData({ ...data, email: e.target.value });
              setErrors({ ...errors, email: "" });
            }
          }}
        />
      </Field>

      <div className="flex items-start gap-2 text-xs text-gray-500 mb-3">
        {/**<input
          type="checkbox"
          id="cvsuCheck"
          className="mt-0.5 accent-blue-600"
          checked={data.hasCvsuEmail}
          onChange={(e) => setData({ ...data, hasCvsuEmail: e.target.checked, cvsuEmail: "" })}
        />
        <label htmlFor="cvsuCheck" className="cursor-pointer">
          I have a CvSU email address (e.g. <em>name@cvsu.edu.ph</em>)
        </label>*/}
        <input type="checkbox" id="cvsuCheck" className="mt-0.5 accent-blue-600" checked={!data.hasCvsuEmail}
          onChange={(e) => setData({...data, hasCvsuEmail: !e.target.checked, email: "", cvsuEmail: ""})}/>

        <label htmlFor="cvsuCheck"> I don't have a CvSU email </label>
      </div>

      <Field label="Password" required error={errors.password}>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            className={errors.password ? inputError : inputNormal}
            placeholder="Minimum 8 characters"
            value={data.password}
            maxLength={72}
            onChange={(e) => {
              setData({ ...data, password: e.target.value })
              setErrors({ ...errors, password: "" })
            }}
          />

          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute right-3 top-0 h-10 flex items-center justify-center text-gray-500"
          >
            <EyeIcon visible={showPassword} />
          </button>
        </div>

        <PasswordStrength password={data.password} />
        {data.password && <PasswordRequirements password={data.password} />}
      </Field>

      <Field label="Confirm Password" required error={errors.confirmPassword}>
        <div className="relative">
          <input
            type={showConfirmPassword ? "text" : "password"}
            className={errors.confirmPassword ? inputError : inputNormal}
            placeholder="Re-enter your password"
            value={data.confirmPassword}
            maxLength={72}
            onChange={(e) => {
              setData({ ...data, confirmPassword: e.target.value })
              setErrors({ ...errors, confirmPassword: "" })
            }}
          />

          <button
            type="button"
            onClick={() => setShowConfirmPassword(v => !v)}
            className="absolute right-3 top-0 h-10 flex items-center justify-center text-gray-500"
          >
            <EyeIcon visible={showConfirmPassword} />
          </button>
        </div>

        {data.password && data.confirmPassword && (
          <p
            className={`text-xs mt-1 ${data.password === data.confirmPassword
              ? "text-green-600"
              : "text-red-500"
              }`}
          >
            {data.password === data.confirmPassword
              ? "✓ Passwords match"
              : "✗ Passwords do not match"}
          </p>
        )}
      </Field>

      <div className="mb-3">
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            id="consent"
            className="mt-0.5 accent-blue-600"
            checked={data.consent}
            onChange={(e) => { setData({ ...data, consent: e.target.checked }); setErrors({ ...errors, consent: "" }); }}
          />
          <label htmlFor="consent" className="cursor-pointer">
            I confirm that all information is accurate and consent to data collection for LITL.
          </label>
        </div>
        {errors.consent && <p className="text-xs text-red-500 mt-1 ml-5">{errors.consent}</p>}
      </div>

      <div className="flex gap-2 mt-2">
        <button onClick={onBack} className="h-11 px-5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition flex items-center gap-1">
          ← Back
        </button>
        <button onClick={handleSubmit} className="flex-1 h-11 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2">
          Submit Registration
        </button>
      </div>
      {serverError && <p className="text-xs text-red-500 text-center mt-3">{serverError}</p>}
      <FooterLinks />
    </>
  );
}

/* ── ROOT ── */
export default function Registration() {
  const navigate = useNavigate()

  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  
  // Is there an email verification still in progress (cookie-backed)?
  const [pendingVerification, setPendingVerification] = useState(null);
  useEffect(() => {
    getPendingRegistration()
      .then(setPendingVerification)
      .catch(() => {}); // 404 = nothing pending
  }, []);

  const [personal, setPersonal] = useState({ firstName: "", lastName: "", middleName: "", suffix: "", sex: "" });
  const [additional, setAdditional] = useState({ studentNo: "", yearLevel: "", section: "" });
  const [account, setAccount] = useState({email: "", hasCvsuEmail: true, cvsuEmail: "", password: "", confirmPassword: "", consent: false});

  const reset = () => {
    setStep(1);
    setSubmitted(false);
    setIsSubmitting(false);
    setServerError("");
    setPersonal({ firstName: "", lastName: "", middleName: "", suffix: "", sex: "" });
    setAdditional({ studentNo: "", yearLevel: "", section: "" });
    setAccount({email: "", hasCvsuEmail: true, cvsuEmail: "", password: "", confirmPassword: "", consent: false});
  };

  const handleRegistrationSubmit = async () => {
    setIsSubmitting(true);
    setServerError("");

    const payload = {
      firstName: personal.firstName,
      middleName: personal.middleName,
      lastName: personal.lastName,
      suffix: personal.suffix,
      sex: personal.sex,
      studentNumber: additional.studentNo,
      yearLevel: additional.yearLevel,
      section: additional.section,
      hasCvsuEmail: account.hasCvsuEmail,
      email: account.hasCvsuEmail
        ? account.cvsuEmail.trim()
        : account.email.trim(),
      password: account.password,
      confirmPassword: account.confirmPassword,
    };

    try {
      const data = await registerUser(payload);

      navigate('/otp', { state: { verificationToken: data.verificationToken, purpose: 'EMAIL_VERIFICATION',email: payload.email} });
    } catch (error) {
      setServerError(
        error.response?.data?.message || "Something went wrong. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <AuthHeader actionLabel="Sign In" actionTo="/login" />

      <section className="auth-page auth-content">
        <section className="auth-card" aria-labelledby="auth-title">
          <h1 id="auth-title">Student Registration</h1>

          <p className="text-xs text-gray-500 text-center mb-5" style={{ margin: '0 0 18px', fontSize: 12, color: '#6d6d6d' }}>Create your account to access LITL </p>
          {pendingVerification && (
            <p className="form-message" style={{ fontSize: 13, margin: '0 0 16px', textAlign: 'center' }}>
              You have a verification in progress for <strong>{pendingVerification.email}</strong>.{' '}
              <Link to="/otp" style={{ fontWeight: 600 }}>Continue verification</Link>
            </p>
          )}
          <StepBar current={step} />
          {submitted ? (
            <div className="text-center">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Registration Submitted!</h2>
              <p className="text-sm text-gray-500">Thank you, <strong>{personal.firstName} {personal.lastName}</strong>. Your account is being reviewed.</p>
              <button onClick={reset} className="mt-6 text-sm text-blue-600 hover:underline">← Register another account</button>
            </div>
          ) : (
            <>
              {step === 1 && <Step1 data={personal} setData={setPersonal} onNext={() => setStep(2)} />}
              {step === 2 && <Step2 data={additional} setData={setAdditional} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
              {step === 3 && (
                <Step3
                  data={account}
                  setData={setAccount}
                  onBack={() => setStep(2)}
                  onSubmit={handleRegistrationSubmit}
                  isSubmitting={isSubmitting}
                  serverError={serverError}
                />
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
