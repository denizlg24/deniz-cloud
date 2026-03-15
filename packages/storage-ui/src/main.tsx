import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveRootProvider } from "@/hooks/use-active-root";
import { FolderCacheProvider } from "@/hooks/use-folder-cache";
import { AuthProvider } from "@/lib/auth";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <FolderCacheProvider>
          <ActiveRootProvider>
            <TooltipProvider>
              <App />
              <Toaster />
            </TooltipProvider>
          </ActiveRootProvider>
        </FolderCacheProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
