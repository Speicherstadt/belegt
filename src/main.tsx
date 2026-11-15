import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { getLocale } from "./paraglide/runtime.js";
import { workerAnmelden } from "./pwa/registrieren.ts";
import "./styles.css";

document.documentElement.lang = getLocale();
workerAnmelden({ navigator, imFrame: window.parent !== window });

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

const root = document.getElementById("root");
if (!root) throw new Error("#root fehlt in index.html");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
