#!/bin/sh
# Single-project build: exports the Expo web app to frontend/dist.
# EXPO_PUBLIC_BACKEND_URL is embedded into the bundle at build time. If you did not set it in Vercel,
# default to this project's own URL (the API is served from the same domain under /api).
set -e
if [ -z "$EXPO_PUBLIC_BACKEND_URL" ]; then
  if [ "$VERCEL_ENV" = "production" ] && [ -n "$VERCEL_PROJECT_PRODUCTION_URL" ]; then
    export EXPO_PUBLIC_BACKEND_URL="https://$VERCEL_PROJECT_PRODUCTION_URL"
  elif [ -n "$VERCEL_URL" ]; then
    export EXPO_PUBLIC_BACKEND_URL="https://$VERCEL_URL"
  fi
fi
echo "Building web app with EXPO_PUBLIC_BACKEND_URL=${EXPO_PUBLIC_BACKEND_URL:-<not set>}"
cd frontend
npx expo export --platform web
