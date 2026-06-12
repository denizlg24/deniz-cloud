import { type ReactNode, useState } from "react";
import { type ActiveRoot, ActiveRootContext } from "@/hooks/active-root-context";

export function ActiveRootProvider({ children }: { children: ReactNode }) {
  const [activeRoot, setActiveRoot] = useState<ActiveRoot>("user");

  return (
    <ActiveRootContext.Provider value={{ activeRoot, setActiveRoot }}>
      {children}
    </ActiveRootContext.Provider>
  );
}
