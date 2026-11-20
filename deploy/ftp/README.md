# belegt-ftp

FTP für Netzwerkscanner, die per „Scan to FTP“ senden: [vsftpd](https://security.appspot.com/vsftpd.html) mit einem
Benutzer, der nur in den Eingangsordner von [Belegt](https://github.com/Speicherstadt/belegt) schreibt. Der Worker von
Belegt nimmt jede fertige Datei von dort auf. Nur für das eigene Netz: Ohne TLS gehen Passwort und Dateien
unverschlüsselt über die Leitung.

- Compose: Profil `ftp` in [`deploy/compose.yml`](https://github.com/Speicherstadt/belegt/blob/main/deploy/compose.yml), derselbe Ordner wie beim Worker unter `/eingang`.
- Ports: 21 und der passive Bereich 30000–30009.
- Dateien gehören UID 1000 (wie der Worker), damit Belegt sie nach der Aufnahme entfernen kann.

| Variable | Bedeutung | Vorgabe |
| --- | --- | --- |
| `FTP_BENUTZER` | Name zum Anmelden (Kleinbuchstaben, Ziffern, `-`, `_`) | – |
| `FTP_PASSWORT` | Passwort, mindestens 8 Zeichen | – |
| `FTP_PASV_ADRESSE` | Adresse des Rechners im LAN, die der Server im passiven Modus nennt | – |
| `FTP_TLS` | `aus`, `an` (FTPS möglich) oder `pflicht` (nur FTPS); ohne eingehängtes Zertifikat unter `/etc/ssl/private/belegt-ftp.pem` ein selbst signiertes | `aus` |
| `FTP_UID` | Besitzer der Dateien | `1000` |

Die Tags folgen Belegt (`:latest`, `:0.2`, `:0.2.0`, `:next`). Einrichten mit einem Scanner:
[Scannen](https://belegt.store/scannen.html).
