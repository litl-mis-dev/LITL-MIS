import { useEffect, useRef, useState } from "react";
import DashboardHeader from "../../../components/officers/DashboardHeader.jsx";
import DocumentSettings from "./DocumentSettings.jsx";
import MembershipCardSettings from "./MembershipCardSettings.jsx";
import MembershipCertificateSettings from "./MembershipCertificateSettings.jsx";
import ManageRolesSettings from "./ManageRolesSettings.jsx";
import AdviserSettings from "./AdviserSettings.jsx";
import { useRole } from "../../../utils/useRole.js";
import { useAuth } from "../../../context/AuthContext";

export default function Settings() {
    const { can } = useRole();
    // The Archive moved to its own History page (pages/officers/History.jsx).
    const canSeeRoles    = can("SETTINGS_ROLES", "VIEW");
    const canSeeDesign   = can("SETTINGS_DESIGN", "VIEW");
    // Inviting and managing advisers is the President's alone (enforced by the server too).
    const { user } = useAuth();
    const canSeeAdvisers = user?.role === "PRESIDENT_ADMIN";

    const [activeSection, setActiveSection] = useState(
        canSeeRoles ? "roles" : canSeeAdvisers ? "advisers" : canSeeDesign ? "disbursement" : ""
    );
    const [isDocumentsOpen, setIsDocumentsOpen] = useState(false);
    const documentsRef = useRef(null);
    const panelMeta = getPanelMeta(activeSection);

    useEffect(() => {
        if (!isDocumentsOpen) return;

        function handleOutsidePointer(event) {
            if (!documentsRef.current?.contains(event.target)) {
                setIsDocumentsOpen(false);
            }
        }

        document.addEventListener("pointerdown", handleOutsidePointer);
        return () => document.removeEventListener("pointerdown", handleOutsidePointer);
    }, [isDocumentsOpen]);

    return (
        <>
            <DashboardHeader page="settings" />

            <div className="settings-shell">
                <nav className="settings-nav" aria-label="Settings sections">
                    {canSeeRoles && (
                        <button
                            type="button"
                            className={`settings-nav__item ${activeSection === "roles" ? "settings-nav__item--active" : ""}`}
                            onClick={() => setActiveSection("roles")}
                        >
                            <span className="settings-nav__label">Manage Roles</span>
                        </button>
                    )}

                    {canSeeAdvisers && (
                        <button
                            type="button"
                            className={`settings-nav__item ${activeSection === "advisers" ? "settings-nav__item--active" : ""}`}
                            onClick={() => setActiveSection("advisers")}
                        >
                            <span className="settings-nav__label">Advisers</span>
                        </button>
                    )}

                    {canSeeDesign && (
                        <div className="settings-nav__dropdown" ref={documentsRef}>
                            <button
                                type="button"
                                className={`settings-nav__item ${activeSection === "disbursement" || activeSection === "membershipCertificate" ? "settings-nav__item--active" : ""}`}
                                onClick={() => setIsDocumentsOpen((open) => !open)}
                                aria-expanded={isDocumentsOpen}
                            >
                                <span className="settings-nav__label">Documents</span>
                                <span className="settings-nav__caret" aria-hidden="true">v</span>
                            </button>

                            {isDocumentsOpen && (
                                <div className="settings-nav__menu">
                                    <button
                                        type="button"
                                        className={`settings-nav__menu-item ${activeSection === "disbursement" ? "settings-nav__menu-item--active" : ""}`}
                                        onClick={() => {
                                            setActiveSection("disbursement");
                                            setIsDocumentsOpen(false);
                                        }}
                                    >
                                        Disbursement &amp; Return Fund
                                    </button>
                                    <button
                                        type="button"
                                        className={`settings-nav__menu-item ${activeSection === "membershipCertificate" ? "settings-nav__menu-item--active" : ""}`}
                                        onClick={() => {
                                            setActiveSection("membershipCertificate");
                                            setIsDocumentsOpen(false);
                                        }}
                                    >
                                        Membership Certificate
                                    </button>
                                    <button
                                        type="button"
                                        className={`settings-nav__menu-item ${activeSection === "membershipCard" ? "settings-nav__menu-item--active" : ""}`}
                                        onClick={() => {
                                            setActiveSection("membershipCard");
                                            setIsDocumentsOpen(false);
                                        }}
                                    >
                                        Membership Card
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </nav>

                <section className="card settings-panel">
                    <div className="card__header">
                        <div>
                            <h2 className="card__title">{panelMeta.title}</h2>
                            <p className="card__sub">{panelMeta.description}</p>
                        </div>
                    </div>

                    {activeSection === "roles" && canSeeRoles && <ManageRolesSettings />}
                    {activeSection === "advisers" && canSeeAdvisers && <AdviserSettings />}
                    {activeSection === "membershipCertificate" && canSeeDesign && <MembershipCertificateSettings />}
                    {activeSection === "membershipCard" && canSeeDesign && <MembershipCardSettings />}
                    {activeSection === "disbursement" && canSeeDesign && <DocumentSettings />}
                    {!activeSection && <p className="card__sub">You don't have access to any settings sections.</p>}
                </section>
            </div>
        </>
    );
}

function getPanelMeta(activeSection) {
    if (activeSection === "advisers") {
        return { title: "Advisers", description: "Invite and manage the Advisers and the Department Chair." };
    }
    if (activeSection === "roles") {
        return { title: "Manage Roles", description: "Assign officer roles to approved active members." };
    }
    if (activeSection === "membershipCertificate") {
        return { title: "Membership Certificate", description: "Upload the certificate of membership template used by member downloads." };
    }

    if (activeSection === "membershipCard") {
        return {
            title: "Membership Card",
            description: "Upload the ID card design used by membership card PDF downloads.",
        };
    }
    if (activeSection === "disbursement") {
        return { title: "Disbursement & Return Fund Template", description: "Upload a full A4 portrait template used as background for Disbursement and Return Fund documents." };
    }
    return { title: "", description: "" };
}
