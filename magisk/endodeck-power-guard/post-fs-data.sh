#!/system/bin/sh

# A PID from the previous Android boot is never valid for this watchdog.
rm -f /data/local/tmp/endodeck-power.pid
