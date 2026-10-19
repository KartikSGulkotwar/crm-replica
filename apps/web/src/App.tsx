import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RedirectIfAuthed, RequireAuth } from './components/RequireAuth';
import { InvitePage } from './pages/auth/InvitePage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ObjectPage } from './pages/objects/ObjectPage';
import { RecordPage } from './pages/objects/RecordPage';
import { ApiKeysPage } from './pages/settings/ApiKeysPage';
import { DataModelPage } from './pages/settings/data-model/DataModelPage';
import { ObjectSettingsPage } from './pages/settings/data-model/ObjectSettingsPage';
import { GeneralSettingsPage } from './pages/settings/GeneralSettingsPage';
import { MembersSettingsPage } from './pages/settings/MembersSettingsPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';

export function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthed />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
      </Route>
      <Route path="invite/:token" element={<InvitePage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="objects/:plural" element={<ObjectPage />} />
          <Route path="objects/:plural/:id" element={<RecordPage />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="general" replace />} />
            <Route path="general" element={<GeneralSettingsPage />} />
            <Route path="members" element={<MembersSettingsPage />} />
            <Route path="data-model" element={<DataModelPage />} />
            <Route path="data-model/:plural" element={<ObjectSettingsPage />} />
            <Route path="api-keys" element={<ApiKeysPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
