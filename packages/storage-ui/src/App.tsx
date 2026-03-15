import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/app-layout";
import { AuthGuard } from "@/components/auth-guard";
import { FileBrowser } from "@/pages/files";
import { LoginPage } from "@/pages/login";
import { SetupMfaPage } from "@/pages/setup-mfa";
import { SignupPage } from "@/pages/signup";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/setup-mfa" element={<SetupMfaPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<FileBrowser />} />
        </Route>
      </Route>
    </Routes>
  );
}
