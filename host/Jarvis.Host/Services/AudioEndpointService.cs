using System.Runtime.InteropServices;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal sealed class AudioEndpointService : IDisposable
{
    private readonly object _gate = new();
    private readonly AudioNotificationClient _notificationClient;
    private readonly AudioVolumeCallback _volumeCallback;

    private IMMDeviceEnumerator? _enumerator;
    private IAudioEndpointVolume? _endpointVolume;
    private AudioEndpointSnapshot _latest = AudioEndpointSnapshot.Unavailable(
        "Windows Core Audio has not been initialized.");
    private bool _disposed;

    public AudioEndpointService()
    {
        _notificationClient = new AudioNotificationClient(OnDefaultDeviceChanged);
        _volumeCallback = new AudioVolumeCallback(OnVolumeChanged);
        Initialize();
    }

    public event Action<AudioEndpointSnapshot>? SnapshotChanged;

    public AudioEndpointSnapshot GetSnapshot()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return AudioEndpointSnapshot.Unavailable("The audio service has stopped.");
            }

            _latest = CaptureLocked();
            return _latest;
        }
    }

    public AudioEndpointSnapshot SetVolume(int volumePercent)
    {
        if (volumePercent is < 0 or > 100)
        {
            throw new ArgumentOutOfRangeException(
                nameof(volumePercent),
                "Volume must be between 0 and 100.");
        }

        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_endpointVolume is null)
            {
                throw new InvalidOperationException(
                    _latest.Error ?? "The default Windows output endpoint is unavailable.");
            }

            Marshal.ThrowExceptionForHR(
                _endpointVolume.SetMasterVolumeLevelScalar(volumePercent / 100f, Guid.Empty));
            _latest = CaptureLocked();
        }

        Publish(_latest);
        return _latest;
    }

    public AudioEndpointSnapshot SetMuted(bool muted)
    {
        lock (_gate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (_endpointVolume is null)
            {
                throw new InvalidOperationException(
                    _latest.Error ?? "The default Windows output endpoint is unavailable.");
            }

            Marshal.ThrowExceptionForHR(_endpointVolume.SetMute(muted, Guid.Empty));
            _latest = CaptureLocked();
        }

        Publish(_latest);
        return _latest;
    }

    private void Initialize()
    {
        try
        {
            lock (_gate)
            {
                var enumeratorType = Type.GetTypeFromCLSID(
                    new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"),
                    throwOnError: true)!;
                _enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType)!;
                Marshal.ThrowExceptionForHR(
                    _enumerator.RegisterEndpointNotificationCallback(_notificationClient));
                RebindEndpointLocked();
            }
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            HostLog.Warning($"Windows Core Audio is unavailable: {ex.Message}");
            lock (_gate)
            {
                ReleaseEndpointLocked();
                ReleaseComObject(ref _enumerator);
                _latest = AudioEndpointSnapshot.Unavailable(
                    "Windows Core Audio could not be initialized.");
            }
        }
    }

    private void OnDefaultDeviceChanged()
    {
        AudioEndpointSnapshot snapshot;
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            RebindEndpointLocked();
            snapshot = _latest;
        }

        Publish(snapshot);
    }

    private void OnVolumeChanged(float volumeScalar, bool muted)
    {
        var snapshot = new AudioEndpointSnapshot(
            Available: true,
            VolumePercent: Math.Clamp((int)Math.Round(volumeScalar * 100), 0, 100),
            Muted: muted,
            DeviceLabel: "Default output",
            Error: null);

        lock (_gate)
        {
            if (_disposed || snapshot == _latest)
            {
                return;
            }

            _latest = snapshot;
        }

        Publish(snapshot);
    }

    private void RebindEndpointLocked()
    {
        ReleaseEndpointLocked();
        if (_enumerator is null)
        {
            _latest = AudioEndpointSnapshot.Unavailable(
                "Windows Core Audio is unavailable.");
            return;
        }

        IMMDevice? device = null;
        try
        {
            Marshal.ThrowExceptionForHR(
                _enumerator.GetDefaultAudioEndpoint(
                    EDataFlow.Render,
                    ERole.Multimedia,
                    out device));
            var interfaceId = typeof(IAudioEndpointVolume).GUID;
            Marshal.ThrowExceptionForHR(
                device.Activate(
                    ref interfaceId,
                    ClsContext.All,
                    IntPtr.Zero,
                    out var endpointObject));
            _endpointVolume = (IAudioEndpointVolume)endpointObject;
            Marshal.ThrowExceptionForHR(
                _endpointVolume.RegisterControlChangeNotify(_volumeCallback));
            _latest = CaptureLocked();
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException)
        {
            HostLog.Warning($"The default Windows output endpoint is unavailable: {ex.Message}");
            ReleaseEndpointLocked();
            _latest = AudioEndpointSnapshot.Unavailable(
                "No usable default Windows output endpoint was found.");
        }
        finally
        {
            ReleaseComObject(ref device);
        }
    }

    private AudioEndpointSnapshot CaptureLocked()
    {
        if (_endpointVolume is null)
        {
            return _latest.Available
                ? AudioEndpointSnapshot.Unavailable("The default output endpoint was disconnected.")
                : _latest;
        }

        try
        {
            Marshal.ThrowExceptionForHR(_endpointVolume.GetMasterVolumeLevelScalar(out var scalar));
            Marshal.ThrowExceptionForHR(_endpointVolume.GetMute(out var muted));
            return new AudioEndpointSnapshot(
                Available: true,
                VolumePercent: Math.Clamp((int)Math.Round(scalar * 100), 0, 100),
                Muted: muted,
                DeviceLabel: "Default output",
                Error: null);
        }
        catch (COMException ex)
        {
            HostLog.Warning($"Windows audio state could not be read: {ex.Message}");
            return AudioEndpointSnapshot.Unavailable(
                "The default Windows output endpoint is not responding.");
        }
    }

    private void Publish(AudioEndpointSnapshot snapshot)
    {
        var subscribers = SnapshotChanged;
        if (subscribers is null)
        {
            return;
        }

        foreach (Action<AudioEndpointSnapshot> subscriber in subscribers.GetInvocationList())
        {
            try
            {
                subscriber(snapshot);
            }
            catch (Exception ex)
            {
                HostLog.Error("An audio-state subscriber rejected a snapshot.", ex);
            }
        }
    }

    private void ReleaseEndpointLocked()
    {
        if (_endpointVolume is not null)
        {
            try
            {
                _ = _endpointVolume.UnregisterControlChangeNotify(_volumeCallback);
            }
            catch (COMException)
            {
                // The endpoint can disappear before Windows accepts unregistration.
            }
        }

        ReleaseComObject(ref _endpointVolume);
    }

    private static void ReleaseComObject<T>(ref T? instance)
        where T : class
    {
        var current = instance;
        instance = null;
        if (current is not null && Marshal.IsComObject(current))
        {
            _ = Marshal.FinalReleaseComObject(current);
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            ReleaseEndpointLocked();
            if (_enumerator is not null)
            {
                try
                {
                    _ = _enumerator.UnregisterEndpointNotificationCallback(_notificationClient);
                }
                catch (COMException)
                {
                    // Windows may already have torn down the enumerator during shutdown.
                }
            }

            ReleaseComObject(ref _enumerator);
            SnapshotChanged = null;
        }
    }
}

