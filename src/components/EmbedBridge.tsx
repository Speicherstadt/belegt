import { useQuery } from "@tanstack/react-query";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { eingebettet, istAppPfad, nachrichtLesen, senden } from "../lib/einbetten.ts";

/** Verbindung zur einbettenden Seite: Design, Navigation, Abmelden hinein; Bereit, Seite und Titel hinaus */
export function EmbedBridge() {
  const status = useQuery({ queryKey: ["status"], queryFn: api.status });
  const router = useRouter();
  const ort = useLocation();
  const origin = status.data?.embedOrigin ?? null;
  const aktiv = !!origin && eingebettet(origin);

  useEffect(() => {
    if (!aktiv || !origin) return;
    const empfangen = async (e: MessageEvent) => {
      const n = nachrichtLesen(e, { origin, parent: window.parent });
      if (!n) return;
      if (n.type === "theme") document.documentElement.dataset.theme = n.theme;
      if (n.type === "navigate" && istAppPfad(n.path)) await router.navigate({ to: n.path });
      if (n.type === "logout") {
        await api.abmelden().catch(() => {});
        senden(origin, { source: "belegt", type: "signed-out" });
      }
    };
    window.addEventListener("message", empfangen);
    senden(origin, { source: "belegt", type: "ready" });
    return () => window.removeEventListener("message", empfangen);
  }, [aktiv, origin, router]);

  useEffect(() => {
    if (!aktiv || !origin) return;
    senden(origin, { source: "belegt", type: "route", path: ort.pathname });
    // Der Titel steht kurz nach dem Wechsel der Seite fest
    const t = setTimeout(() => senden(origin, { source: "belegt", type: "title", title: document.title }), 100);
    return () => clearTimeout(t);
  }, [aktiv, origin, ort.pathname]);

  return null;
}
