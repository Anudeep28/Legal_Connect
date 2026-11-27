#!/usr/bin/env bash
set -euo pipefail

: "${MINIO_ROOT_USER:?Set MINIO_ROOT_USER from the private MinIO admin environment file}"
: "${MINIO_ROOT_PASSWORD:?Set MINIO_ROOT_PASSWORD from the private MinIO admin environment file}"
: "${MINIO_APP_ACCESS_KEY:?Set MINIO_APP_ACCESS_KEY}"
: "${MINIO_APP_SECRET_KEY:?Set MINIO_APP_SECRET_KEY}"
: "${MINIO_BUCKET:=consultation-attachments}"

command -v mc >/dev/null || {
  echo "Install the MinIO Client (mc) before running this script." >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
mc alias set consultwithlawyer http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing "consultwithlawyer/$MINIO_BUCKET"

policy_file="$(mktemp)"
trap 'rm -f "$policy_file"' EXIT
sed "s/consultation-attachments/${MINIO_BUCKET}/g" \
  "$script_dir/minio-app-policy.template.json" > "$policy_file"
mc admin policy create consultwithlawyer consultwithlawyer-app "$policy_file"

if ! mc admin user info consultwithlawyer "$MINIO_APP_ACCESS_KEY" >/dev/null 2>&1; then
  mc admin user add consultwithlawyer "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
fi
mc admin policy attach consultwithlawyer consultwithlawyer-app --user "$MINIO_APP_ACCESS_KEY"
mc cors set "consultwithlawyer/$MINIO_BUCKET" "$script_dir/minio-cors.json"

echo "MinIO bucket and restricted app user are ready."
echo "Confirm the app user credentials match MINIO_ACCESS_KEY and MINIO_SECRET_KEY in app.env."
echo "Review deploy/ubuntu/minio-cors.json if your public web origin differs."
