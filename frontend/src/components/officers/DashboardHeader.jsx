import { pageDetails } from "../../data/officers/dashboardData";

export default function DashboardHeader({ page, actions }) {
    const details = pageDetails[page] ?? pageDetails.dashboard;

    return (
        <div className="dash__header">
            <div>
                <p className="dash__eyebrow">{details.eyebrow}</p>
                <h1 className="dash__title">{details.title}</h1>
                <p className="dash__subtitle">{details.subtitle}</p>
            </div>
            {actions && <div className="dash__header-actions">{actions}</div>}
        </div>
    );
}
