import { useState } from 'react'
import DashboardHeader from '../../../components/officers/DashboardHeader.jsx'
import FundReport from './FundReport.jsx'
import Disbursement from './Disbursement.jsx'
import Returning from './Returning.jsx'

const financialSections = [
  { id: 'fund-report', label: 'Fund Report' },
  { id: 'disbursement', label: 'Disbursement' },
  { id: 'returning', label: 'Returning' },
]

export default function Financial({ initialSection = 'fund-report' }) {
  const [activeSection, setActiveSection] = useState(initialSection)

  return (
    <>
      <DashboardHeader page="financial" />

      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Financial sections">
          {financialSections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`settings-nav__item ${activeSection === section.id ? 'settings-nav__item--active' : ''}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className="settings-nav__label">{section.label}</span>
            </button>
          ))}
        </nav>

        <div className="settings-panel">
          {activeSection === 'fund-report' && <FundReport showHeader={false} />}
          {activeSection === 'disbursement' && <Disbursement showHeader={false} />}
          {activeSection === 'returning' && <Returning showHeader={false} />}
        </div>
      </div>
    </>
  )
}
