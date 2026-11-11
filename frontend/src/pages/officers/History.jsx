import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import ArchiveSettings from "./settings/ArchiveSettings.jsx";

// History ▸ Archive — past semesters' financial records. Same access as the
// Archive had under Settings: Financial edit access (route guard in
// routes/OfficersRoutes.jsx, enforced by the archive API as well).
export default function History() {
    return (
        <>
            <DashboardHeader page="history" />

            <section className="card settings-panel">
                <div className="card__header">
                    <div>
                        <h2 className="card__title">Archive</h2>
                        <p className="card__sub">Financial records by academic year.</p>
                    </div>
                </div>

                <ArchiveSettings />
            </section>
        </>
    );
}
