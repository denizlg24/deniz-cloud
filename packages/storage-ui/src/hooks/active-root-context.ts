import { createContext } from "react";

export type ActiveRoot = "user" | "shared";

export interface ActiveRootContextValue {
  activeRoot: ActiveRoot;
  setActiveRoot: (root: ActiveRoot) => void;
}

export const ActiveRootContext = createContext<ActiveRootContextValue | null>(null);
