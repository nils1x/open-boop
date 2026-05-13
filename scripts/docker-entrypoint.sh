#!/bin/sh
set -e

# Generate Convex types if CONVEX_DEPLOYMENT is set and generated files missing
if [ ! -f "convex/_generated/api.js" ]; then
  if [ -n "$CONVEX_DEPLOYMENT" ]; then
    echo "[entrypoint] generating Convex types..."
    npx convex codegen 2>&1 || echo "[entrypoint] convex codegen failed — server may fail"
  else
    echo "[entrypoint] CONVEX_DEPLOYMENT not set — convex/_generated must exist in the image"
  fi
fi

echo "[entrypoint] starting Boop Agent..."
exec bun server/index.ts
