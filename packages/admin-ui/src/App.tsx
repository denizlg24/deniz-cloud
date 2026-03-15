import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/app-layout";
import { AuthGuard } from "@/components/auth-guard";
import { DashboardPage } from "@/pages/dashboard";
import { LoginPage } from "@/pages/login";
import { SearchPage } from "@/pages/search";
import { StoragePage } from "@/pages/storage";
import { UsersPage } from "@/pages/users";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/storage" element={<StoragePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
