#!/system/bin/sh

GESTURE=/sys/devices/amba.13/f7101000.i2c/i2c-1/1-001c/easy_wakeup_gesture

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 2
done

settings put secure double_tap_to_wake 1
settings put global double_tap_to_wake 1
settings put secure lockscreen.disabled 1
settings put secure lock_screen_lock_after_timeout 0
if command -v locksettings >/dev/null 2>&1; then
    locksettings set-disabled true >/dev/null 2>&1
fi

if [ -e "$GESTURE" ]; then
    chmod 0664 "$GESTURE"
    echo 1 > "$GESTURE"
fi
