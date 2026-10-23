import { useNavigate } from "react-router-dom";
import DashboardHeader from "../../components/officers/DashboardHeader.jsx";

export default function SwitchDashboard() {
    const navigate = useNavigate();

    return (
        <>
            <DashboardHeader page="switch-dashboard" />

            <div className="switch-dashboard-grid">
                <section className="card switch-dashboard-card switch-dashboard-card--active">
                    <div>
                        <p className="switch-dashboard-card__eyebrow">Current Workspace</p>
                        <h2 className="switch-dashboard-card__title">Officer Dashboard</h2>
                        <p className="switch-dashboard-card__text">
                            Manage members, funds, events, documents, audit trails, and officer activity.
                        </p>
                    </div>
                    <button type="button" className="btn btn--outline" disabled>
                        Active Dashboard
                    </button>
                </section>

                <section className="card switch-dashboard-card">
                    <div>
                        <p className="switch-dashboard-card__eyebrow">Switch To</p>
                        <h2 className="switch-dashboard-card__title">Member Dashboard</h2>
                        <p className="switch-dashboard-card__text">
                            View the member-facing workspace for profile, QR code, events, and documents.
                        </p>
                    </div>
                    <button type="button" className="btn btn--primary" onClick={() => navigate("/members")}>
                        Switch Dashboard
                    </button>
                </section>
            </div>
        </>
    );
}
