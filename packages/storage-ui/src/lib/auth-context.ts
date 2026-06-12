import { createContext } from "react";
import type { SafeUser } from "@/lib/api";

export interface AuthState {
  user: SafeUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface AuthContextValue extends AuthState {
  setUser: (user: SafeUser) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
