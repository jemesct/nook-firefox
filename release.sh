#!/usr/bin/env bash
# Release: sign & submit a new LISTED version to addons.mozilla.org.
# AMO reviews it (usually fast) and then auto-updates every install.
#
# Usage:
#   export WEB_EXT_API_KEY="user:...:.."      (JWT issuer from AMO)
#   export WEB_EXT_API_SECRET="..."           (JWT secret from AMO)
#   ./release.sh
#
# Prereq: version already bumped in manifest.json.

set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")

: "${WEB_EXT_API_KEY:?Set WEB_EXT_API_KEY (JWT issuer from addons.mozilla.org/developers/addon/api/key/)}"
: "${WEB_EXT_API_SECRET:?Set WEB_EXT_API_SECRET (JWT secret)}"

echo "==> Submitting v${VERSION} to AMO (listed channel)…"
npx --yes web-ext sign --channel=listed --source-dir . \
  --ignore-files 'dev/**' '.claude/**' 'userchrome/**' 'web-ext-artifacts/**' \
    'docs/**' 'README.md' 'LICENSE' 'release.sh' 'store/**' \
    'nook.zip' 'nook.xpi' 'backup-*.json' 'recover-nook.js' '.gitignore'

echo
echo "Done. AMO reviews listed versions (usually quickly); once approved,"
echo "every install auto-updates. Status: https://addons.mozilla.org/developers/addons"
