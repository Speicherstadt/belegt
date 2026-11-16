# belegt-validator

Prüfdienst für E-Rechnungen für [Belegt](https://github.com/firsttris/belegt): der
[Validator der KoSIT](https://github.com/itplr-kosit/validator) als HTTP-Dienst mit der
[Konfiguration für XRechnung](https://github.com/itplr-kosit/validator-configuration-xrechnung). Geprüft werden
XRechnung in UBL und CII und EN 16931 ohne XRechnung, also auch ZUGFeRD und Factur-X ab dem Profil EN 16931.

- Compose: Profil `validator` in [`deploy/compose.yml`](https://github.com/firsttris/belegt/blob/main/deploy/compose.yml), in Belegt `VALIDATOR_URL=http://validator:8080`.
- Schnittstelle: `POST /` mit dem XML im Rumpf; Antwort ein Prüfbericht (XML), Status 200 (annehmbar) oder 406 (nicht annehmbar). `GET /server/health` für die Überwachung.
- Validator 1.6.3, Konfiguration 2026-08-31 für XRechnung 3.0.2, beide Apache-2.0; Java 21 (Eclipse Temurin), ohne Root und ohne Oberfläche.

Die Tags folgen Belegt (`:latest`, `:0.2`, `:0.2.0`, `:next`). Einrichten:
[Betrieb › E-Rechnungen prüfen](https://firsttris.github.io/belegt/betrieb.html#erechnung-pruefen).
