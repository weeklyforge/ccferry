ccferry cloud server
====================
Quick start:
  1. cp /etc/ccferry/cloud.env.template /etc/ccferry/cloud.env (chmod 600)
     and fill in CLOUD_TOKEN_PHONE / CCFERRY_TUNNEL_TOKEN (+ optional
     CLOUD_PWA_DIR, VAPID keys, subscription store paths)
  2. systemctl enable --now ccferry-cloud
  3. Put it behind a TLS reverse proxy (Caddy) on 127.0.0.1:8788.
Full guide: docs/deploy-daemon.md in the repository.
