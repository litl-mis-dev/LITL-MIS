import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import { createMembershipCardPreview } from "../../utils/downloadMembershipCardPdf.js";
import "../../assets/styles/members/MemberDashboard.css";

export default function QRCode({ member, qrCodeUrl, memberId }) {
  const { user } = useAuth();
  const identity = useMemo(
    () => getMemberIdentity(member ?? user, { memberId, qrCodeUrl }),
    [member, memberId, qrCodeUrl, user]
  );
  const [previewUrl, setPreviewUrl] = useState("");
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let isMounted = true;

    setIsRendering(true);
    createMembershipCardPreview(identity)
      .then((dataUrl) => {
        if (isMounted) setPreviewUrl(dataUrl);
      })
      .catch(() => {
        if (isMounted) setPreviewUrl("");
      })
      .finally(() => {
        if (isMounted) setIsRendering(false);
      });

    return () => {
      isMounted = false;
    };
  }, [identity]);

  return (
    <>
      <div className="dash__header">
        <div>
          <p className="dash__eyebrow">Digital ID</p>
          <h1 className="dash__title">Membership Card</h1>
          <p className="dash__subtitle">Present this digital ID for verification and event check-in.</p>
        </div>
      </div>

      <section className="member-card member-card-preview-section">
        {isRendering ? (
          <p className="card__sub">Loading membership card...</p>
        ) : previewUrl ? (
          <img className="member-card-preview" src={previewUrl} alt="Digital membership card" />
        ) : (
          <p className="card__sub">Membership card preview is unavailable.</p>
        )}
      </section>
    </>
  );
}

function getMemberIdentity(source, overrides = {}) {
  const authUser = source ?? {};
  const profile = authUser.member ?? authUser;
  const name = authUser.name || [profile.firstName, profile.middleName, profile.lastName, profile.suffix]
    .filter(Boolean)
    .join(" ");
  const yearLevel = authUser.yearLevel || profile.yearLevel || "";
  const section = authUser.section || profile.section || "";
  const displayId =
    overrides.memberId ||
    authUser.studentNumber ||
    profile.studentNumber ||
    authUser.memberId ||
    profile.memberId ||
    profile.id ||
    authUser.id ||
    "";

  return {
    ...authUser,
    ...profile,
    id: authUser.id || profile.id,
    userId: authUser.userId || profile.userId || authUser.id,
    name: name || "Member",
    fullName: name || "Member",
    avatar: authUser.avatar || profile.avatar || "",
    studentNumber: String(displayId || "").trim(),
    memberId: String(displayId || "").trim(),
    program: authUser.program || profile.program || profile.course || "BS Information Technology",
    course: authUser.program || profile.program || profile.course || "BS Information Technology",
    yearLevel,
    section,
    qrCode: overrides.qrCodeUrl || authUser.qrCode || profile.qrCode || "",
  };
}
