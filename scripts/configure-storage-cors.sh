#!/usr/bin/env bash
# Apply Firebase Storage CORS so web byte fetches (getData, map marker icons)
# work from localhost and deployed web origins.
#
# Requires: gcloud CLI authenticated with permission to update the bucket.
# See firebase/storage.cors.json and firebase_storage_web README.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORS_FILE="$ROOT/firebase/storage.cors.json"
BUCKET="${GUARDIAN_STORAGE_BUCKET:-guardian-fbadd.firebasestorage.app}"

if [[ ! -f "$CORS_FILE" ]]; then
  echo "Missing $CORS_FILE" >&2
  exit 1
fi

echo "Applying Storage CORS from $CORS_FILE to gs://$BUCKET ..."
gcloud storage buckets update "gs://$BUCKET" --cors-file="$CORS_FILE"
echo "Done. Reload the web app and avatar map markers should fetch bytes."
