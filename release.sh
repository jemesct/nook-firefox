#!/usr/bin/env bash
# One-command release: sign on AMO, publish to GitHub, machines auto-update.
#
# Usage:
#   export WEB_EXT_API_KEY="user:...:.."      (JWT issuer from AMO)
#   export WEB_EXT_API_SECRET="..."           (JWT secret from AMO)
#   ./release.sh
#
# Prereqs: gh CLI authed, version already bumped in manifest.json.

set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
REPO="jemesct/nook-firefox"
ADDON_ID="nook-folder-tabs@jamesturner"
XPI_NAME="nook-${VERSION}.xpi"

: "${WEB_EXT_API_KEY:?Set WEB_EXT_API_KEY (JWT issuer from addons.mozilla.org/developers/addon/api/key/)}"
: "${WEB_EXT_API_SECRET:?Set WEB_EXT_API_SECRET (JWT secret)}"

if gh release view "v${VERSION}" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release v${VERSION} already exists — bump the version in manifest.json first." >&2
  exit 1
fi

echo "==> Signing v${VERSION} on AMO (waits for auto-approval)…"
npx --yes web-ext sign --channel=unlisted --source-dir . \
  --ignore-files 'dev/**' '.claude/**' 'userchrome/**' 'web-ext-artifacts/**' \
    'README.md' 'release.sh' 'updates.json' 'nook.zip' 'nook.xpi' \
    'backup-*.json' 'recover-nook.js' '.gitignore'

XPI=$(ls -t web-ext-artifacts/*.xpi | head -1)
cp "$XPI" "web-ext-artifacts/${XPI_NAME}"

echo "==> Writing updates.json…"
cat > web-ext-artifacts/updates.json <<EOF
{
  "addons": {
    "${ADDON_ID}": {
      "updates": [
        {
          "version": "${VERSION}",
          "update_link": "https://github.com/${REPO}/releases/download/v${VERSION}/${XPI_NAME}"
        }
      ]
    }
  }
}
EOF

echo "==> Creating GitHub release v${VERSION}…"
gh release create "v${VERSION}" --repo "$REPO" \
  --title "Nook v${VERSION}" --notes "Signed build v${VERSION}." \
  "web-ext-artifacts/${XPI_NAME}" web-ext-artifacts/updates.json

echo
echo "Done. Installed copies will auto-update within a day, or immediately via"
echo "about:addons → gear icon → Check for Updates."
