#!/system/bin/sh

GESTURE=/sys/devices/amba.13/f7101000.i2c/i2c-1/1-001c/easy_wakeup_gesture

if [ -e "$GESTURE" ]; then echo 0 > "$GESTURE"; fi
settings put secure double_tap_to_wake 0
settings put global double_tap_to_wake 0
settings put secure lockscreen.disabled 0
if command -v locksettings >/dev/null 2>&1; then
    locksettings set-disabled false >/dev/null 2>&1
fi
