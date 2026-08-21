import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/common/ProtectedRoute';
import ClinicianRoute from './components/common/ClinicianRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import ScreeningPage from './pages/ScreeningPage';
import ResultsPage from './pages/ResultsPage';
import HistoryPage from './pages/HistoryPage';
import ClinicsPage from './pages/ClinicsPage';
import ClinicianDashboard from './pages/clinician/ClinicianDashboard';
import CaseReviewPage from './pages/clinician/CaseReviewPage';
import ClinicianHistoryPage from './pages/clinician/ClinicianHistoryPage';
import './i18n/i18n';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          {/* Patient protected routes */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/screening" element={<ScreeningPage />} />
            <Route path="/results/:caseId" element={<ResultsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/clinics" element={<ClinicsPage />} />
          </Route>

          {/* Clinician protected routes */}
          <Route element={<ClinicianRoute><Layout /></ClinicianRoute>}>
            <Route path="/clinician/dashboard" element={<ClinicianDashboard />} />
            <Route path="/clinician/cases/:caseId" element={<CaseReviewPage />} />
            <Route path="/clinician/history" element={<ClinicianHistoryPage />} />
          </Route>

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
