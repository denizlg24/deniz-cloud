import { type ReactNode, useCallback, useEffect, useState } from "react";
import { logout as apiLogout, getMe, type SafeUser } from "@/lib/api";
import { AuthContext, type AuthState } from "@/lib/auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  });

  useEffect(() => {
    getMe()
      .then((user) => {
        setState({ user, isLoading: false, isAuthenticated: true });
      })
      .catch(() => {
        setState({ user: null, isLoading: false, isAuthenticated: false });
      });
  }, []);

  const setUser = useCallback((user: SafeUser) => {
    setState({ user, isLoading: false, isAuthenticated: true });
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // Log out locally even if the API call fails.
    }
    setState({ user: null, isLoading: false, isAuthenticated: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, setUser, logout }}>{children}</AuthContext.Provider>
  );
}
