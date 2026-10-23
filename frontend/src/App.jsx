import { Navigate, Route, Routes } from 'react-router-dom'
import './App.css'

import DashboardLayout from './pages/officers/DashboardLayout'
import MembersLayout from './pages/Members/MembersLayout'

import ProtectedRoute from './routes/ProtectedRoute'
import PublicRoute from './routes/PublicRoute'

import { authRoutes } from './routes/AuthRoutes'
import { officersRoutes } from './routes/OfficersRoutes'
import { memberRoutes } from './routes/MemberRoutes'
import { OFFICER_ROLES, MEMBER_SIDE_ROLES } from './utils/roles'

function App() {
  return (
    <Routes>
      {/* Public routes — redirect to home if already logged in */}
      {authRoutes.map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={<PublicRoute>{route.element}</PublicRoute>}
        />
      ))}

      {/* Officer section */}
      <Route
        path="/officers"
        element={
          <ProtectedRoute allowedRoles={OFFICER_ROLES}>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/officers/dashboard" replace />} />
        {officersRoutes.map((route) => (
          <Route
            key={route.path}
            path={route.path}
            element={
              route.module ? (
                <ProtectedRoute requiredModule={route.module} requiredLevel="VIEW">
                  {route.element}
                </ProtectedRoute>
              ) : (
                route.element
              )
            }
          />
        ))}
      </Route>

      {/* Member section */}
      <Route
        path="/members"
        element={
          <ProtectedRoute allowedRoles={['MEMBER', ...MEMBER_SIDE_ROLES]}>
            <MembersLayout />
          </ProtectedRoute>
        }
      >
        {memberRoutes.map((route) => (
          <Route
            key={route.index ? 'members-index' : route.path}
            index={route.index}
            path={route.path}
            element={route.element}
          />
        ))}
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
