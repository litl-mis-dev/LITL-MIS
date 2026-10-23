import { useState, useEffect } from "react";
import "../../assets/styles/members/MemberDashboard.css";

const TEMP_MEMBER = {
  name: "Juan dela Cruz",
  email: "juan.delacruz@cvsu.edu.ph",
};

export default function Settings() {
  const [member, setMember]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    fetch("/api/member/me")
      .then((res) => res.json())
      .then((data) => { setMember(data); setLoading(false); })
      .catch(() => { setMember(TEMP_MEMBER); setLoading(false); });
  }, []);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return <p style={{ color: "#64748b", fontSize: 14 }}>Loading settings...</p>;
  if (!member)  return <p style={{ color: "#64748b", fontSize: 14 }}>Could not load settings.</p>;

  return (
    <>
      {/* Temporary data banner */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "#fffbeb", border: "1px solid #fcd34d",
        borderLeft: "4px solid #f59e0b", borderRadius: 8,
        padding: "10px 16px", marginBottom: 20, fontSize: 13, color: "#92400e",
      }}>
        ⚠️ <span>Showing temporary data — connect to the API to load real settings.</span>
      </div>

      <div className="dash__header">
        <div>
          <p className="dash__eyebrow">Account</p>
          <h1 className="dash__title">Settings</h1>
          <p className="dash__subtitle">Manage your account preferences.</p>
        </div>
      </div>

      <div style={{ display: "grid", gap: 20, maxWidth: 720 }}>

        {/* Change Password */}
        <section className="member-card">
          <p className="member-card__eyebrow">Security</p>
          <h2 className="member-card__title" style={{ fontSize: 18, marginTop: 8 }}>Change Password</h2>
          <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
            {["Current Password", "New Password", "Confirm New Password"].map((label) => (
              <div key={label} className="dash-form__field">
                <label>{label}</label>
                <input type="password" placeholder="••••••••" />
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
              {saved && <span style={{ alignSelf: "center", color: "#16a34a", fontSize: 13, fontWeight: 700 }}>✓ Saved</span>}
              <button className="btn btn--primary" onClick={handleSave}>Update Password</button>
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section className="member-card">
          <p className="member-card__eyebrow">Notifications</p>
          <h2 className="member-card__title" style={{ fontSize: 18, marginTop: 8 }}>Preferences</h2>
          <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
            {[
              { label: "New events",    desc: "Get notified when a new event is posted" },
              { label: "New documents", desc: "Get notified when a document is uploaded" },
            ].map(({ label, desc }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "#111827" }}>{label}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 13, color: "#64748b" }}>{desc}</p>
                </div>
                <input type="checkbox" defaultChecked style={{ width: 18, height: 18, accentColor: "#4f46e5", cursor: "pointer" }} />
              </div>
            ))}
          </div>
        </section>

      </div>
    </>
  );
}
