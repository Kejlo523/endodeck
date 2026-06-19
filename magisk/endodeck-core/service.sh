#!/system/bin/sh

PIDFILE=/data/local/tmp/endodeck-core.pid
LOG=/data/local/tmp/endodeck-core.log
STATE_DIR=/data/adb/endodeck
OPTIONS="$STATE_DIR/options.conf"
BACKUP="$STATE_DIR/core-settings.backup"
CTL=/system/bin/endodeckctl

[ -f "$OPTIONS" ] && . "$OPTIONS"
: "${DISCONNECT_SLEEP_SECONDS:=45}"
: "${POWERED_OFFLINE_SCREENSAVER:=1}"
: "${NIGHT_STANDBY_ENABLED:=1}"
: "${NIGHT_STANDBY_START_HOUR:=0}"
: "${NIGHT_STANDBY_END_HOUR:=7}"
: "${NIGHT_STANDBY_START_MINUTE:=$((NIGHT_STANDBY_START_HOUR * 60))}"
: "${NIGHT_STANDBY_END_MINUTE:=$((NIGHT_STANDBY_END_HOUR * 60))}"

if [ "$1" != "--worker" ]; then
    if [ -f "$PIDFILE" ]; then old=$(cat "$PIDFILE" 2>/dev/null); [ -n "$old" ] && kill -0 "$old" 2>/dev/null && exit 0; fi
    nohup sh "$0" --worker >/dev/null 2>&1 &
    exit 0
fi

echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT INT TERM
mkdir -p "$STATE_DIR"

backup_setting() {
    table=$1; key=$2
    grep -q "^$table|$key|" "$BACKUP" 2>/dev/null && return
    value=$(settings get "$table" "$key" 2>/dev/null)
    printf '%s|%s|%s\n' "$table" "$key" "$value" >> "$BACKUP"
}

if [ ! -f "$BACKUP" ]; then
    backup_setting global stay_on_while_plugged_in
    backup_setting system screen_off_timeout
    backup_setting global airplane_mode_on
    backup_setting secure lockscreen.disabled
fi

while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done

usb_configured() {
    state=$(cat /sys/class/android_usb/android0/state 2>/dev/null)
    [ "$state" = "CONFIGURED" ] && return 0
    getprop sys.usb.state | grep -q 'adb'
}

external_power() {
    dumpsys battery 2>/dev/null | grep -qE '(AC|USB|Wireless) powered: true'
}

night_active() {
    [ "$NIGHT_STANDBY_ENABLED" = "1" ] || return 1
    hour=$(date '+%H' | sed 's/^0//')
    minute=$(date '+%M' | sed 's/^0//')
    [ -z "$hour" ] && hour=0
    [ -z "$minute" ] && minute=0
    case "$hour:$minute:$NIGHT_STANDBY_START_MINUTE:$NIGHT_STANDBY_END_MINUTE" in *[!0-9:]*|*::* ) return 1 ;; esac
    [ "$NIGHT_STANDBY_START_MINUTE" -eq "$NIGHT_STANDBY_END_MINUTE" ] && return 1
    current=$((hour * 60 + minute))
    if [ "$NIGHT_STANDBY_START_MINUTE" -lt "$NIGHT_STANDBY_END_MINUTE" ]; then
        [ "$current" -ge "$NIGHT_STANDBY_START_MINUTE" ] && [ "$current" -lt "$NIGHT_STANDBY_END_MINUTE" ]
    else
        [ "$current" -ge "$NIGHT_STANDBY_START_MINUTE" ] || [ "$current" -lt "$NIGHT_STANDBY_END_MINUTE" ]
    fi
}

last=unknown
disconnected_at=0
while true; do
    if usb_configured; then
        disconnected_at=0
        if [ "$last" != connected ]; then "$CTL" wake; echo "$(date '+%F %T') PC connected" >> "$LOG"; last=connected; fi
    elif night_active; then
        disconnected_at=0
        if [ "$last" != night ]; then "$CTL" sleep-night; echo "$(date '+%F %T') night standby" >> "$LOG"; last=night; fi
    elif [ -f /data/local/tmp/endodeck-night-standby ]; then
        rm -f /data/local/tmp/endodeck-night-standby
        "$CTL" wake
        last=offline
    elif [ "$POWERED_OFFLINE_SCREENSAVER" = "1" ] && external_power; then
        disconnected_at=0
        if [ "$last" != offline ]; then "$CTL" wake; echo "$(date '+%F %T') powered offline" >> "$LOG"; last=offline; fi
    else
        now=$(date +%s)
        if [ "$last" != disconnected ] && [ "$last" != sleeping ]; then disconnected_at=$now; last=disconnected; fi
        if [ "$last" = disconnected ] && [ $((now - disconnected_at)) -ge "$DISCONNECT_SLEEP_SECONDS" ]; then "$CTL" sleep; last=sleeping; fi
    fi
    sleep 3
done
