-- Korrektur zu 0005: Die zweite Person braucht jedes Dokument, das je anders als frei eingeordnet war; sonst löschte
-- der Inhaber ein Pflichtdokument allein, indem er es zuerst als frei einordnet. Ein Antrag kommt unbestätigt herein
-- (außer bei nur freier Ablage), und Dokument, Antragsteller und Zeitpunkt des Antrags ändern sich danach nicht.
CREATE OR REPLACE FUNCTION belegt_loeschung_pruefen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e einordnungen;
  heute date := (now() AT TIME ZONE 'Europe/Berlin')::date;
  nur_frei boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.dokument_id IS DISTINCT FROM OLD.dokument_id OR NEW.beantragt_von IS DISTINCT FROM OLD.beantragt_von
     OR NEW.beantragt_am IS DISTINCT FROM OLD.beantragt_am OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'Der Antrag lässt sich nur bestätigen oder zurückziehen' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO e FROM einordnungen WHERE dokument_id = NEW.dokument_id ORDER BY erstellt_am DESC, id DESC LIMIT 1;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'Das Dokument ist nicht eingeordnet und hat keine Frist' USING ERRCODE = 'check_violation';
  END IF;
  IF e.art <> 'frei' AND e.frist_bis >= heute THEN
    RAISE EXCEPTION 'Die Frist läuft noch bis %', e.frist_bis USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM sperren s WHERE s.aufgehoben_am IS NULL AND e.entstanden BETWEEN s.von AND s.bis) THEN
    RAISE EXCEPTION 'Das Dokument liegt unter einer Sperre' USING ERRCODE = 'check_violation';
  END IF;
  nur_frei := NOT EXISTS (SELECT 1 FROM einordnungen x WHERE x.dokument_id = NEW.dokument_id AND x.art <> 'frei');
  IF NEW.bestaetigt_am IS NOT NULL AND NOT nur_frei AND (TG_OP = 'INSERT' OR NEW.bestaetigt_von = NEW.beantragt_von) THEN
    RAISE EXCEPTION 'Die Löschung bestätigt eine zweite Person' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
