import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import Layout from './components/Layout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import WorkOrdersPage from './pages/workorders/WorkOrdersPage.jsx'
import PMPage from './pages/pm/PMPage.jsx'
import AssetsPage from './pages/assets/AssetsPage.jsx'
import ReportsPage from './pages/reports/ReportsPage.jsx'
import SettingsPage from './pages/settings/SettingsPage.jsx'

function AuthGuard({ children }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  const { isAuthenticated } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/"
        element={<AuthGuard><Layout /></AuthGuard>}
      >
        <Route index element={<Navigate to="/work-orders" replace />} />
        <Route path="work-orders" element={<WorkOrdersPage />} />
        <Route path="pm" element={<PMPage />} />
        <Route path="assets" element={<AssetsPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
