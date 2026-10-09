#!/usr/bin/env bash
# Idempotent mail server setup for the AutoDeploy panel host.
#
#   Postfix   - MTA: port 25 (inbound), 587 (submission/STARTTLS), 465 (SMTPS)
#   Dovecot   - IMAP 993/143, POP3 995, LMTP delivery, SASL auth for Postfix
#   OpenDKIM  - DKIM signing of outbound mail / verification of inbound
#
# Mailboxes, domains and aliases are managed by the panel (backend/services/mail.service.js),
# which writes the panel_* maps, /etc/dovecot/panel-users and the OpenDKIM tables.
#
# Usage: MAIL_HOST=mail.example.com bash setup-mail-server.sh
#   MAIL_HOST must resolve to this server and have a Let's Encrypt certificate in
#   /etc/letsencrypt/live/$MAIL_HOST (clients connect to this name for IMAP/SMTP).
set -euo pipefail

MAIL_HOST="${MAIL_HOST:-automate-deployment.yjtechnosoft.com}"
# HELO name: must match the server's reverse DNS (PTR) for good deliverability
HELO_HOST="${HELO_HOST:-$(dig +short -x "$(curl -s4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')" | sed 's/\.$//' | head -1)}"
HELO_HOST="${HELO_HOST:-$(hostname -f)}"
CERT_DIR="/etc/letsencrypt/live/$MAIL_HOST"
VMAIL_UID=5000

if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "No certificate at $CERT_DIR — issue one first (certbot) or set MAIL_HOST." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
dpkg -s dovecot-imapd dovecot-pop3d dovecot-lmtpd opendkim opendkim-tools >/dev/null 2>&1 || \
  apt-get install -y -q dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd opendkim opendkim-tools

# --- vmail user & storage --------------------------------------------------------------------
getent group vmail >/dev/null || groupadd -g $VMAIL_UID vmail
getent passwd vmail >/dev/null || useradd -u $VMAIL_UID -g vmail -d /var/vmail -s /usr/sbin/nologin -M vmail
mkdir -p /var/vmail && chown vmail:vmail /var/vmail && chmod 770 /var/vmail

# --- panel-managed maps (created empty if missing) ----------------------------------------------
for f in panel_domains panel_mailboxes panel_aliases panel_sender_login; do
  [ -f /etc/postfix/$f ] || : > /etc/postfix/$f
  postmap /etc/postfix/$f
done
[ -f /etc/dovecot/panel-users ] || : > /etc/dovecot/panel-users
chown root:dovecot /etc/dovecot/panel-users && chmod 640 /etc/dovecot/panel-users

# --- Postfix ---------------------------------------------------------------------------------
echo "$HELO_HOST" > /etc/mailname
postconf -e \
  "myhostname = $HELO_HOST" \
  "myorigin = \$myhostname" \
  "mydestination = \$myhostname, localhost.localdomain, localhost" \
  "virtual_alias_domains =" \
  "virtual_mailbox_domains = hash:/etc/postfix/panel_domains" \
  "virtual_mailbox_maps = hash:/etc/postfix/panel_mailboxes" \
  "virtual_alias_maps = hash:/etc/postfix/panel_aliases" \
  "virtual_transport = lmtp:unix:private/dovecot-lmtp" \
  "smtpd_tls_cert_file = $CERT_DIR/fullchain.pem" \
  "smtpd_tls_key_file = $CERT_DIR/privkey.pem" \
  "smtpd_tls_security_level = may" \
  "smtpd_tls_mandatory_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1" \
  "smtpd_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1" \
  "smtp_tls_security_level = may" \
  "smtpd_sasl_type = dovecot" \
  "smtpd_sasl_path = private/auth" \
  "smtpd_sasl_auth_enable = no" \
  "smtpd_sender_login_maps = hash:/etc/postfix/panel_sender_login" \
  "smtpd_helo_required = yes" \
  "smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, defer_unauth_destination" \
  "smtpd_recipient_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination" \
  "message_size_limit = 52428800" \
  "mailbox_size_limit = 0" \
  "milter_default_action = accept" \
  "milter_protocol = 6" \
  "smtpd_milters = inet:127.0.0.1:8891" \
  "non_smtpd_milters = inet:127.0.0.1:8891"

SUBMISSION_OPTS=(
  "smtpd_tls_auth_only=yes"
  "smtpd_sasl_auth_enable=yes"
  "smtpd_client_restrictions=permit_sasl_authenticated,reject"
  "smtpd_sender_restrictions=reject_sender_login_mismatch"
  "smtpd_relay_restrictions=permit_sasl_authenticated,reject"
  "smtpd_recipient_restrictions=permit_sasl_authenticated,reject"
  "milter_macro_daemon_name=ORIGINATING"
)
postconf -M "submission/inet=submission inet n - y - - smtpd"
postconf -P "submission/inet/syslog_name=postfix/submission" "submission/inet/smtpd_tls_security_level=encrypt"
postconf -M "smtps/inet=smtps inet n - y - - smtpd"
postconf -P "smtps/inet/syslog_name=postfix/smtps" "smtps/inet/smtpd_tls_wrappermode=yes"
for o in "${SUBMISSION_OPTS[@]}"; do postconf -P "submission/inet/$o" "smtps/inet/$o"; done

# The old catch-all pipe into the panel (receive_mail.js) is replaced by real mailboxes
sed -i '/^webmail_inbound:/d' /etc/aliases && newaliases

# --- Dovecot ---------------------------------------------------------------------------------
sed -i 's/^!include auth-system.conf.ext/#!include auth-system.conf.ext/' /etc/dovecot/conf.d/10-auth.conf
cat > /etc/dovecot/local.conf <<EOF
# Managed by auto-deploy-panel (backend/scripts/setup-mail-server.sh)
protocols = imap pop3 lmtp
mail_location = maildir:/var/vmail/%d/%n
mail_uid = vmail
mail_gid = vmail
first_valid_uid = $VMAIL_UID
last_valid_uid = $VMAIL_UID
mail_privileged_group = vmail

disable_plaintext_auth = yes
auth_mechanisms = plain login
auth_username_format = %Lu

ssl = required
ssl_cert = <$CERT_DIR/fullchain.pem
ssl_key = <$CERT_DIR/privkey.pem
ssl_min_protocol = TLSv1.2

passdb {
  driver = passwd-file
  args = scheme=BLF-CRYPT username_format=%u /etc/dovecot/panel-users
}
userdb {
  driver = passwd-file
  args = username_format=%u /etc/dovecot/panel-users
  default_fields = uid=vmail gid=vmail home=/var/vmail/%d/%n
}

service lmtp {
  unix_listener /var/spool/postfix/private/dovecot-lmtp {
    mode = 0600
    user = postfix
    group = postfix
  }
}
service auth {
  unix_listener /var/spool/postfix/private/auth {
    mode = 0660
    user = postfix
    group = postfix
  }
}

mail_plugins = \$mail_plugins quota
protocol imap {
  mail_plugins = \$mail_plugins imap_quota
}
protocol lmtp {
  postmaster_address = postmaster@$HELO_HOST
}
plugin {
  quota = maildir:User quota
  quota_exceeded_message = Mailbox is full.
}

namespace inbox {
  mailbox Drafts {
    auto = subscribe
    special_use = \Drafts
  }
  mailbox Sent {
    auto = subscribe
    special_use = \Sent
  }
  mailbox Trash {
    auto = subscribe
    special_use = \Trash
  }
  mailbox Junk {
    auto = subscribe
    special_use = \Junk
  }
}
EOF

# --- OpenDKIM --------------------------------------------------------------------------------
mkdir -p /etc/opendkim/keys
for f in key.table signing.table; do [ -f /etc/opendkim/$f ] || : > /etc/opendkim/$f; done
printf '127.0.0.1\n::1\nlocalhost\n%s\n' "$HELO_HOST" > /etc/opendkim/trusted.hosts
chown -R opendkim:opendkim /etc/opendkim && chmod 750 /etc/opendkim/keys
sed -i -E '/^(Socket|Mode|KeyTable|SigningTable|ExternalIgnoreList|InternalHosts)\b/d' /etc/opendkim.conf
cat >> /etc/opendkim.conf <<'EOF'
Mode			sv
Socket			inet:8891@127.0.0.1
KeyTable		refile:/etc/opendkim/key.table
SigningTable		refile:/etc/opendkim/signing.table
ExternalIgnoreList	/etc/opendkim/trusted.hosts
InternalHosts		/etc/opendkim/trusted.hosts
EOF
[ -f /etc/default/opendkim ] && sed -i -E 's|^SOCKET=.*|SOCKET=inet:8891@127.0.0.1|' /etc/default/opendkim

# --- Reload certificate users after renewals ---------------------------------------------------
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-mail.sh <<'EOF'
#!/bin/sh
systemctl reload postfix dovecot 2>/dev/null || true
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-mail.sh

# --- Restart & verify ------------------------------------------------------------------------
systemctl enable --now opendkim dovecot postfix >/dev/null 2>&1
systemctl restart opendkim dovecot postfix
postfix check
doveconf -n >/dev/null
echo "Mail server ready: helo=$HELO_HOST clients=$MAIL_HOST"
