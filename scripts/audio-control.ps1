param(
    [ValidateSet('list', 'status', 'master', 'session', 'microphone-toggle', 'process-toggle', 'devices', 'set-default')]
    [string]$Action = 'list',
    [int]$Volume = 50,
    [int]$SessionId = -1,
    [string]$ProcessName = '',
    [string]$DeviceId = ''
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($true)
[Console]::OutputEncoding = $OutputEncoding

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
        int EnumAudioEndpoints(EDataFlow dataFlow, uint stateMask, out IMMDeviceCollection devices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    public interface IMMDeviceCollection {
        int GetCount(out uint count);
        int Item(uint index, out IMMDevice device);
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    public interface IMMDevice {
        int Activate(ref Guid iid, CLSCTX context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        int OpenPropertyStore(int stgmAccess, out IPropertyStore properties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PROPERTYKEY {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PropVariant {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr ptr;
        public int padding;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
    public interface IPropertyStore {
        int GetCount(out uint count);
        int GetAt(uint index, ref PROPERTYKEY key);
        int GetValue(ref PROPERTYKEY key, out PropVariant value);
        int SetValue(ref PROPERTYKEY key, ref PropVariant value);
        int Commit();
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("568FB279-8128-4EA3-81EE-B4EE9E8C1234")]
    public interface IPolicyConfigVista {
        int Unused1();
        int Unused2();
        int Unused3();
        int Unused4();
        int Unused5();
        int Unused6();
        int Unused7();
        int Unused8();
        int Unused9();
        int Unused10();
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
        int Unused12();
        int Unused13();
        int Unused14();
        int Unused15();
        int Unused16();
        int Unused17();
        int Unused18();
        int Unused19();
        int Unused20();
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("f8679665-8fa6-41aa-8315-7b8e5f7a2b2a")]
    public interface IPolicyConfig {
        int Unused1();
        int Unused2();
        int Unused3();
        int Unused4();
        int Unused5();
        int Unused6();
        int Unused7();
        int Unused8();
        int Unused9();
        int Unused10();
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string deviceId, ERole role);
        int Unused12();
        int Unused13();
        int Unused14();
        int Unused15();
        int Unused16();
        int Unused17();
        int Unused18();
        int Unused19();
        int Unused20();
    }

    public sealed class OutputDeviceInfo {
        public string id;
        public string name;
        public bool isDefault;
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

    public sealed class ProcessAudioStatus {
        public bool available;
        public bool muted;
    }

    public static class Audio {
        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PropVariant pvar);

        private static readonly PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY {
            fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
            pid = 14
        };

        private static IMMDevice DefaultDevice(EDataFlow flow = EDataFlow.Render, ERole role = ERole.Multimedia) {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice device;
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, role, out device));
            return device;
        }

        private static List<IMMDevice> ActiveRenderDevices() {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDeviceCollection collection;
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(EDataFlow.Render, 1, out collection));
            uint count;
            Marshal.ThrowExceptionForHR(collection.GetCount(out count));
            var devices = new List<IMMDevice>();
            for (uint i = 0; i < count; i++) {
                IMMDevice device;
                if (collection.Item(i, out device) == 0 && device != null) devices.Add(device);
            }
            return devices;
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

        private static string DeviceId(IMMDevice device) {
            string id;
            Marshal.ThrowExceptionForHR(device.GetId(out id));
            return id;
        }

        private static string DeviceName(IMMDevice device) {
            IPropertyStore store;
            Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
            var key = PKEY_Device_FriendlyName;
            PropVariant value = new PropVariant();
            try {
                Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
                if (value.vt == 31 && value.ptr != IntPtr.Zero) return Marshal.PtrToStringUni(value.ptr) ?? "Urzadzenie audio";
                return "Urzadzenie audio";
            } finally {
                PropVariantClear(ref value);
            }
        }

        public static List<OutputDeviceInfo> ListOutputDevices() {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            string defaultId = DeviceId(DefaultDevice());
            IMMDeviceCollection collection;
            Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(EDataFlow.Render, 1, out collection));
            uint count;
            Marshal.ThrowExceptionForHR(collection.GetCount(out count));
            var devices = new List<OutputDeviceInfo>();
            for (uint i = 0; i < count; i++) {
                IMMDevice device;
                if (collection.Item(i, out device) != 0 || device == null) continue;
                string id = DeviceId(device);
                devices.Add(new OutputDeviceInfo {
                    id = id,
                    name = DeviceName(device),
                    isDefault = String.Equals(id, defaultId, StringComparison.OrdinalIgnoreCase)
                });
            }
            devices.Sort((a, b) => String.Compare(a.name, b.name, StringComparison.CurrentCultureIgnoreCase));
            return devices;
        }

        private static void SetDefaultForRole(string deviceId, ERole role) {
            Guid[] classIds = {
                new Guid("294935CE-F59A-4025-A694-F9077ECE4312"),
                new Guid("870af99c-171d-4b9e-4790-4181de7897a7")
            };
            Exception lastError = null;
            foreach (var classId in classIds) {
                try {
                    var policy = (IPolicyConfig)Activator.CreateInstance(Type.GetTypeFromCLSID(classId));
                    if (policy != null && policy.SetDefaultEndpoint(deviceId, role) == 0) return;
                } catch (Exception ex) { lastError = ex; }
                try {
                    var policyVista = (IPolicyConfigVista)Activator.CreateInstance(Type.GetTypeFromCLSID(classId));
                    if (policyVista != null && policyVista.SetDefaultEndpoint(deviceId, role) == 0) return;
                } catch (Exception ex) { lastError = ex; }
            }
            if (lastError != null) throw lastError;
            throw new InvalidOperationException("PolicyConfig unavailable");
        }

        public static void SetDefaultOutput(string deviceId) {
            if (String.IsNullOrWhiteSpace(deviceId)) throw new ArgumentException("Brak identyfikatora urzadzenia");
            SetDefaultForRole(deviceId, ERole.Multimedia);
            SetDefaultForRole(deviceId, ERole.Console);
            SetDefaultForRole(deviceId, ERole.Communications);
        }

        public static AudioSnapshot List() {
            IMMDevice device = DefaultDevice();
            var endpoint = Activate<IAudioEndpointVolume>(device, "5CDF2C82-841E-4546-9722-0CF74078229A");
            float master;
            bool masterMuted;
            endpoint.GetMasterVolumeLevelScalar(out master);
            endpoint.GetMute(out masterMuted);

            var sessions = new Dictionary<int, AudioSessionInfo>();

            foreach (var renderDevice in ActiveRenderDevices()) {
                var manager = Activate<IAudioSessionManager2>(renderDevice, "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
                IAudioSessionEnumerator sessionEnum;
                if (manager.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) continue;
                int count;
                sessionEnum.GetCount(out count);
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
                    AudioSessionInfo existing;
                    if (sessions.TryGetValue(pid, out existing)) {
                        existing.muted = existing.muted && muted;
                        existing.volume = Math.Max(existing.volume, (int)Math.Round(level * 100));
                        continue;
                    }

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

        public static ProcessAudioStatus ToggleProcess(string processName) {
            var matches = new List<ISimpleAudioVolume>();
            bool allMuted = true;

            foreach (var renderDevice in ActiveRenderDevices()) {
                var manager = Activate<IAudioSessionManager2>(renderDevice, "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
                IAudioSessionEnumerator sessionEnum;
                if (manager.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) continue;
                int count;
                sessionEnum.GetCount(out count);
                for (int i = 0; i < count; i++) {
                    IAudioSessionControl control;
                    if (sessionEnum.GetSession(i, out control) != 0 || control == null) continue;
                    var control2 = (IAudioSessionControl2)control;
                    uint pid;
                    control2.GetProcessId(out pid);
                    if (pid == 0) continue;
                    try {
                        var process = Process.GetProcessById((int)pid);
                        if (!String.Equals(process.ProcessName, processName, StringComparison.OrdinalIgnoreCase)) continue;
                        var simple = (ISimpleAudioVolume)control;
                        bool muted;
                        simple.GetMute(out muted);
                        allMuted = allMuted && muted;
                        matches.Add(simple);
                    } catch { }
                }
            }

            if (matches.Count == 0) return new ProcessAudioStatus { available = false, muted = false };
            bool next = !allMuted;
            foreach (var match in matches) match.SetMute(next, Guid.Empty);
            return new ProcessAudioStatus { available = true, muted = next };
        }

        public static void SetMaster(int volume) {
            var endpoint = Activate<IAudioEndpointVolume>(DefaultDevice(), "5CDF2C82-841E-4546-9722-0CF74078229A");
            endpoint.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, volume)) / 100f, Guid.Empty);
        }

        public static void SetSession(int processId, int volume) {
            float level = Math.Max(0, Math.Min(100, volume)) / 100f;
            foreach (var renderDevice in ActiveRenderDevices()) {
                var manager = Activate<IAudioSessionManager2>(renderDevice, "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
                IAudioSessionEnumerator sessionEnum;
                if (manager.GetSessionEnumerator(out sessionEnum) != 0 || sessionEnum == null) continue;
                int count;
                sessionEnum.GetCount(out count);
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
}
'@
}

$Volume = [Math]::Max(0, [Math]::Min(100, $Volume))
switch ($Action) {
    'master' { [EndoDeck.Audio]::SetMaster($Volume); @{ ok = $true } | ConvertTo-Json -Compress }
    'session' { [EndoDeck.Audio]::SetSession($SessionId, $Volume); @{ ok = $true } | ConvertTo-Json -Compress }
    'microphone-toggle' { @{ ok = $true; muted = [EndoDeck.Audio]::ToggleMicrophone() } | ConvertTo-Json -Compress }
    'process-toggle' { [EndoDeck.Audio]::ToggleProcess($ProcessName) | ConvertTo-Json -Compress }
    'status' { [EndoDeck.Audio]::Status() | ConvertTo-Json -Compress }
    'devices' { @{ devices = [EndoDeck.Audio]::ListOutputDevices() } | ConvertTo-Json -Depth 4 -Compress }
    'set-default' {
        if (-not $DeviceId) { throw 'Nie wybrano urzadzenia audio' }
        $svv = Join-Path $PSScriptRoot 'SoundVolumeView.exe'
        if (-not (Test-Path $svv)) {
            $fetch = Join-Path $PSScriptRoot 'fetch-soundvolumeview.ps1'
            if (Test-Path $fetch) { & $fetch }
        }
        if (Test-Path $svv) {
            & $svv /SetDefault $DeviceId all | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Nie udalo sie ustawic zrodla audio' }
        } else {
            try {
                [EndoDeck.Audio]::SetDefaultOutput($DeviceId)
            } catch {
                throw 'Brak narzedzia zmiany zrodla audio (SoundVolumeView)'
            }
        }
        @{ ok = $true } | ConvertTo-Json -Compress
    }
    default { [EndoDeck.Audio]::List() | ConvertTo-Json -Depth 5 -Compress }
}
