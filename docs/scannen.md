---
title: "Scannen"
description: >-
  Netzwerkscanner an Belegt anbinden: FTP-Dienst für den Eingangsordner, Anleitung „Scan to FTP“ am Beispiel Brother MFC.
---

# Scannen

Ein Netzwerkscanner legt seine PDFs in den [Eingangsordner](eingang.md#eingangsordner); von dort nimmt der Worker jede
fertige Datei ins Archiv. Viele Geräte schreiben nur auf einen FTP-Server („Scan to FTP“). Dafür bringt Belegt einen
kleinen FTP-Dienst mit (Profil `ftp`, Image `tristanteu/belegt-ftp`, [vsftpd](https://security.appspot.com/vsftpd.html)).

> [!WARNING]
> Nur im eigenen Netz: FTP überträgt Passwort und Dateien ohne Verschlüsselung. Gib die Ports 21 und 30000–30009 nie
> ins Internet frei, sondern nur im LAN, in dem der Scanner steht. Kann der Scanner FTPS („FTP over TLS“, „SSL/TLS“),
> schalte es mit `FTP_TLS` ein.

## FTP einrichten { #ftp-einrichten }

1. Den Eingangsordner anlegen und beim Worker einhängen, wie unter [Betrieb](betrieb.md#eingangsordner) beschrieben
   (`mkdir eingang && sudo chown 1000 eingang`, die Zeile `- ./eingang:/var/lib/belegt/eingang` einkommentieren,
   `EINGANG_ORDNER=/var/lib/belegt/eingang`).
2. In `.env` den Zugang für den Scanner setzen:

    ```bash
    FTP_BENUTZER=scanner
    FTP_PASSWORT=…            # mindestens 8 Zeichen, etwa openssl rand -hex 12
    FTP_PASV_ADRESSE=192.168.1.20
    ```

    `FTP_PASV_ADRESSE` ist die Adresse des Rechners mit Belegt im LAN. Im passiven Modus nennt der FTP-Server dem
    Scanner diese Adresse und einen Port aus 30000–30009 für die Daten; ohne sie bricht das Senden ab.
3. Starten:

    ```bash
    docker compose --profile ftp up -d
    ```

Der Dienst nimmt Port 21 (anders mit `FTP_PORT`) und die Ports 30000–30009 an. Er kennt nur den einen Benutzer, der in
den Eingangsordner eingesperrt ist und dort als UID 1000 schreibt, damit der Worker aufgenommene Dateien entfernen
darf. Punktdateien lehnt er ab. Jede Übertragung steht mit Dateiname im Log (`docker compose logs ftp`), das Passwort
nie.

**FTPS:** `FTP_TLS=an` erlaubt TLS, `FTP_TLS=pflicht` verlangt es für Anmeldung und Daten. Ohne eigenes Zertifikat
(PEM mit Schlüssel und Zertifikat, eingehängt unter `/etc/ssl/private/belegt-ftp.pem`) erzeugt der Dienst beim Start
ein selbst signiertes; der Scanner muss es dann annehmen, oft unter „Zertifikat prüfen: aus“.

Ein Unterordner als Zielordner wird mit `EINGANG_ORDNER_TAGS=true` zum Tag, etwa ein eigenes Profil `Steuer` für Belege
zur Steuer. Stapel mit [Trennblättern](eingang.md#trennblätter) teilt der Worker wie jede andere Datei.

## Brother MFC: Scan to FTP { #brother }

Die Namen der Menüs unterscheiden sich je nach Modell und Firmware ein wenig; so geht es bei aktuellen MFC-Geräten:

1. Die Web-Oberfläche des Geräts öffnen: seine Adresse im Browser, anmelden mit dem Kennwort des Geräts (steht oft
   unten auf dem Gerät, „Pwd“).
2. **Scannen** › **Scannen an FTP/SFTP/Netzwerk** (oder „Scan to FTP/SFTP/Network/SharePoint“): bei einem freien
   Profil **FTP** wählen und senden.
3. **Scannen** › **Profil Scannen an FTP/SFTP/Netzwerk** › das Profil öffnen und eintragen:

    | Feld | Wert |
    | --- | --- |
    | Profilname | etwa `Belegt`; so erscheint es am Gerät |
    | Host-Adresse | die Adresse aus `FTP_PASV_ADRESSE`, etwa `192.168.1.20` |
    | Port-Nummer | `21` (oder `FTP_PORT`) |
    | Benutzername, Kennwort | `FTP_BENUTZER` und `FTP_PASSWORT` |
    | Zielordner | `/` für den Eingangsordner selbst oder ein Unterordner wie `Steuer` |
    | Passiver Modus | **Ein** |
    | Dateityp | **PDF** (mehrseitig); PDF/A geht auch, „Sicheres PDF“ mit Kennwort nicht, denn Belegt kann es nicht lesen |
    | Auflösung | 300 dpi in Farbe oder Graustufen, für die Texterkennung |
    | Dateiname | frei; Brother hängt Datum und Zähler an, gleiche Namen überschreiben sich also nicht |

4. **Senden** und am Gerät **Scannen** › **an FTP** › Profil „Belegt“ wählen. Nach wenigen Sekunden liegt das
   Dokument im Eingang von Belegt.

Kommt nichts an: `docker compose logs ftp` zeigt, ob sich der Scanner angemeldet hat (`OK LOGIN`) und was er gesendet
hat (`OK UPLOAD`); `docker compose logs worker` zeigt, was der Worker aufgenommen hat. „Verbindungsfehler“ am Gerät nach
erfolgreicher Anmeldung heißt fast immer: `FTP_PASV_ADRESSE` fehlt oder stimmt nicht, oder eine Firewall auf dem Rechner
sperrt 30000–30009.

## Ohne FTP

Kann der Scanner in eine Windows-Freigabe (SMB) schreiben, reicht eine Freigabe des Eingangsordners, etwa von einem NAS
oder mit Samba auf dem Rechner; einen SMB-Dienst bringt Belegt nicht mit. Ohne Scanner im Netz lädst du Scans in der
Oberfläche hoch oder teilst sie vom Handy an Belegt ([Eingang](eingang.md#unterwegs-mit-dem-handy)).
