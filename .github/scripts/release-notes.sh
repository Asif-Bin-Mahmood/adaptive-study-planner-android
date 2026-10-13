#!/usr/bin/env bash
# Prints the CHANGELOG.md section for a version, without its heading or link references.
# Usage: release-notes.sh 1.0.0
set -euo pipefail

awk -v v="$1" '
  index($0, "## [" v "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found && /^\[[^]]+\]: / { next }
  found { print }
' CHANGELOG.md | sed -e '/./,$!d'
