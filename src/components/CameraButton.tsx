import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, type Doppelt } from "../lib/api.ts";
import { m } from "../paraglide/messages.js";
import { UploadDuplicates } from "./UploadDuplicates.tsx";

/**
 * „Foto aufnehmen“: öffnet auf dem Handy die Kamera (capture, auch auf dem iPhone), am Rechner die Dateiauswahl für
 * Bilder. Jedes Foto geht sofort über den normalen Upload in den Eingang; danach lässt sich das nächste aufnehmen.
 */
export function CameraButton() {
  const queryClient = useQueryClient();
  const eingabe = useRef<HTMLInputElement>(null);
  // Zählt die Fotos auf dieser Seite, damit man sieht, dass das letzte angekommen ist
  const [anzahl, setAnzahl] = useState(0);
  const hochladen = useMutation({
    mutationFn: async (dateien: File[]) => {
      const doppelt: Doppelt[] = [];
      for (const datei of dateien) {
        const r = await api.hochladen(datei);
        if (r.doppelt) doppelt.push(r.doppelt);
      }
      return { neu: dateien.length - doppelt.length, doppelt };
    },
    onSuccess: (r) => setAnzahl((a) => a + r.neu),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dokumente"] }),
  });
  return (
    <>
      <input
        ref={eingabe}
        type="file"
        accept="image/*"
        capture="environment"
        data-testid="foto"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const dateien = [...(e.target.files ?? [])];
          e.target.value = "";
          if (dateien.length) hochladen.mutate(dateien);
        }}
      />
      <button
        type="button"
        onClick={() => eingabe.current?.click()}
        disabled={hochladen.isPending}
        className="h-10 rounded-md border border-border px-4 font-medium text-sm hover:bg-subtle disabled:opacity-60"
      >
        {hochladen.isPending ? m.photo_busy() : m.photo_take()}
      </button>
      {hochladen.isSuccess && (
        <span role="status" className="text-sm">
          {m.photo_done({ anzahl: String(anzahl) })}
        </span>
      )}
      {hochladen.error && (
        <span role="alert" className="text-red-700 text-sm dark:text-red-400">
          {m.upload_failed({ meldung: hochladen.error.message })}
        </span>
      )}
      {hochladen.data && <UploadDuplicates doppelt={hochladen.data.doppelt} />}
    </>
  );
}
