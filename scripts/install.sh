#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./scripts/install.sh [--link] [--skip-build]

Options:
  --link        Run npm link after build to expose aic/ai-coord locally
  --skip-build  Skip npm run build
USAGE
}

link=false
skip_build=false

for arg in "$@"; do
  case "$arg" in
    --link)
      link=true
      ;;
    --skip-build)
      skip_build=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

npm install

if [ "$skip_build" = false ]; then
  npm run build
fi

if [ "$link" = true ]; then
  npm link
  echo "Linked binaries: aic, ai-coord"
fi
