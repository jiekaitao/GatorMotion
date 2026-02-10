#!/bin/bash
# Seed the local MongoDB with exported Atlas data
# This runs automatically on first container start via docker-entrypoint-initdb.d

DB="pt_app"
SEED_DIR="/docker-entrypoint-initdb.d/seed"

for f in "$SEED_DIR"/*.json; do
  collection=$(basename "$f" .json)
  echo "Importing $collection..."
  mongoimport --db "$DB" --collection "$collection" --jsonArray --file "$f"
done

echo "Seed complete."
