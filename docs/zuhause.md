---
title: "Zu Hause betreiben"
description: >-
  Belegt auf einem Heimserver, von außen erreichbar über einen VPS mit WireGuard und Caddy, ohne offene Ports am Router;
  dazu Sicherung außer Haus, Stromausfall und Scanner im LAN.
---

# Zu Hause betreiben

Die Originale liegen bei dir, erreichbar ist Belegt trotzdem von unterwegs: Belegt läuft auf einem Rechner zu Hause
(Heimserver, NAS mit Docker), ein VPS, auf dem ohnehin andere Dienste hinter Caddy laufen, nimmt die Anfragen an und
reicht sie durch einen WireGuard-Tunnel weiter. Den Tunnel baut der Heimserver auf; am Router zu Hause wird kein Port
geöffnet.

```
Browser ──HTTPS──▶ VPS: Caddy ──WireGuard──▶ Heimserver: Belegt (10.8.0.2:3000)
```

**Warum nicht einfach eine Portfreigabe?** Viele Anschlüsse haben keine eigene öffentliche IPv4-Adresse mehr (DS-Lite,
CGNAT), die Adresse wechselt, und eine Freigabe stellt den Heimserver direkt ins Internet, wo jeder Port gescannt wird.
Über den VPS gibt es nur einen öffentlichen Eingang, mit festem Namen und Zertifikat, und der Heimserver nimmt nur
Verbindungen aus dem Tunnel an.

Bedenke: Caddy beendet TLS auf dem VPS, wer den VPS betreibt, könnte also mitlesen. Der Tunnel dahinter ist
verschlüsselt.

## WireGuard

Auf beiden Rechnern `wireguard-tools` installieren und je ein Schlüsselpaar erzeugen:

```bash
umask 077
wg genkey | tee /etc/wireguard/privat.key | wg pubkey > /etc/wireguard/oeffentlich.key
```

Auf dem VPS `/etc/wireguard/wg0.conf`, UDP-Port 51820 in seiner Firewall öffnen:

```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <privater Schlüssel des VPS>

[Peer]
# Heimserver
PublicKey = <öffentlicher Schlüssel des Heimservers>
AllowedIPs = 10.8.0.2/32
```

Auf dem Heimserver `/etc/wireguard/wg0.conf`; `PersistentKeepalive` hält den Tunnel durch den Router offen:

```ini
[Interface]
Address = 10.8.0.2/24
PrivateKey = <privater Schlüssel des Heimservers>

[Peer]
# VPS
PublicKey = <öffentlicher Schlüssel des VPS>
Endpoint = vps.example.de:51820
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
```

Auf beiden `systemctl enable --now wg-quick@wg0`, dann vom VPS aus `ping 10.8.0.2`.

## Belegt auf dem Heimserver

Belegt wie unter [Betrieb](betrieb.md#starten) einrichten, ohne das Profil `https`. In `.env`:

```bash
BELEGT_URL=https://belegt.example.de
# Nur über den Tunnel erreichbar, nicht im LAN oder über andere Wege
BELEGT_PORT=10.8.0.2:3000
# X-Forwarded-For gilt nur von Caddy auf dem VPS
BELEGT_TRUSTED_PROXIES=10.8.0.1
```

`BELEGT_TRUSTED_PROXIES` braucht es für die Begrenzung der Anmeldeversuche: Belegt sieht als Verbindung die Adresse des
VPS im Tunnel und nimmt die Adresse des Browsers nur dann aus `X-Forwarded-For`, wenn die Verbindung von dort kommt;
ohne den Eintrag teilen sich alle einen Zähler. Den Header `x-belegt-client-ip`, den Belegt intern daraus setzt,
entfernt der Server aus jeder eingehenden Anfrage selbst; Caddy muss dafür nichts tun.

Docker kann den Port erst an `10.8.0.2` binden, wenn der Tunnel steht. Damit das auch nach einem Neustart klappt, startet
Docker nach WireGuard (`systemctl edit docker`):

```ini
[Unit]
After=wg-quick@wg0.service
Wants=wg-quick@wg0.service
```

Zu Hause gehst du genauso über `https://belegt.example.de`; die Anfragen nehmen dann den Weg über den VPS.

Liefert ein Mailserver auf dem VPS das [SMTP-Journal](eingang.md#smtp-journal), geht es ebenfalls durch den Tunnel:
`SMTP_PORT=10.8.0.2:2525` und als Ziel des Journals `10.8.0.2:2525`.

## Caddy auf dem VPS

Ein Block im Caddyfile des VPS, neben den anderen Diensten; den Namen per DNS auf den VPS zeigen lassen:

```caddyfile
belegt.example.de {
	encode zstd gzip
	header -Server
	header Strict-Transport-Security "max-age=31536000; includeSubDomains"
	# Belegt auf dem Heimserver, über WireGuard
	reverse_proxy 10.8.0.2:3000
}
```

Caddy setzt `X-Forwarded-For` selbst und verwirft, was ein Browser mitschickt. Eine Grenze für Uploads setzt der Block
nicht, weil der [Export aus Paperless-ngx](umzug.md) groß sein darf. Gilt HSTS noch nicht für alle Subdomains, nimm
`includeSubDomains` heraus (siehe [HTTPS](betrieb.md#https)).

## Mit Tailscale

Statt WireGuard von Hand geht es mit [Tailscale](https://tailscale.com) (auch mit dem selbst betriebenen Headscale):
Tailscale auf VPS und Heimserver, dann wie oben mit den Adressen aus dem Tailnet: `BELEGT_PORT=<Tailscale-Adresse des
Heimservers>:3000`, `BELEGT_TRUSTED_PROXIES=<Tailscale-Adresse des VPS>`, in Caddy
`reverse_proxy <Tailscale-Adresse des Heimservers>:3000` und in der Unit `tailscaled.service` statt `wg-quick@wg0`.
Brauchen nur die eigenen Geräte Zugriff, geht es auch ganz ohne VPS: Tailscale auf jedem Gerät, Belegt ist dann nur im
Tailnet erreichbar.

## Sicherung außer Haus

Ein Einbruch, Brand oder Überspannung trifft Rechner und Sicherung im selben Haus. Der
[Backup-Container](betrieb.md#sichern) sichert deshalb besser auf ein zweites System, etwa per SFTP durch den Tunnel auf
den VPS:

```bash
RESTIC_REPOSITORY=sftp:restic@10.8.0.1:/srv/restic/belegt
```

Dafür in `compose.yml` bei den Diensten `backup` und `restore` die Zeile mit `~/.ssh` einkommentieren und den Schlüssel dieses Benutzers
beim Benutzer `restic` auf dem VPS eintragen. Ebenso geht ein S3-Speicher bei einem Anbieter (`s3:…`). Das
`RESTIC_PASSWORD` und `.env` gehören zusätzlich an einen Ort außerhalb des Hauses, sonst lässt sich die Sicherung
nicht öffnen.

## Stromausfall

Postgres übersteht einen harten Ausfall dank seines Write-Ahead-Logs, die Festplatte nicht immer. Eine kleine USV mit
[NUT](https://networkupstools.org) fährt den Heimserver sauber herunter. Im BIOS „nach Stromausfall einschalten“
setzen; Compose startet Belegt danach von selbst (`restart: unless-stopped`), und der nächste Test-Restore prüft die
Daten.

## Scanner im LAN

Ein Netzwerkscanner liefert per FTP direkt im Heimnetz an, nicht über den Tunnel: siehe [Scannen](scannen.md). Die
FTP-Ports bleiben am Router zu.
