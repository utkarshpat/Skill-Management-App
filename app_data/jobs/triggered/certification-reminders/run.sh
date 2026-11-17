#!/bin/bash
set -euo pipefail
for app_root in "${APP_PATH:-/home/site/wwwroot}" /home/site/wwwroot; do
  if [ -f "$app_root/apps/api/dist/certification-reminders-cli.js" ]; then
    cd "$app_root"
    exec npm run reminders:run -w apps/api
  fi
done
echo 'Reminder CLI build not found in APP_PATH or /home/site/wwwroot.' >&2
exit 1
