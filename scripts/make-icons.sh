#!/bin/sh
# The installed app's icons and the favicon: the Engineering bot's head (the
# brand's render, cofferdam-branding/assets/github/bot-engineering-idle-transparent.png,
# made by cofferdam-branding/scripts/render-bots/render.sh) on the brand's
# splash gradient, so a bots.cofferdam.xyz tab is told apart from cofferdam.xyz,
# which carries the bracket mark. Needs ImageMagick 7 (`magick`).
#
#   sh scripts/make-icons.sh
set -eu
HERE=$(cd "$(dirname "$0")/.." && pwd)
SRC="$HERE/../cofferdam-branding/assets/github/bot-engineering-idle-transparent.png"
T=$(mktemp -d)
magick -size 1024x1024 gradient:'#1b2645-#0b1124' -distort SRT 45 "$T/bg.png"
magick "$SRC" -trim +repage "$T/head.png"
magick "$T/bg.png" \( "$T/head.png" -resize 880x880 \) -gravity center -composite "$T/icon.png"
magick "$T/bg.png" \( "$T/head.png" -resize 640x640 \) -gravity center -composite "$T/maskable.png"
magick "$T/bg.png" \( "$T/head.png" -resize 980x980 \) -gravity center -composite "$T/fav.png"
magick "$T/icon.png" -resize 512x512 -depth 8 -strip "$HERE/public/icons/icon-512.png"
magick "$T/icon.png" -resize 192x192 -depth 8 -strip "$HERE/public/icons/icon-192.png"
magick "$T/icon.png" -resize 180x180 -depth 8 -strip "$HERE/public/icons/apple-touch-icon.png"
magick "$T/maskable.png" -resize 512x512 -depth 8 -strip "$HERE/public/icons/icon-maskable-512.png"
magick "$T/fav.png" -define icon:auto-resize=48,32,16 "$HERE/public/favicon.ico"
rm -rf "$T"
echo "icons written to public/"
