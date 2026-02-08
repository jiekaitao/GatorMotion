#!/usr/bin/env sh
set -eu

mode="${1:-dev}"
if [ "$#" -gt 0 ]; then
  shift
fi

if [ "$#" -eq 0 ]; then
  set -- up --build
fi

case "$mode" in
  dev)
    docker compose -f docker-compose.yml -f docker-compose.dev.yml "$@"
    ;;
  prod|production)
    docker compose -f docker-compose.yml "$@"
    ;;
  *)
    echo "Usage: $0 {dev|prod} [docker compose args...]" >&2
    exit 1
    ;;
esac
