import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function ClinicianRoute({ children }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'clinician') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
