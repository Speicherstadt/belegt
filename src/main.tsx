import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { getLocale } from "./paraglide/runtime.js";
import { workerAnmelden } from "./pwa/registrieren.ts";
import "./styles.css";

document.documentElement.lang = getLocale();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function starten() {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root fehlt in index.html");
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// Die Demo beantwortet /api in der Seite (src/demo/) und braucht keinen Service Worker
if (import.meta.env.MODE === "demo") void import("./demo/einbauen.ts").then(starten);
else {
  workerAnmelden({ navigator, imFrame: window.parent !== window });
  starten();
}
