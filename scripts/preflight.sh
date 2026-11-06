#!/bin/sh
# Runs first on Vercel (see installCommand). Fails fast, with a readable list, if part of the project is missing.
missing=""
need() { [ -e "$1" ] || missing="$missing\n  - $1"; }
need api/index.py
need backend/server.py
need backend/requirements.txt
need requirements.txt
need frontend/package.json
need frontend/app.json
need frontend/app
need frontend/assets
need frontend/scripts/cmd-guard.js
if [ -n "$missing" ]; then
  printf "\nPROJECT INCOMPLETE. These files/folders are missing from the repository:%b\n\n" "$missing"
  echo "Copy your frontend source (app/, src/, assets/, scripts/) into frontend/ and commit it, then redeploy."
  exit 1
fi
echo "Preflight OK: all required project folders are present."
