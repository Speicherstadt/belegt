-- Audit-Log, Siegel und Kopf der Kette schreiben nur die Trigger: Ihre Funktionen laufen mit den Rechten des
-- Eigentümers, damit die App-Rolle diese Tabellen nur lesen muss (server/db/rollen.ts). Sonst könnte eine übernommene
-- App Einträge erfinden, die als gültige Glieder der Kette durchgehen. Fester Suchpfad, wie für SECURITY DEFINER nötig
-- (https://www.postgresql.org/docs/16/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY).
ALTER FUNCTION belegt_audit() SECURITY DEFINER SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION belegt_seal() SECURITY DEFINER SET search_path = public, pg_temp;--> statement-breakpoint
ALTER FUNCTION belegt_audit_chain_head() SECURITY DEFINER SET search_path = public, pg_temp;
