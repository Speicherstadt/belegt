#!/bin/sh
# Startet vsftpd mit einem Benutzer aus der Umgebung, der nur in /eingang schreibt (chroot) und dort als UID 1000
# anlegt, damit der Worker aufgenommene Dateien entfernen darf. Das Passwort geht nur über stdin an chpasswd, nie in die
# Prozessliste oder ins Log.
set -eu

: "${FTP_BENUTZER:?FTP_BENUTZER fehlt}"
: "${FTP_PASSWORT:?FTP_PASSWORT fehlt}"
# Adresse des Rechners im LAN: Im passiven Modus nennt der Server dem Scanner, wohin er die Daten schicken soll; ohne sie
# nennte er die Adresse des Containers, die der Scanner nicht erreicht
: "${FTP_PASV_ADRESSE:?FTP_PASV_ADRESSE fehlt (Adresse dieses Rechners im LAN, etwa 192.168.1.20)}"
uid=${FTP_UID:-1000}
tls=${FTP_TLS:-aus}

case "$FTP_BENUTZER" in
  *[!a-z0-9_-]* | [!a-z]*) echo "FTP_BENUTZER: Kleinbuchstaben, Ziffern, - und _, vorn ein Buchstabe" >&2; exit 1 ;;
esac
if [ "${#FTP_PASSWORT}" -lt 8 ]; then
  echo "FTP_PASSWORT braucht mindestens 8 Zeichen" >&2
  exit 1
fi

# Beim Neustart des Containers gibt es den Benutzer schon; -o, falls die UID schon vergeben ist
getent group "$uid" >/dev/null || groupadd -g "$uid" belegt-ftp
id -u "$FTP_BENUTZER" >/dev/null 2>&1 \
  || useradd -o -u "$uid" -g "$uid" -d /eingang -M -s /usr/sbin/nologin "$FTP_BENUTZER"
printf '%s:%s\n' "$FTP_BENUTZER" "$FTP_PASSWORT" | chpasswd
printf '%s\n' "$FTP_BENUTZER" >/etc/vsftpd.userlist

konf=/etc/vsftpd.conf
set -- "$konf" "-opasv_address=$FTP_PASV_ADRESSE"

zertifikat=/etc/ssl/private/belegt-ftp.pem
case "$tls" in
  aus) ;;
  an | pflicht)
    if [ ! -s "$zertifikat" ]; then
      echo "Kein Zertifikat unter $zertifikat eingehängt, erzeuge ein selbst signiertes"
      mkdir -p /etc/ssl/private
      openssl req -x509 -nodes -newkey rsa:3072 -days 3650 -subj "/CN=belegt-ftp" \
        -keyout "$zertifikat" -out "$zertifikat" 2>/dev/null
      chmod 600 "$zertifikat"
    fi
    # an: der Scanner darf TLS nutzen; pflicht: Anmeldung und Daten nur mit TLS
    zwang=NO
    [ "$tls" = pflicht ] && zwang=YES
    set -- "$@" -ossl_enable=YES "-orsa_cert_file=$zertifikat" -oallow_anon_ssl=NO -orequire_ssl_reuse=NO \
      "-oforce_local_logins_ssl=$zwang" "-oforce_local_data_ssl=$zwang" -ossl_ciphers=HIGH
    ;;
  *) echo "FTP_TLS ist aus, an oder pflicht" >&2; exit 1 ;;
esac

echo "FTP für $FTP_BENUTZER bereit: Ziel /eingang, passiv über $FTP_PASV_ADRESSE:30000-30009, FTPS $tls"
exec vsftpd "$@"
