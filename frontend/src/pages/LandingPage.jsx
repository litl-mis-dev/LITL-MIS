import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { submitContactForm } from "../services/contact.service.js";
import { getPublicOfficerRoster } from "../services/officer.service.js";
import logo from "../assets/images/LogoAndText.png";
import heroImage from "../assets/images/LogoAndText.png";
import "../assets/styles/LandingPage.css";

const NAV_LINKS = [
  { label: "Home", id: "home" },
  { label: "About", id: "about" },
  { label: "Officers", id: "officers" },
  { label: "Verify", id: "verify" },
  { label: "Updates", id: "updates" },
  { label: "Contact", id: "contact" },
];

const FEATURES = [
  {
    eyebrow: "Community",
    title: "Built around student leadership",
    text: "LITL supports Cavite State University IT students through organization work, activities, and shared opportunities.",
  },
  {
    eyebrow: "Verification",
    title: "Public certificate checks",
    text: "Visitors can confirm official LITL certificates by scanning a QR code or entering the printed certificate ID.",
  },
  {
    eyebrow: "Updates",
    title: "Official announcements",
    text: "Important reminders and activity posts are kept close to the channels students already follow.",
  },
];

const CONTACT_ITEMS = [
  { label: "Email", value: "litl.external@gmail.com", href: "mailto:litl.external@gmail.com" },
  { label: "Facebook", value: "facebook.com/LITLcvsu13", href: "https://www.facebook.com/LITLcvsu13" },
];

const OFFICER_PLACEHOLDERS = Array.from({ length: 4 }, (_, index) => ({
  id: `placeholder-${index + 1}`,
  name: `Officer Name ${index + 1}`,
  position: "Officer Position",
  avatar: "",
}));

