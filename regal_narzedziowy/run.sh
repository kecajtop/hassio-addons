#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="$(bashio::config 'port')"
export SECRET_KEY="$(bashio::config 'secret_key')"
export SESSION_COOKIE_NAME="$(bashio::config 'session_cookie_name')"

export DB_HOST="$(bashio::config 'db_host')"
export DB_PORT="$(bashio::config 'db_port')"
export DB_USER="$(bashio::config 'db_user')"
export DB_PASSWORD="$(bashio::config 'db_password')"
export DB_NAME="$(bashio::config 'db_name')"

export AUTH_DB_HOST="$(bashio::config 'auth_db_host')"
export AUTH_DB_PORT="$(bashio::config 'auth_db_port')"
export AUTH_DB_USER="$(bashio::config 'auth_db_user')"
export AUTH_DB_PASSWORD="$(bashio::config 'auth_db_password')"
export AUTH_DB_NAME="$(bashio::config 'auth_db_name')"
export AUTH_DB_USERS_TABLE="$(bashio::config 'auth_db_users_table')"

cd /opt/regal-addon/app

echo "Start dodatku Regal Narzedziowy na porcie ${PORT}"
echo "App DB: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "Auth DB: ${AUTH_DB_HOST}:${AUTH_DB_PORT}/${AUTH_DB_NAME}"

exec /opt/venv/bin/python -c "from app import app; import os; app.run(host='0.0.0.0', port=int(os.environ.get('PORT', '5001')), debug=False)"