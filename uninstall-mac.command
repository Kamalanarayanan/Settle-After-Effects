#!/bin/bash
# Settle - macOS uninstaller. Removes the panel only. The CEP debug flag is
# left alone on purpose, since other unsigned panels you use depend on it.
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/settle"
echo ""
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
  echo "  Removed $DEST"
  echo "  Restart After Effects to clear it from the Window menu."
else
  echo "  Nothing installed at $DEST"
fi
echo ""
read -n 1 -s -r -p "  Press any key to close."
echo ""
