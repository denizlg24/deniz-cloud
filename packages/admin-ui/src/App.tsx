import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/app-layout";
import { AuthGuard } from "@/components/auth-guard";
import { DashboardPage } from "@/pages/dashboard";
import { DatabasesPage } from "@/pages/databases";
import { LoginPage } from "@/pages/login";
import { ProjectsPage } from "@/pages/projects";
import { StoragePage } from "@/pages/storage";
import { ToolsPage } from "@/pages/tools";
import { UsersPage } from "@/pages/users";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/storage" element={<StoragePage />} />
          <Route path="/databases" element={<DatabasesPage />} />
          <Route path="/tools" element={<ToolsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
