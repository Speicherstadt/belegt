import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";

interface Stand {
  gesamt: number;
  fertig: number;
  doppelt: number;
  fehler: string | null;
}

const mitDateien = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/**
 * Hochladen durch Ziehen und Ablegen, auf jeder Seite: Zieht jemand Dateien über das Fenster, erscheint eine Fläche
 * zum Ablegen; danach zeigt eine Meldung unten rechts den Stand und führt in den Eingang. Wer nicht hochladen darf,
 * bekommt die Fläche nicht
 */
export function DropUpload() {
  const queryClient = useQueryClient();
  const [ziehen, setZiehen] = useState(false);
  const [stand, setStand] = useState<Stand | null>(null);
  const tiefe = useRef(0);

  useEffect(() => {
    const rein = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      tiefe.current += 1;
      setZiehen(true);
    };
    const drueber = (e: DragEvent) => {
      if (mitDateien(e)) e.preventDefault();
    };
    const raus = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      tiefe.current = Math.max(0, tiefe.current - 1);
      if (!tiefe.current) setZiehen(false);
    };
    const ab = (e: DragEvent) => {
      if (!mitDateien(e)) return;
      e.preventDefault();
      tiefe.current = 0;
      setZiehen(false);
      const dateien = [...(e.dataTransfer?.files ?? [])];
      if (dateien.length) void hochladen(dateien);
    };
    window.addEventListener("dragenter", rein);
    window.addEventListener("dragover", drueber);
    window.addEventListener("dragleave", raus);
    window.addEventListener("drop", ab);
    return () => {
      window.removeEventListener("dragenter", rein);
      window.removeEventListener("dragover", drueber);
      window.removeEventListener("dragleave", raus);
      window.removeEventListener("drop", ab);
    };
  });

  async function hochladen(dateien: File[]) {
    const s: Stand = { gesamt: dateien.length, fertig: 0, doppelt: 0, fehler: null };
    setStand({ ...s });
    for (const datei of dateien) {
      try {
        const r = await api.hochladen(datei);
        if (r.doppelt) s.doppelt += 1;
      } catch (err) {
        s.fehler = err instanceof Error ? err.message : String(err);
      }
      s.fertig += 1;
      setStand({ ...s });
    }
    await queryClient.invalidateQueries({ queryKey: ["dokumente"] });
  }

  const laeuft = !!stand && stand.fertig < stand.gesamt;
  return (
    <>
      {ziehen && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg/80 p-6">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-primary border-dashed bg-bg px-10 py-8 text-center">
            <span className="font-semibold text-lg">{m.drop_title()}</span>
            <span className="text-muted text-sm">{m.drop_text()}</span>
          </div>
        </div>
      )}
      {stand && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg border border-border bg-bg p-4 text-sm shadow-lg"
        >
          <span className="font-medium">
            {laeuft
              ? m.drop_busy({ fertig: String(stand.fertig), gesamt: String(stand.gesamt) })
              : m.drop_done({ anzahl: String(stand.gesamt - stand.doppelt) })}
          </span>
          {!!stand.doppelt && (
            <span className="text-muted">{m.drop_duplicates({ anzahl: String(stand.doppelt) })}</span>
          )}
          {stand.fehler && (
            <span className="text-red-700 dark:text-red-400">{m.upload_failed({ meldung: stand.fehler })}</span>
          )}
          {!laeuft && (
            <div className="flex gap-2">
              <Link
                to="/eingang"
                onClick={() => setStand(null)}
                className="flex h-8 items-center rounded-md bg-primary px-3 font-medium text-onprimary"
              >
                {m.drop_to_inbox()}
              </Link>
              <button
                type="button"
                onClick={() => setStand(null)}
                className="h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle"
              >
                {m.drop_close()}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
