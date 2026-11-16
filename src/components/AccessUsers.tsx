import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Zugaenge } from "../lib/api.ts";
import { tag } from "../lib/format.ts";
import { rolleLabel } from "../lib/rollen.ts";
import { m } from "../paraglide/messages.js";
import { LEERER_SICHTBEREICH, type MitarbeiterWahl, ScopeEditor, sichtbereichText, useNamen } from "./ScopeEditor.tsx";

type Konto = Zugaenge["zugaenge"][number];

const knopf = "h-8 rounded-md border border-border px-3 font-medium hover:bg-subtle";

function KontoZeile({ z, name }: { z: Konto; name: Map<string, string> }) {
  const queryClient = useQueryClient();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [entziehen, setEntziehen] = useState(false);
  const [zuruecksetzen, setZuruecksetzen] = useState(false);
  const [wahl, setWahl] = useState<MitarbeiterWahl>({
    recht: z.recht ?? "lesen",
    sichtbereich: { ...LEERER_SICHTBEREICH, ...z.sichtbereich },
  });
  const neu = () => queryClient.invalidateQueries({ queryKey: ["zugaenge"] });
  const speichern = useMutation({
    mutationFn: () => api.mitarbeiterAendern(z.id, wahl.recht, wahl.sichtbereich),
    onSuccess: async () => {
      setBearbeiten(false);
      await neu();
    },
  });
  const weg = useMutation({ mutationFn: () => api.entziehen(z.id), onSuccess: neu });
  const reset = useMutation({
    mutationFn: () => api.zweiFaktorZuruecksetzen(z.id),
    onSuccess: async () => {
      setZuruecksetzen(false);
      await neu();
    },
  });
  const fehler = speichern.error ?? weg.error ?? reset.error;
  const zweiterFaktor = z.zweiFaktor.totp || z.zweiFaktor.passkeys > 0;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{z.email}</span>
        <span className="text-muted">
          {rolleLabel(z.rolle)}
          {z.zeitraumVon &&
            z.zeitraumBis &&
            ` · ${m.access_period({ von: tag(z.zeitraumVon), bis: tag(z.zeitraumBis) })}`}
          {z.recht && ` · ${z.recht === "bearbeiten" ? m.scope_right_edit() : m.scope_right_read()}`}
          {z.entzogenAm && ` · ${m.access_withdrawn({ datum: tag(z.entzogenAm) })}`}
          {` · ${zweiterFaktor ? m.access_2fa_yes() : m.access_2fa_no()}`}
        </span>
      </div>
      {z.sichtbereich && <p className="m-0 text-muted">{sichtbereichText(z.sichtbereich, name)}</p>}
      {z.rolle !== "inhaber" && !z.entzogenAm && (
        <div className="flex flex-wrap gap-2">
          {z.rolle === "mitarbeiter" && (
            <button
              type="button"
              aria-expanded={bearbeiten}
              aria-label={m.access_edit_named({ email: z.email })}
              onClick={() => setBearbeiten(!bearbeiten)}
              className={knopf}
            >
              {m.access_edit()}
            </button>
          )}
          {zweiterFaktor &&
            (zuruecksetzen ? (
              <button
                type="button"
                onClick={() => reset.mutate()}
                className="h-8 rounded-md bg-red-700 px-3 font-medium text-white"
              >
                {m.access_2fa_reset_confirm({ email: z.email })}
              </button>
            ) : (
              <button
                type="button"
                aria-label={m.access_2fa_reset_named({ email: z.email })}
                onClick={() => setZuruecksetzen(true)}
                className={knopf}
              >
                {m.access_2fa_reset()}
              </button>
            ))}
          {entziehen ? (
            <button
              type="button"
              onClick={() => weg.mutate()}
              className="h-8 rounded-md bg-red-700 px-3 font-medium text-white"
            >
              {m.access_withdraw_confirm({ email: z.email })}
            </button>
          ) : (
            <button
              type="button"
              aria-label={m.access_withdraw_named({ email: z.email })}
              onClick={() => setEntziehen(true)}
              className={knopf}
            >
              {m.access_withdraw()}
            </button>
          )}
        </div>
      )}
      {bearbeiten && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            speichern.mutate();
          }}
          className="flex flex-col gap-3 border-border border-t pt-3"
        >
          <ScopeEditor wert={wahl} aendern={setWahl} />
          <button
            type="submit"
            disabled={speichern.isPending}
            className="h-9 self-start rounded-md bg-primary px-4 font-medium text-onprimary disabled:opacity-60"
          >
            {m.access_save()}
          </button>
        </form>
      )}
      {fehler && (
        <p role="alert" className="m-0 text-red-700 dark:text-red-400">
          {fehler.message}
        </p>
      )}
    </li>
  );
}

/** Die Konten auf der Seite Zugänge: Mitarbeiter mit Sichtbereich ändern, Zugänge entziehen */
export function AccessUsers({ zugaenge }: { zugaenge: Konto[] }) {
  const { name } = useNamen();
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {zugaenge.map((z) => (
        <KontoZeile key={z.id} z={z} name={name} />
      ))}
    </ul>
  );
}
