#!/bin/bash
#
# Settle - macOS installer
# Crit Studio
#
# Double-click this file. It copies the panel into the CEP extensions folder,
# turns on unsigned-extension loading, strips the download quarantine flag, and
# checks the result. Nothing here needs sudo and nothing leaves your machine.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"
NAME="settle"

echo ""
echo "  Settle 0.2.2 - installer"
echo "  ------------------------"
echo ""

# --- find the extension folder, whatever depth the unzip left it at ----------

SRC=""
for candidate in "$HERE/$NAME" "$HERE" "$HERE/$NAME/$NAME"; do
  if [ -f "$candidate/CSXS/manifest.xml" ]; then SRC="$candidate"; break; fi
done

if [ -z "$SRC" ]; then
  echo "  Could not find CSXS/manifest.xml near this script."
  echo "  Keep install-mac.command next to the 'settle' folder and run it again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

echo "  Source:  $SRC"
echo "  Target:  $DEST/$NAME"
echo ""

# --- copy ---------------------------------------------------------------------

mkdir -p "$DEST"

if [ -d "$DEST/$NAME" ]; then
  echo "  Replacing the existing install."
  rm -rf "$DEST/$NAME"
fi

# Copy the contents, not the wrapper, so we never end up with settle/settle.
mkdir -p "$DEST/$NAME"
cp -R "$SRC/." "$DEST/$NAME/"

# Development leftovers have no business in an install.
rm -f "$DEST/$NAME/test_host.js" "$DEST/$NAME/test_physics.js"
rm -rf "$DEST/$NAME/node_modules"

if [ -f "$DEST/$NAME/CSXS/manifest.xml" ]; then
  echo "  Copied."
else
  echo "  Copy failed. manifest.xml is not where it should be."
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi

# --- quarantine ---------------------------------------------------------------

xattr -dr com.apple.quarantine "$DEST/$NAME" 2>/dev/null
echo "  Quarantine flag cleared."

# --- debug mode ---------------------------------------------------------------
#
# Written as a string, not an integer. The integer form is the usual one-liner
# people copy and some CEP builds ignore it, so the flag reads as set while
# doing nothing.

for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode -string 1 2>/dev/null
done
killall cfprefsd 2>/dev/null

OK=""
for v in 12 11 10 9; do
  if [ "$(defaults read "com.adobe.CSXS.$v" PlayerDebugMode 2>/dev/null)" = "1" ]; then
    OK="$OK $v"
  fi
done

if [ -n "$OK" ]; then
  echo "  Unsigned extensions enabled for CSXS:$OK"
else
  echo "  Warning: could not confirm the debug flag. See the README."
fi

# --- done ---------------------------------------------------------------------

echo ""
echo "  Installed."
echo ""
echo "  Now quit After Effects completely with Cmd+Q, reopen it, and look under"
echo "  Window > Extensions > Settle. Some AE builds call the menu"
echo "  Window > Extensions (Legacy)."
echo ""
echo "  If it does not appear, run this and send the output:"
echo "  grep -i settle \"\$HOME/Library/Logs/CSXS/\"CEP*-AEFT.log"
echo ""
read -n 1 -s -r -p "  Press any key to close."
echo ""
