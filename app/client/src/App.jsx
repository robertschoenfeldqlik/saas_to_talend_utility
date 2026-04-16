import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import Layout from './components/layout/Layout';
import DashboardPage from './pages/DashboardPage';
import DiscoveryPage from './pages/DiscoveryPage';
import JobListPage from './pages/JobListPage';
import JobCanvasPage from './pages/JobCanvasPage';
import ExportPage from './pages/ExportPage';
import SettingsPage from './pages/SettingsPage';
import HelpPage from './pages/HelpPage';
import ErrorBoundary from './components/shared/ErrorBoundary';

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/discover" element={<DiscoveryPage />} />
            <Route path="/jobs" element={<JobListPage />} />
            <Route path="/jobs/:id" element={<JobCanvasPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
