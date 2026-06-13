param(
    [Parameter(Mandatory = $true)]
    [int[]]$Keys,
    [int]$HoldMs = 50,
    [switch]$Extended
)

$ErrorActionPreference = 'Stop'

if (-not ('EndoDeck.Keyboard' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace EndoDeck {
    public static class Keyboard {
        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint code, uint mapType);

        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        private static bool IsExtended(int vk) {
            switch (vk) {
                case 0xA3: // RCONTROL
                case 0xA5: // RMENU (right alt)
                case 0x5B: // LWIN
                case 0x5C: // RWIN
                case 0x21: // PRIOR (page up)
                case 0x22: // NEXT (page down)
                case 0x23: // END
                case 0x24: // HOME
                case 0x25: // LEFT
                case 0x26: // UP
                case 0x27: // RIGHT
                case 0x28: // DOWN
                case 0x2D: // INSERT
                case 0x2E: // DELETE
                    return true;
                default:
                    return false;
            }
        }

        public static void Send(int[] keys, int holdMs, bool forceExtended) {
            uint[] down = new uint[keys.Length];
            for (int i = 0; i < keys.Length; i++) {
                int vk = keys[i];
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                uint flags = 0;
                if (forceExtended && IsExtended(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
                keybd_event((byte)vk, scan, flags, UIntPtr.Zero);
            }
            System.Threading.Thread.Sleep(holdMs);
            for (int i = keys.Length - 1; i >= 0; i--) {
                int vk = keys[i];
                byte scan = (byte)MapVirtualKey((uint)vk, 0);
                uint flags = KEYEVENTF_KEYUP;
                if (forceExtended && IsExtended(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
                keybd_event((byte)vk, scan, flags, UIntPtr.Zero);
            }
        }
    }
}
'@
}

[EndoDeck.Keyboard]::Send($Keys, $HoldMs, [bool]$Extended)
'{"ok":true}'
