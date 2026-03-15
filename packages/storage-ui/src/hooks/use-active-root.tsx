import { createContext, type ReactNode, useContext, useState } from "react";

type ActiveRoot = "user" | "shared";

interface ActiveRootContextValue {
  activeRoot: ActiveRoot;
  setActiveRoot: (root: ActiveRoot) => void;
}

const ActiveRootContext = createContext<ActiveRootContextValue | null>(null);

export function ActiveRootProvider({ children }: { children: ReactNode }) {
  const [activeRoot, setActiveRoot] = useState<ActiveRoot>("user");

  return (
    <ActiveRootContext.Provider value={{ activeRoot, setActiveRoot }}>
      {children}
    </ActiveRootContext.Provider>
  );
}

export function useActiveRoot(): ActiveRootContextValue {
  const ctx = useContext(ActiveRootContext);
  if (!ctx) throw new Error("useActiveRoot must be used within ActiveRootProvider");
  return ctx;
}
