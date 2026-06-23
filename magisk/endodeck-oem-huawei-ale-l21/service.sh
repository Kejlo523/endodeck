#!/system/bin/sh

PIDFILE=/data/local/tmp/endodeck-oem-huawei.pid
LOG=/data/local/tmp/endodeck-oem-huawei.log
OPTIONS=/data/adb/endodeck/options.conf
GESTURE=/sys/devices/amba.13/f7101000.i2c/i2c-1/1-001c/easy_wakeup_gesture
CHARGER=/sys/class/hw_power/charger/charge_data/enable_charger
CAPACITY_PATHS="/sys/class/power_supply/Battery/capacity /sys/class/power_supply/battery/capacity"
[ -f "$OPTIONS" ] && . "$OPTIONS"
: "${ENABLE_DT2W:=0}"
: "${ENABLE_BATTERY_GUARD:=0}"
: "${BATTERY_GUARD_STOP_PERCENT:=75}"
: "${BATTERY_GUARD_START_PERCENT:=65}"
: "${BATTERY_GUARD_POLL_SECONDS:=20}"
: "${BATTERY_GUARD_OFFLINE_POLL_SECONDS:=12}"

is_own_worker() {
    pid=$1
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    cmdline=$(tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null)
    echo "$cmdline" | grep -q 'endodeck_oem_huawei_ale_l21/service.sh --worker'
}

if [ "$1" != "--worker" ]; then
    if [ -f "$PIDFILE" ]; then
        old=$(cat "$PIDFILE" 2>/dev/null)
        is_own_worker "$old" && exit 0
        rm -f "$PIDFILE"
    fi
    nohup sh "$0" --worker >/dev/null 2>&1 &
    exit 0
fi

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT INT TERM
while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 3; done

log_line() {
    echo "$(date '+%F %T') $*" >> "$LOG"
}

numeric() {
    case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac
}

safe_percent() {
    value=$1
    fallback=$2
    numeric "$value" || { echo "$fallback"; return; }
    [ "$value" -lt 0 ] && value=0
    [ "$value" -gt 100 ] && value=100
    echo "$value"
}

guard_start=$(safe_percent "$BATTERY_GUARD_START_PERCENT" 65)
guard_stop=$(safe_percent "$BATTERY_GUARD_STOP_PERCENT" 75)
if [ "$guard_start" -ge "$guard_stop" ]; then
    guard_start=65
    guard_stop=75
fi
poll_seconds=$(safe_percent "$BATTERY_GUARD_POLL_SECONDS" 20)
offline_poll_seconds=$(safe_percent "$BATTERY_GUARD_OFFLINE_POLL_SECONDS" 12)
[ "$poll_seconds" -lt 5 ] && poll_seconds=5
[ "$offline_poll_seconds" -lt 5 ] && offline_poll_seconds=5

battery_capacity() {
    for path in $CAPACITY_PATHS; do
        if [ -r "$path" ]; then
            value=$(cat "$path" 2>/dev/null)
            numeric "$value" && { echo "$value"; return 0; }
        fi
    done
    return 1
}

charger_state() {
    [ -r "$CHARGER" ] || return 1
    value=$(cat "$CHARGER" 2>/dev/null)
    case "$value" in 0|1) echo "$value"; return 0 ;; *) return 1 ;; esac
}

set_charger() {
    desired=$1
    reason=$2
    [ -e "$CHARGER" ] || return 1
    current=$(charger_state 2>/dev/null)
    [ "$current" = "$desired" ] && return 0
    chmod 0664 "$CHARGER" 2>/dev/null
    if echo "$desired" > "$CHARGER" 2>/dev/null; then
        log_line "battery_guard charger=$desired reason=$reason capacity=${capacity:-unknown} range=${guard_start}-${guard_stop}"
        return 0
    fi
    log_line "battery_guard write_failed desired=$desired reason=$reason capacity=${capacity:-unknown}"
    return 1
}

powered_by_usb_or_ac() {
    dumpsys battery 2>/dev/null | grep -qE '(AC|USB|Wireless) powered: true'
}

if [ "$ENABLE_DT2W" = "1" ] && [ -e "$GESTURE" ]; then
    settings put secure double_tap_to_wake 1
    settings put global double_tap_to_wake 1
    chmod 0664 "$GESTURE"
    echo 1 > "$GESTURE"
fi

while true; do
    if [ "$ENABLE_BATTERY_GUARD" != "1" ]; then
        set_charger 1 "guard-disabled" >/dev/null 2>&1
        sleep "$poll_seconds"
        continue
    fi

    if [ -e "$CHARGER" ]; then
        if capacity=$(battery_capacity); then
            if [ "$capacity" -ge "$guard_stop" ]; then
                set_charger 0 "capacity-at-or-above-stop"
            elif [ "$capacity" -le "$guard_start" ]; then
                set_charger 1 "capacity-at-or-below-start"
            fi
        else
            log_line "battery_guard capacity_unavailable"
        fi
    fi

    if powered_by_usb_or_ac; then sleep "$offline_poll_seconds"; else sleep "$poll_seconds"; fi
done