const AFFILIATION_OPTIONS = [
  { id: "member", label: "LITL Member", sublabel: "Student", placeholder: "e.g. 202310123 / BSIT 3-1", labelText: "Student Number / Section (Optional)" },
  { id: "faculty", label: "Faculty / Instructor", sublabel: "CvSU Faculty", placeholder: "e.g. Department of Information Technology", labelText: "Department / College (Optional)" },
  { id: "inside_org", label: "Inside Organization", sublabel: "CvSU Org / Council", placeholder: "e.g. CSG, YMG, ISIP, LYHR,, etc.", labelText: "Organization / Council Name" },
  { id: "outside_org", label: "Outside Organization", sublabel: "External Partner", placeholder: "e.g. Company, Sponsor, Partner Org", labelText: "Company / Organization Name" },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [officers, setOfficers] = useState([]);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    affiliation: "member",
    organization: "",
    subject: "",
    message: "",
  });
  const [formStatus, setFormStatus] = useState({ loading: false, success: false, error: "" });
  const navigate = useNavigate();
  const facebookPageUrl = "https://www.facebook.com/LITLcvsu13";
  const roster = officers.length > 0 ? officers : OFFICER_PLACEHOLDERS;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    let isMounted = true;

    getPublicOfficerRoster()
      .then(({ officers: roster }) => {
        if (!isMounted) return;
        setOfficers(roster ?? []);
      })
      .catch(() => {
        if (!isMounted) return;
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const scrollTo = (id) => {
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    setMenuOpen(false);
  };

  const handleFormChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();

    if (!formData.name || !formData.email || !formData.subject || !formData.message) {
      setFormStatus({ loading: false, success: false, error: "Please complete all fields before sending." });
      return;
    }

    setFormStatus({ loading: true, success: false, error: "" });

    try {
      await submitContactForm(formData);

      setFormData({ name: "", email: "", affiliation: "member", organization: "", subject: "", message: "" });
      setFormStatus({ loading: false, success: true, error: "" });
      window.setTimeout(() => setFormStatus({ loading: false, success: false, error: "" }), 5000);
    } catch (err) {
      setFormStatus({
        loading: false,
        success: false,
        error: err?.response?.data?.message || "Something went wrong. Please try again later.",
      });
    }
  };

  return (
    <div className="landing-page">
      <nav className={`landing-nav ${scrolled ? "landing-nav-scrolled" : ""}`}>
        <div className="landing-nav-inner">
          <button className="landing-brand" type="button" onClick={() => scrollTo("home")} aria-label="Go to home">
            <img src={logo} alt="League of Information Technology Leaders" />
          </button>

          <div className="landing-nav-links">
            {NAV_LINKS.map((link) => (
              <button key={link.id} type="button" onClick={() => scrollTo(link.id)}>
                {link.label}
              </button>
            ))}
            <button className="landing-login-button" type="button" onClick={() => navigate("/login")}>
              Login
            </button>
          </div>

          <button
            className="landing-menu-button"
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>

        {menuOpen && (
          <div className="landing-mobile-menu">
            {NAV_LINKS.map((link) => (
              <button key={link.id} type="button" onClick={() => scrollTo(link.id)}>
                {link.label}
              </button>
            ))}
            <button type="button" className="landing-mobile-login" onClick={() => navigate("/login")}>
              Login
            </button>
          </div>
        )}
      </nav>

      <main>
        <section id="home" className="landing-hero">
          <div className="landing-shell landing-hero-grid">
            <div className="landing-hero-copy">
              <p className="landing-kicker">Cavite State University</p>
              <h1>League of Information Technology Leaders TEST3</h1>
              <p className="landing-hero-text">
                The official digital home for LITL announcements, certificate verification,
                organization details, and ways to reach the officers.
              </p>
              <div className="landing-hero-actions">
                <button type="button" className="landing-primary-action" onClick={() => scrollTo("about")}>
                  About LITL
                </button>
                <button type="button" className="landing-secondary-action" onClick={() => scrollTo("contact")}>
                  Contact officers
                </button>
              </div>
            </div>

            <div className="landing-hero-panel" aria-label="LITL identity">
              <img className="landing-hero-mark" src={heroImage} alt="" />
              <div className="landing-hero-badge">
                <span>Cavite State University</span>
                <strong>League of Information Technology Leaders</strong>
              </div>
            </div>
          </div>
        </section>

        <section id="about" className="landing-section">
          <div className="landing-shell">
            <div className="landing-section-heading">
              <p className="landing-kicker">About the system</p>
              <h2>Built for the way student organizations actually work</h2>
              <p>
                LITL MIS keeps public information clean and easy to reach, from organization details
                and announcements to official certificate verification.
              </p>
            </div>

            <div className="landing-feature-grid">
              {FEATURES.map((feature) => (
                <article className="landing-feature-card" key={feature.title}>
                  <span>{feature.eyebrow}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="officers" className="landing-section landing-officers-section">
          <div className="landing-shell">
            <div className="landing-section-heading">
              <p className="landing-kicker">Current leadership</p>
              <h2>Meet the LITL officers</h2>
              <p>Our active officers are listed here by their current organization role.</p>
            </div>

            <div className="landing-officers-grid">
              {roster.map((officer) => (
                <article className="landing-officer-card" key={officer.id ?? officer.position}>
                  {officer.avatar ? (
                    <img className="landing-officer-avatar" src={officer.avatar} alt={`Portrait of ${officer.name}`} />
                  ) : (
                    <span className="landing-officer-avatar landing-officer-avatar-fallback" aria-hidden="true">
                      {getInitials(officer.name)}
                    </span>
                  )}
                  <div>
                    <p>{officer.position}</p>
                    <h3>{officer.name}</h3>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="verify" className="landing-section landing-verification-section">
          <div className="landing-shell landing-verification-cta">
            <div className="landing-verification-copy">
              <p className="landing-kicker">Certificate verification</p>
              <h2>Confirm an official LITL certificate</h2>
              <p>Use the public verification page to scan a QR code or enter the certificate ID printed on the document.</p>
            </div>
            <button type="button" className="landing-primary-action" onClick={() => navigate("/verify")}>Verify a certificate</button>
          </div>
        </section>

        <section id="updates" className="landing-section">
          <div className="landing-shell landing-updates-grid">
            <div>
              <p className="landing-kicker">Latest updates</p>
              <h2>Stay connected with LITL</h2>
              <p>
                Follow the official Facebook page for announcements, activity posts, and organization
                reminders.
              </p>
              <a className="landing-text-link" href={facebookPageUrl} target="_blank" rel="noreferrer">
                Visit Facebook page
              </a>
            </div>

            <div className="landing-facebook-frame">
              <iframe
                title="LITL Facebook page"
                src={`https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(facebookPageUrl)}&tabs=timeline&width=500&height=520&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true`}
                scrolling="no"
                frameBorder="0"
                allowFullScreen
                allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
              />
            </div>
          </div>
        </section>

        <section id="contact" className="landing-section landing-contact-section">
          <div className="landing-shell landing-contact-grid">
            <div>
              <p className="landing-kicker">Contact</p>
              <h2>Need help or have a question?</h2>
              <p>
                Send a message to the LITL officers or use the official contact channels below. We welcome inquiries from members, faculty, inside student organizations, and outside partners.
              </p>

              <div className="landing-distinction-tags">
                <span className="landing-distinction-tag">LITL Members</span>
                <span className="landing-distinction-tag">Faculty & Staff</span>
                <span className="landing-distinction-tag">Inside CvSU Orgs</span>
                <span className="landing-distinction-tag">Outside Partners</span>
              </div>

              <div className="landing-contact-list">
                {CONTACT_ITEMS.map((item) => (
                  <a href={item.href} key={item.label} target={item.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </a>
                ))}
              </div>
            </div>

            <form className="landing-contact-form" onSubmit={handleFormSubmit}>
              <label>
                <span>Category / Affiliation</span>
                <select
                  name="affiliation"
                  value={formData.affiliation}
                  onChange={handleFormChange}
                  required
                >
                  {AFFILIATION_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} — {option.sublabel}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>Name</span>
                <input name="name" value={formData.name} onChange={handleFormChange} placeholder="Your full name" required />
              </label>

              <label>
                <span>Email</span>
                <input type="email" name="email" value={formData.email} onChange={handleFormChange} placeholder="your.email@example.com" required />
              </label>

              {(() => {
                const currentOpt = AFFILIATION_OPTIONS.find((opt) => opt.id === formData.affiliation) || AFFILIATION_OPTIONS[0];
                return (
                  <label>
                    <span>{currentOpt.labelText}</span>
                    <input
                      name="organization"
                      value={formData.organization}
                      onChange={handleFormChange}
                      placeholder={currentOpt.placeholder}
                    />
                  </label>
                );
              })()}

              <label>
                <span>Subject</span>
                <input name="subject" value={formData.subject} onChange={handleFormChange} placeholder="What can we help with?" required />
              </label>

              <label>
                <span>Message</span>
                <textarea name="message" value={formData.message} onChange={handleFormChange} placeholder="Write your message here..." required />
              </label>

              {formStatus.error && <p className="landing-form-alert landing-form-error">{formStatus.error}</p>}
              {formStatus.success && <p className="landing-form-alert landing-form-success">Message received. We will get back to you soon.</p>}

              <button type="submit" className="landing-primary-action" disabled={formStatus.loading}>
                {formStatus.loading ? "Sending..." : "Send message"}
              </button>
            </form>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-shell landing-footer-inner">
          <p>&copy; {new Date().getFullYear()} League of Information Technology Leaders. All rights reserved.</p>
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Back to top
          </button>
        </div>
      </footer>
    </div>
  );
}

function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "L";
}
