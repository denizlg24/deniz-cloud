import { useContext } from "react";
import { ActiveRootContext, type ActiveRootContextValue } from "@/hooks/active-root-context";

export function useActiveRoot(): ActiveRootContextValue {
  const context = useContext(ActiveRootContext);
  if (!context) throw new Error("useActiveRoot must be used within ActiveRootProvider");
  return context;
}
