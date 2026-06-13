#!/system/bin/sh

PIDFILE=/data/local/tmp/endodeck-power.pid
if [ -f "$PIDFILE" ]; then
    kill "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null
fi
rm -f "$PIDFILE"

dumpsys deviceidle unforce >/dev/null 2>&1
settings put global stay_on_while_plugged_in 2
settings put global airplane_mode_on 0
am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false >/dev/null 2>&1
settings put system screen_off_timeout 300000
rm -f /data/local/tmp/endodeck-power.log
