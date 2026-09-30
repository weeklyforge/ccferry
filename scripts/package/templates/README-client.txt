ccferry client (PC daemon)
==========================
Quick start:
  1. mkdir -p ~/.ccferry && edit daemon credentials there
     (CCFERRY_TOKEN / CCFERRY_TUNNEL_URL / CCFERRY_TUNNEL_TOKEN), chmod 600
  2. Autostart:
     - Linux: copy /usr/share/ccferry/systemd/ccferry.service to
       ~/.config/systemd/user/, then
       systemctl --user daemon-reload && systemctl --user enable --now ccferry
     - macOS: edit /Library/LaunchAgents/com.ccferry.daemon.plist tokens,
       then launchctl load /Library/LaunchAgents/com.ccferry.daemon.plist
     - Windows: see the setup installer / docs/deploy-daemon.md
  3. Verify: curl -s http://127.0.0.1:8787/api/projects -H "Authorization: Bearer <token>"
Full guide: docs/deploy-daemon.md in the repository.
