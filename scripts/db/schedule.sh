#!/usr/bin/env bash
# Schedule backups on the Mac that runs the pilot database (launchd):
#   hourly backup (RPO <= 1 h) + daily 04:30 restore check.
#   scripts/db/schedule.sh install | uninstall | status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; LA="$HOME/Library/LaunchAgents"; mkdir -p "$LA" "$ROOT/.data/backups"
PATH_FOR_JOBS="/opt/homebrew/bin:/usr/local/bin:$(dirname "$(command -v uv)"):/usr/bin:/bin:/usr/sbin:/sbin"
plist() { # $1 label  $2 script  $3 schedule xml  $4 run-at-load
  cat > "$LA/$1.plist" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/scripts/db/$2</string></array>
  $3
  <key>RunAtLoad</key><$4/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$PATH_FOR_JOBS</string></dict>
  <key>StandardOutPath</key><string>$ROOT/.data/backups/$1.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.data/backups/$1.log</string>
</dict></plist>
XML
}
case "${1:-status}" in
  install)
    plist in.gofindr.db-backup backup.sh "<key>StartInterval</key><integer>3600</integer>" true
    plist in.gofindr.db-verify restore-verify.sh "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>30</integer></dict>" false
    for j in in.gofindr.db-backup in.gofindr.db-verify; do launchctl unload "$LA/$j.plist" 2>/dev/null || true; launchctl load "$LA/$j.plist"; done
    echo "Installed: hourly backup, daily restore check. Backups in $ROOT/.data/backups" ;;
  uninstall)
    for j in in.gofindr.db-backup in.gofindr.db-verify; do launchctl unload "$LA/$j.plist" 2>/dev/null || true; rm -f "$LA/$j.plist"; done
    echo "Removed" ;;
  status)
    launchctl list | grep in.gofindr.db || echo "not scheduled"
    tail -3 "$ROOT/.data/backups/backup.log" 2>/dev/null || true ;;
esac
