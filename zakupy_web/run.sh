#!/usr/bin/with-contenv bashio
set -euo pipefail

APP_DIR="/config/zakupy"

if [ ! -f "$APP_DIR/app.py" ]; then
  echo "Brak $APP_DIR/app.py"
  echo "Najpierw skopiuj aplikacje do /config/zakupy"
  exit 1
fi

if [ ! -d "$APP_DIR/web_client" ]; then
  echo "Brak katalogu $APP_DIR/web_client"
  echo "Najpierw skopiuj frontend web_client do /config/zakupy"
  exit 1
fi

export MYSQL_HOST="$(bashio::config 'mysql_host')"
export MYSQL_USER="$(bashio::config 'mysql_user')"
export MYSQL_PASSWORD="$(bashio::config 'mysql_password')"
export MYSQL_DB="$(bashio::config 'mysql_db')"
export UPLOAD_FOLDER="$(bashio::config 'upload_folder')"

HOST_VALUE="$(bashio::config 'host')"
PORT_VALUE="$(bashio::config 'port')"

mkdir -p "$UPLOAD_FOLDER"

cd "$APP_DIR"
exec gunicorn -b "${HOST_VALUE}:${PORT_VALUE}" "app:create_app()"