internal sealed record AudioEndpointSnapshot(
    bool Available,
    int? VolumePercent,
    bool Muted,
    string? DeviceLabel,
    string? Error)
{
    public static AudioEndpointSnapshot Unavailable(string error) =>
        new(false, null, false, null, error);
}

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
internal sealed class AudioVolumeCallback : IAudioEndpointVolumeCallback
{
    private readonly Action<float, bool> _changed;

    public AudioVolumeCallback(Action<float, bool> changed)
    {
        _changed = changed;
    }

    public int OnNotify(IntPtr notificationData)
    {
        if (notificationData == IntPtr.Zero)
        {
            return 0;
        }

        var data = Marshal.PtrToStructure<AudioVolumeNotificationData>(notificationData);
        _changed(data.MasterVolume, data.Muted);
        return 0;
    }
}

[ComVisible(true)]
[ClassInterface(ClassInterfaceType.None)]
internal sealed class AudioNotificationClient : IMMNotificationClient
{
    private readonly Action _defaultDeviceChanged;

    public AudioNotificationClient(Action defaultDeviceChanged)
    {
        _defaultDeviceChanged = defaultDeviceChanged;
    }

    public int OnDeviceStateChanged(string deviceId, int newState) => 0;

    public int OnDeviceAdded(string deviceId) => 0;

