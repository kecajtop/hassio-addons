#!/usr/bin/with-contenv bashio
set -euo pipefail

DOC_ROOT="$(bashio::config 'document_root')"
HOST_VALUE="$(bashio::config 'host')"
PORT_VALUE="$(bashio::config 'port')"

if [ ! -d "$DOC_ROOT" ]; then
  echo "Brak katalogu $DOC_ROOT"
  echo "Najpierw skopiuj pliki PHP do wskazanego katalogu"
  exit 1
fi

if [ ! -f "$DOC_ROOT/index.php" ] && [ ! -f "$DOC_ROOT/index.html" ]; then
  echo "Brak pliku startowego index.php lub index.html w $DOC_ROOT"
  exit 1
fi

cd "$DOC_ROOT"
exec php -S "${HOST_VALUE}:${PORT_VALUE}" -t "$DOC_ROOT"