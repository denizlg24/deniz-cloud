import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/app-layout";
import { AuthGuard } from "@/components/auth-guard";
import { FileBrowser } from "@/pages/files";
import { LoginPage } from "@/pages/login";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<FileBrowser />} />
        </Route>
      </Route>
    </Routes>
  );
}