    public int OnDeviceRemoved(string deviceId) => 0;

    public int OnDefaultDeviceChanged(EDataFlow flow, ERole role, string? deviceId)
    {
        if (flow == EDataFlow.Render && role == ERole.Multimedia)
        {
            _defaultDeviceChanged();
        }

        return 0;
    }

    public int OnPropertyValueChanged(string deviceId, PropertyKey key) => 0;
}

[StructLayout(LayoutKind.Sequential)]
internal readonly struct AudioVolumeNotificationData
{
    public readonly Guid EventContext;

    [MarshalAs(UnmanagedType.Bool)]
    public readonly bool Muted;

    public readonly float MasterVolume;
    public readonly uint ChannelCount;
}

[StructLayout(LayoutKind.Sequential)]
internal readonly struct PropertyKey
{
    public readonly Guid FormatId;
    public readonly int PropertyId;
}

internal enum EDataFlow
{
    Render,
    Capture,
    All
}

internal enum ERole
{
    Console,
    Multimedia,
    Communications
}

[Flags]
internal enum ClsContext : uint
{
    InprocServer = 0x1,
    InprocHandler = 0x2,
    LocalServer = 0x4,
    RemoteServer = 0x10,
    All = InprocServer | InprocHandler | LocalServer | RemoteServer
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(EDataFlow dataFlow, int stateMask, out IntPtr devices);

    [PreserveSig]
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice device);

    [PreserveSig]
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);

    [PreserveSig]
    int RegisterEndpointNotificationCallback(IMMNotificationClient client);

    [PreserveSig]
    int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    [PreserveSig]
    int Activate(
        ref Guid interfaceId,
        ClsContext classContext,
        IntPtr activationParameters,
        [MarshalAs(UnmanagedType.IUnknown)] out object instance);

    [PreserveSig]
    int OpenPropertyStore(int storageAccess, out IntPtr properties);

    [PreserveSig]
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);

    [PreserveSig]
    int GetState(out int state);
}

[ComImport]
[Guid("657804FA-D6AD-4496-8A60-352752AF4F89")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolumeCallback
{
    [PreserveSig]
    int OnNotify(IntPtr notificationData);
}

[ComImport]
[Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMNotificationClient
{
    [PreserveSig]
    int OnDeviceStateChanged(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        int newState);

    [PreserveSig]
    int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string deviceId);

    [PreserveSig]
    int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string deviceId);

    [PreserveSig]
    int OnDefaultDeviceChanged(
        EDataFlow flow,
        ERole role,
        [MarshalAs(UnmanagedType.LPWStr)] string? deviceId);

    [PreserveSig]
    int OnPropertyValueChanged(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceId,
        PropertyKey key);
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    [PreserveSig]
    int RegisterControlChangeNotify(IAudioEndpointVolumeCallback callback);

    [PreserveSig]
    int UnregisterControlChangeNotify(IAudioEndpointVolumeCallback callback);

    [PreserveSig]
    int GetChannelCount(out uint channelCount);

    [PreserveSig]
    int SetMasterVolumeLevel(float levelDb, Guid eventContext);

    [PreserveSig]
    int SetMasterVolumeLevelScalar(float level, Guid eventContext);

    [PreserveSig]
    int GetMasterVolumeLevel(out float levelDb);

    [PreserveSig]
    int GetMasterVolumeLevelScalar(out float level);

    [PreserveSig]
    int SetChannelVolumeLevel(uint channelNumber, float levelDb, Guid eventContext);

    [PreserveSig]
    int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext);

    [PreserveSig]
    int GetChannelVolumeLevel(uint channelNumber, out float levelDb);

    [PreserveSig]
    int GetChannelVolumeLevelScalar(uint channelNumber, out float level);

    [PreserveSig]
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, Guid eventContext);

    [PreserveSig]
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);

    [PreserveSig]
    int GetVolumeStepInfo(out uint step, out uint stepCount);

    [PreserveSig]
    int VolumeStepUp(Guid eventContext);

    [PreserveSig]
    int VolumeStepDown(Guid eventContext);

    [PreserveSig]
    int QueryHardwareSupport(out uint hardwareSupportMask);

    [PreserveSig]
    int GetVolumeRange(out float minimumDb, out float maximumDb, out float incrementDb);
}
