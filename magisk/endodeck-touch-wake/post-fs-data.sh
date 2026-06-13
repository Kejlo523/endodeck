#!/system/bin/sh

GESTURE=/sys/devices/amba.13/f7101000.i2c/i2c-1/1-001c/easy_wakeup_gesture

if [ -e "$GESTURE" ]; then
    chmod 0664 "$GESTURE"
    # The Huawei driver expects a decimal mask. Hex input is silently rejected.
    echo 1 > "$GESTURE"
fi
