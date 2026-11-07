#!/bin/sh
# Wayland quando houver, X11 senão.
export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
exec zypak-wrapper /app/piu/piu "$@"
