#!/system/bin/sh

MODDIR=${0%/*}
. "$MODDIR/config.conf"

USB_STATE=/sys/class/android_usb/android0/state
LOG=/data/local/tmp/endodeck-power.log
PIDFILE=/data/local/tmp/endodeck-power.pid

# Old Magisk releases may reap long-running module scripts after late_start.
# Detach a dedicated worker so USB monitoring survives the boot stage.
if [ "$1" != "--worker" ]; then
    if [ -f "$PIDFILE" ]; then
        old_pid=$(cat "$PIDFILE" 2>/dev/null)
        if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
            exit 0
        fi
    fi
    nohup sh "$0" --worker >/dev/null 2>&1 &
    exit 0
fi

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT INT TERM

log_line() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"
}

radios_off() {
    settings put global airplane_mode_on 1
    am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true >/dev/null 2>&1
    svc data disable >/dev/null 2>&1
    svc wifi disable >/dev/null 2>&1
    settings put global wifi_on 0
    settings put global bluetooth_on 0
    settings put secure location_mode 0
}

wake_deck() {
    dumpsys deviceidle unforce >/dev/null 2>&1
    settings put global stay_on_while_plugged_in 2
    settings put system screen_off_timeout 1800000
    input keyevent 224
    wm dismiss-keyguard >/dev/null 2>&1
    am start -n "$DECK_COMPONENT" >/dev/null 2>&1
    log_line "PC host connected; deck awake"
}

sleep_deck() {
    settings put global stay_on_while_plugged_in 0
    settings put system screen_off_timeout 15000
    input keyevent 223
    sleep 2
    dumpsys deviceidle force-idle >/dev/null 2>&1
    log_line "PC host disconnected; forced deep idle"
}

while [ "$(getprop sys.boot_completed)" != "1" ]; do
    sleep 2
done

radios_off
last_state=unknown
disconnected_at=0
sleep_applied=0

while true; do
    usb_state=$(cat "$USB_STATE" 2>/dev/null)

    if [ "$usb_state" = "CONFIGURED" ]; then
        disconnected_at=0
        sleep_applied=0
        if [ "$last_state" != "connected" ]; then
            if [ "$KEEP_AIRPLANE_CONNECTED" = "1" ]; then radios_off; fi
            wake_deck
            last_state=connected
        fi
    else
        if [ "$last_state" != "disconnected" ]; then
            radios_off
            disconnected_at=$(date +%s)
            sleep_applied=0
            last_state=disconnected
            log_line "PC host disconnected; offline screen grace period"
        fi

        now=$(date +%s)
        elapsed=$((now - disconnected_at))
        if [ "$sleep_applied" = "0" ] && [ "$elapsed" -ge "$DISCONNECT_SLEEP_SECONDS" ]; then
            sleep_deck
            sleep_applied=1
        fi
    fi

    sleep 3
done
