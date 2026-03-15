import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function AuthGuard() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user && !user.totpEnabled) {
    return <Navigate to="/setup-mfa" replace />;
  }

  return <Outlet />;
}
