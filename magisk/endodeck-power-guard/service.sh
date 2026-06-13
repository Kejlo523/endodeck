#!/system/bin/sh

MODDIR=${0%/*}
. "$MODDIR/config.conf"

USB_STATE=/sys/class/android_usb/android0/state
LOG=/data/local/tmp/endodeck-power.log
PIDFILE=/data/local/tmp/endodeck-power.pid
CHARGER_ENABLE=/sys/class/hw_power/charger/charge_data/enable_charger

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

base_radios_off() {
    settings put global airplane_mode_on 1
    am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true >/dev/null 2>&1
    svc data disable >/dev/null 2>&1
    settings put global bluetooth_on 0
    settings put secure location_mode 0
}

radios_off() {
    base_radios_off
    svc wifi disable >/dev/null 2>&1
    settings put global wifi_on 0
}

deck_radios() {
    base_radios_off
    if [ "$KEEP_WIFI_FOR_WEATHER" = "1" ]; then
        svc wifi enable >/dev/null 2>&1
        settings put global wifi_on 1
    else
        svc wifi disable >/dev/null 2>&1
        settings put global wifi_on 0
    fi
}

has_external_power() {
    dumpsys battery 2>/dev/null | grep -qE '(AC|USB|Wireless) powered: true'
}

set_charging() {
    value=$1
    label=$2
    if [ ! -e "$CHARGER_ENABLE" ]; then return; fi
    if echo "$value" > "$CHARGER_ENABLE" 2>/dev/null; then
        charge_state=$label
        log_line "Battery guard: charging $label at ${battery_percent}%"
    else
        log_line "Battery guard: charger control write failed"
    fi
}

manage_charging() {
    if [ "$BATTERY_GUARD_ENABLED" != "1" ] || ! has_external_power; then return; fi
    battery_percent=$(cat /sys/class/power_supply/Battery/capacity 2>/dev/null)
    case "$battery_percent" in ''|*[!0-9]*) return ;; esac

    if [ "$battery_percent" -ge "$BATTERY_GUARD_STOP_PERCENT" ] && [ "$charge_state" != "paused" ]; then
        set_charging 0 paused
    elif [ "$battery_percent" -le "$BATTERY_GUARD_START_PERCENT" ] && [ "$charge_state" != "enabled" ]; then
        set_charging 1 enabled
    elif [ "$charge_state" = "unknown" ]; then
        charge_state=enabled
    fi
}

restore_charging() {
    if [ "$BATTERY_GUARD_ENABLED" = "1" ] && [ -e "$CHARGER_ENABLE" ]; then
        battery_percent=$(cat /sys/class/power_supply/Battery/capacity 2>/dev/null)
        echo 1 > "$CHARGER_ENABLE" 2>/dev/null
        charge_state=enabled
        log_line "Battery guard: charging restored for unplugged state"
    fi
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

wake_offline_saver() {
    dumpsys deviceidle unforce >/dev/null 2>&1
    settings put global stay_on_while_plugged_in 3
    settings put system screen_off_timeout 1800000
    input keyevent 224
    wm dismiss-keyguard >/dev/null 2>&1
    am start -n "$DECK_COMPONENT" >/dev/null 2>&1
    log_line "PC host unavailable; powered offline screensaver active"
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

deck_radios
last_state=unknown
disconnected_at=0
sleep_applied=0
charge_state=unknown

while true; do
    usb_state=$(cat "$USB_STATE" 2>/dev/null)
    manage_charging

    if [ "$usb_state" = "CONFIGURED" ]; then
        disconnected_at=0
        sleep_applied=0
        if [ "$last_state" != "connected" ]; then
            if [ "$KEEP_AIRPLANE_CONNECTED" = "1" ]; then deck_radios; fi
            wake_deck
            last_state=connected
        fi
    elif [ "$POWERED_OFFLINE_SCREENSAVER" = "1" ] && has_external_power; then
        disconnected_at=0
        sleep_applied=0
        if [ "$last_state" != "powered-offline" ]; then
            deck_radios
            wake_offline_saver
            last_state=powered-offline
        fi
    else
        if [ "$last_state" != "disconnected" ]; then
            restore_charging
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
