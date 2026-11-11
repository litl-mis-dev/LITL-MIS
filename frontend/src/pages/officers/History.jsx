import DashboardHeader from "../../components/officers/DashboardHeader.jsx";
import ArchiveSettings from "./settings/ArchiveSettings.jsx";

// History ▸ Archive — past semesters' financial records, read-only. Anyone
// with Financial view access may open it (route guard in
// routes/OfficersRoutes.jsx; the archive API requires the same).
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
