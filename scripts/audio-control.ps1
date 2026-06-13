param(
    [ValidateSet('list', 'status', 'master', 'session', 'microphone-toggle')]
    [string]$Action = 'list',
    [int]$Volume = 50,
    [int]$SessionId = -1
)

$ErrorActionPreference = 'Stop'

if (-not ('EndoDeck.Audio' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace EndoDeck {
    public enum EDataFlow { Render, Capture, All }
    public enum ERole { Console, Multimedia, Communications }

    [Flags]
    public enum CLSCTX : uint { All = 23 }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumerator { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    public interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IntPtr devices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    public interface IMMDevice {
        int Activate(ref Guid iid, CLSCTX context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
    public interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr notify);
        int UnregisterControlChangeNotify(IntPtr notify);
        int GetChannelCount(out uint count);
        int SetMasterVolumeLevel(float level, Guid context);
        int SetMasterVolumeLevelScalar(float level, Guid context);
        int GetMasterVolumeLevel(out float level);
        int GetMasterVolumeLevelScalar(out float level);
        int SetChannelVolumeLevel(uint channel, float level, Guid context);
        int SetChannelVolumeLevelScalar(uint channel, float level, Guid context);
        int GetChannelVolumeLevel(uint channel, out float level);
        int GetChannelVolumeLevelScalar(uint channel, out float level);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context);
        int GetMute(out bool mute);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
    public interface IAudioSessionManager2 {
        int GetAudioSessionControl(IntPtr sessionGuid, uint streamFlags, out IntPtr sessionControl);
        int GetSimpleAudioVolume(IntPtr sessionGuid, uint streamFlags, out IntPtr audioVolume);
        int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
    public interface IAudioSessionEnumerator {
        int GetCount(out int count);
        int GetSession(int index, out IAudioSessionControl control);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
    public interface IAudioSessionControl {
        int GetState(out int state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, Guid context);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, Guid context);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam(Guid groupingId, Guid context);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D")]
    public interface IAudioSessionControl2 {
        int GetState(out int state);
        int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
        int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string displayName, Guid context);
        int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
        int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string iconPath, Guid context);
        int GetGroupingParam(out Guid groupingId);
        int SetGroupingParam(Guid groupingId, Guid context);
        int RegisterAudioSessionNotification(IntPtr client);
        int UnregisterAudioSessionNotification(IntPtr client);
        int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        int GetProcessId(out uint processId);
        int IsSystemSoundsSession();
        int SetDuckingPreference(bool optOut);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8")]
    public interface ISimpleAudioVolume {
        int SetMasterVolume(float level, Guid context);
        int GetMasterVolume(out float level);
        int SetMute(bool mute, Guid context);
        int GetMute(out bool mute);
    }

    public sealed class AudioSessionInfo {
        public int id;
        public string name;
        public string process;
        public int volume;
        public bool muted;
    }

    public sealed class AudioSnapshot {
        public int master;
        public bool muted;
        public bool microphoneMuted;
        public List<AudioSessionInfo> sessions;
    }

    public sealed class AudioStatus {
        public bool muted;
        public bool microphoneMuted;
    }

    public static class Audio {
        private static IMMDevice DefaultDevice(EDataFlow flow = EDataFlow.Render, ERole role = ERole.Multimedia) {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, role, out device));
            return device;
        }

        private static IAudioEndpointVolume Endpoint(EDataFlow flow, ERole role) {
            return Activate<IAudioEndpointVolume>(DefaultDevice(flow, role), "5CDF2C82-841E-4546-9722-0CF74078229A");
        }

        private static T Activate<T>(IMMDevice device, string iid) {
            object instance;
            Guid guid = new Guid(iid);
            Marshal.ThrowExceptionForHR(device.Activate(ref guid, CLSCTX.All, IntPtr.Zero, out instance));
            return (T)instance;
        }

        public static AudioSnapshot List() {
            IMMDevice device = DefaultDevice();
            var endpoint = Activate<IAudioEndpointVolume>(device, "5CDF2C82-841E-4546-9722-0CF74078229A");
            float master;
            bool masterMuted;
            endpoint.GetMasterVolumeLevelScalar(out master);
            endpoint.GetMute(out masterMuted);

            var manager = Activate<IAudioSessionManager2>(device, "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
            IAudioSessionEnumerator sessionEnum;
            Marshal.ThrowExceptionForHR(manager.GetSessionEnumerator(out sessionEnum));
            int count;
            sessionEnum.GetCount(out count);
            var sessions = new Dictionary<int, AudioSessionInfo>();

            for (int i = 0; i < count; i++) {
                IAudioSessionControl control;
                if (sessionEnum.GetSession(i, out control) != 0 || control == null) continue;
                var control2 = (IAudioSessionControl2)control;
                var simple = (ISimpleAudioVolume)control;
                uint pidRaw;
                float level;
                bool muted;
                control2.GetProcessId(out pidRaw);
                simple.GetMasterVolume(out level);
                simple.GetMute(out muted);
                int pid = (int)pidRaw;
                if (sessions.ContainsKey(pid)) continue;

                string processName = pid == 0 ? "System" : "Proces " + pid;
                string displayName = null;
                control.GetDisplayName(out displayName);
                if (pid != 0) {
                    try {
                        var process = Process.GetProcessById(pid);
                        processName = process.ProcessName;
                        if (String.IsNullOrWhiteSpace(displayName)) displayName = process.MainWindowTitle;
                    } catch { }
                }
                if (String.IsNullOrWhiteSpace(displayName)) displayName = pid == 0 ? "Dźwięki systemowe" : processName;
                sessions[pid] = new AudioSessionInfo {
                    id = pid,
                    name = displayName,
                    process = processName,
                    volume = (int)Math.Round(level * 100),
                    muted = muted
                };
            }

            var list = new List<AudioSessionInfo>(sessions.Values);
            list.Sort((a, b) => String.Compare(a.name, b.name, StringComparison.CurrentCultureIgnoreCase));
            return new AudioSnapshot {
                master = (int)Math.Round(master * 100),
                muted = masterMuted,
                microphoneMuted = MicrophoneMuted(),
                sessions = list
            };
        }

        public static bool MicrophoneMuted() {
            bool muted;
            Endpoint(EDataFlow.Capture, ERole.Communications).GetMute(out muted);
            return muted;
        }

        public static AudioStatus Status() {
            bool muted;
            Endpoint(EDataFlow.Render, ERole.Multimedia).GetMute(out muted);
            return new AudioStatus { muted = muted, microphoneMuted = MicrophoneMuted() };
        }

        public static bool ToggleMicrophone() {
            var endpoint = Endpoint(EDataFlow.Capture, ERole.Communications);
            bool muted;
            endpoint.GetMute(out muted);
            endpoint.SetMute(!muted, Guid.Empty);
            return !muted;
        }

        public static void SetMaster(int volume) {
            var endpoint = Activate<IAudioEndpointVolume>(DefaultDevice(), "5CDF2C82-841E-4546-9722-0CF74078229A");
            endpoint.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, volume)) / 100f, Guid.Empty);
        }

        public static void SetSession(int processId, int volume) {
            var manager = Activate<IAudioSessionManager2>(DefaultDevice(), "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
            IAudioSessionEnumerator sessionEnum;
            manager.GetSessionEnumerator(out sessionEnum);
            int count;
            sessionEnum.GetCount(out count);
            float level = Math.Max(0, Math.Min(100, volume)) / 100f;
            for (int i = 0; i < count; i++) {
                IAudioSessionControl control;
                if (sessionEnum.GetSession(i, out control) != 0 || control == null) continue;
                var control2 = (IAudioSessionControl2)control;
                uint pid;
                control2.GetProcessId(out pid);
                if ((int)pid == processId) ((ISimpleAudioVolume)control).SetMasterVolume(level, Guid.Empty);
            }
        }
    }
}
'@
}

$Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
switch ($Action) {
    'master' { [EndoDeck.Audio]::SetMaster($Volume); @{ ok = $true } | ConvertTo-Json -Compress }
    'session' { [EndoDeck.Audio]::SetSession($SessionId, $Volume); @{ ok = $true } | ConvertTo-Json -Compress }
    'microphone-toggle' { @{ ok = $true; muted = [EndoDeck.Audio]::ToggleMicrophone() } | ConvertTo-Json -Compress }
    'status' { [EndoDeck.Audio]::Status() | ConvertTo-Json -Compress }
    default { [EndoDeck.Audio]::List() | ConvertTo-Json -Depth 5 -Compress }
}
