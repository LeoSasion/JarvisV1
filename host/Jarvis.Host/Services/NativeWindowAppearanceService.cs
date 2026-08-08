using System.Diagnostics;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Threading;
using Jarvis.Host.Infrastructure;

namespace Jarvis.Host.Services;

internal enum NativeWindowAppearanceMode
{
    Off,
    Conservative,
    Enhanced,
    Immersive
}

internal sealed class NativeWindowAppearanceService : IDisposable
{
    private const uint EventSystemForeground = 0x0003;
    private const uint EventObjectCreate = 0x8000;
    private const uint EventObjectDestroy = 0x8001;
    private const uint EventObjectShow = 0x8002;
    private const uint EventObjectHide = 0x8003;
    private const uint EventObjectLocationChange = 0x800B;
    private const uint WineventOutOfContext = 0x0000;
    private const uint WineventSkipOwnProcess = 0x0002;
    private const int ObjidWindow = 0;
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const long WsChild = 0x40000000L;
    private const long WsCaption = 0x00C00000L;
    private const long WsExToolWindow = 0x00000080L;
    private const uint GaRoot = 2;
    private const uint MonitorDefaultToNearest = 2;
    private const uint DwmwaExtendedFrameBounds = 9;
    private const uint DwmwaCloaked = 14;
    private const uint DwmwaUseImmersiveDarkMode = 20;
    private const uint DwmwaWindowCornerPreference = 33;
    private const uint DwmwaBorderColor = 34;
    private const uint DwmwaCaptionColor = 35;
    private const uint DwmwaTextColor = 36;
    private const int DwmWindowCornerPreferenceRound = 2;
    private const int TokenQuery = 0x0008;
    private const int TokenIntegrityLevel = 25;
    private const int ProcessQueryLimitedInformation = 0x1000;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private static readonly (uint Attribute, int DesiredValue)[] DwmAppearanceAttributes =
    [
        (DwmwaUseImmersiveDarkMode, 1),
        (DwmwaWindowCornerPreference, DwmWindowCornerPreferenceRound),
        (DwmwaBorderColor, ToColorRef(255, 106, 0)),
        (DwmwaCaptionColor, ToColorRef(0, 0, 0)),
        (DwmwaTextColor, ToColorRef(245, 241, 233))
    ];

    private static readonly HashSet<string> ExcludedWindowClasses = new(StringComparer.OrdinalIgnoreCase)
    {
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
        "Progman",
        "WorkerW",
        "DV2ControlHost",
        "MultitaskingViewFrame",
        "XamlExplorerHostIslandWindow"
    };

    private static readonly string SettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "JARVIS",
        "Settings",
        "window-appearance.json");

    private readonly Dispatcher _dispatcher;
    private readonly object _eventGate = new();
    private readonly object _hookGate = new();
    private readonly object _styleGate = new();
    private readonly List<QueuedWindowEvent> _pendingEvents = new();
    private readonly Dictionary<IntPtr, StyledWindow> _styledWindows = new();
    private readonly WinEventDelegate _eventCallback;
    private readonly Timer _eventTimer;
    private readonly uint _ownProcessId = checked((uint)Environment.ProcessId);
    private readonly long _ownProcessStartTimeUtcTicks;
    private readonly int _ownIntegrityLevel;
    private readonly bool _ownIntegrityKnown;
    private readonly int _osBuild;
    private readonly bool _windows11;
    private readonly NativeWindowAppearanceRuleSet _rules;

    private NativeWindowAppearanceMode _mode;
    private IReadOnlyList<NativeWindowAppearanceRule> _ruleSnapshot;
    private IReadOnlyList<NativeWindowCompatibilityEntry> _compatibilitySnapshot =
        Array.Empty<NativeWindowCompatibilityEntry>();
    private DateTimeOffset _compatibilitySnapshotExpiresAt = DateTimeOffset.MinValue;
    private NativeWindowGlowWindow? _glowWindow;
    private IntPtr _foregroundHook;
    private IntPtr _objectLifecycleHook;
    private IntPtr _locationHook;
    private IntPtr _glowTarget;
    private volatile bool _hooksReady;
    private bool _eventDispatchScheduled;
    private bool _processingEvents;
    private bool _started;
    private volatile bool _recoveryPersistenceFaulted;
    private string? _recoveryPersistenceFailureReason;
    private volatile bool _emergencyRestoreRequested;
    private volatile bool _disposed;
    private NativeWindowAppearanceState? _lastPublishedState;

    public NativeWindowAppearanceService(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher;
        _eventCallback = OnWinEvent;
        _eventTimer = new Timer(OnEventTimer, null, Timeout.Infinite, Timeout.Infinite);
        _ownProcessStartTimeUtcTicks = NativeWindowAppearanceRecovery.CurrentProcessStartTimeUtcTicks;
        _osBuild = Environment.OSVersion.Version.Build;
        _windows11 = _osBuild >= 22000;
        _ownIntegrityKnown = TryGetProcessIntegrityLevel(
            GetCurrentProcess(),
            out _ownIntegrityLevel);
        var settings = LoadSettings();
        _rules = new NativeWindowAppearanceRuleSet(settings?.Rules);
        _ruleSnapshot = _rules.GetSnapshot();
        _mode = TryParseMode(settings?.Mode, out var savedMode)
            ? savedMode
            : (_windows11
                ? NativeWindowAppearanceMode.Enhanced
                : NativeWindowAppearanceMode.Conservative);
    }

    public event Action<NativeWindowAppearanceState>? StateChanged;

    public NativeWindowAppearanceState GetState()
    {
        VerifyDispatcherAccess();
        var effectiveMode = GetEffectiveMode(out var fallbackReason);
        var safetyHotkeyStatus = GlobalSafetyHotkey.CaptureStatus();
        int styledWindowCount;
        bool recoveryArmed;
        lock (_styleGate)
        {
            styledWindowCount = _styledWindows.Count;
            recoveryArmed = !_recoveryPersistenceFaulted &&
                            (styledWindowCount == 0 || NativeWindowAppearanceRecovery.HasPendingSnapshot);
        }

        return new NativeWindowAppearanceState(
            ToWireValue(_mode),
            ToWireValue(effectiveMode),
            _osBuild,
            _windows11,
            styledWindowCount,
            fallbackReason,
            _hooksReady,
            _ownIntegrityKnown,
            safetyHotkeyStatus.Registered,
            recoveryArmed,
            _ruleSnapshot,
            GetCompatibilitySnapshot());
    }

    public NativeWindowAppearanceDiagnostic CaptureDiagnostics()
    {
        VerifyDispatcherAccess();
        var state = GetState();
        var hookContractReady = state.EffectiveMode == ToWireValue(NativeWindowAppearanceMode.Off)
            ? !state.HooksReady
            : state.HooksReady;
        var persistenceReady = IsSettingsPersistenceReady();
        var dwmReadbackReady = true;
        var verifiedStyledWindows = 0;
        NativeWindowGlowDiagnostic glowDiagnostic;

        lock (_styleGate)
        {
            foreach (var (window, styledWindow) in _styledWindows)
            {
                if (!IsWindow(window))
                {
                    dwmReadbackReady = false;
                    continue;
                }

                _ = GetWindowThreadProcessId(window, out var processId);
                if (processId != styledWindow.ProcessId ||
                    !NativeWindowAppearanceRecovery.TryGetProcessStartTimeUtcTicks(
                        processId,
                        out var processStartTimeUtcTicks) ||
                    processStartTimeUtcTicks != styledWindow.ProcessStartTimeUtcTicks)
                {
                    dwmReadbackReady = false;
                    continue;
                }

                var windowReady = true;
                foreach (var (attribute, desiredValue) in DwmAppearanceAttributes)
                {
                    if (!styledWindow.OriginalValues.ContainsKey(attribute))
                    {
                        continue;
                    }

                    if (DwmGetWindowAttribute(window, attribute, out int actualValue, sizeof(int)) != 0 ||
                        actualValue != desiredValue)
                    {
                        windowReady = false;
                    }
                }

                if (windowReady)
                {
                    verifiedStyledWindows++;
                }
                else
                {
                    dwmReadbackReady = false;
                }
            }

            glowDiagnostic = _glowWindow?.CaptureDiagnostics() ??
                             new NativeWindowGlowDiagnostic(0, 0);
        }

        var issues = new List<string>();
        if (!hookContractReady)
        {
            issues.Add("event-hook state does not match the effective mode");
        }

        if (!state.HostIntegrityVerified)
        {
            issues.Add("host integrity could not be verified");
        }

        if (!persistenceReady)
        {
            issues.Add("the saved mode or application rules do not match the active request");
        }

        if (!state.RecoveryArmed)
        {
            issues.Add("the crash-recovery snapshot is not armed");
        }

        if (!dwmReadbackReady)
        {
            issues.Add("one or more DWM attributes failed readback");
        }

        if (!glowDiagnostic.Ready)
        {
            issues.Add("one or more aura edges are not click-through and non-activating");
        }

        var detail = issues.Count == 0
            ? state.StyledWindowCount > 0
                ? $"{state.EffectiveMode.ToUpperInvariant()} is active; read back " +
                  $"{verifiedStyledWindows} styled window(s), with recovery and aura guards armed."
                : $"{state.EffectiveMode.ToUpperInvariant()} is healthy; hooks, integrity, " +
                  "persistence, recovery, and aura guards match the current mode."
            : string.Join("; ", issues) + ".";

        return new NativeWindowAppearanceDiagnostic(
            issues.Count == 0,
            hookContractReady,
            persistenceReady,
            state.StyledWindowCount > 0,
            dwmReadbackReady,
            verifiedStyledWindows,
            glowDiagnostic.Ready,
            glowDiagnostic.CreatedEdges,
            state.FallbackReason,
            detail);
    }

    public void Start()
    {
        VerifyDispatcherAccess();
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_started)
        {
            return;
        }

        _started = true;
        ReconcileHookRegistration();
        if (_hooksReady)
        {
            HostLog.Info(
                $"Native window appearance started in {ToWireValue(_mode)} mode on Windows build {_osBuild}.");
            ApplyMode();
        }
        else
        {
            _ = GetEffectiveMode(out var fallbackReason);
            HostLog.Info($"Native window appearance is inactive: {fallbackReason ?? "mode is off"}");
        }

        PublishStateIfChanged();
    }

    public NativeWindowAppearanceState SetMode(string mode)
    {
        VerifyDispatcherAccess();
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!TryParseMode(mode, out var requestedMode))
        {
            throw new ArgumentOutOfRangeException(nameof(mode), "Unsupported native window appearance mode.");
        }

        if (_mode != requestedMode)
        {
            RestoreAllStyledWindows();
            HideGlow();
            _mode = requestedMode;
            SaveSettings();
        }

        if (_started)
        {
            ReconcileHookRegistration();
        }

        if (_hooksReady)
        {
            ApplyMode();
        }
        else
        {
            RestoreAllStyledWindows();
            HideGlow();
        }

        HostLog.Info(
            $"Native window appearance mode is {ToWireValue(_mode)} " +
            $"(effective {ToWireValue(GetEffectiveMode(out _))}, hooks ready: {_hooksReady}).");

        PublishStateIfChanged(force: true);
        return GetState();
    }

    public NativeWindowAppearanceState SetRule(string processName, string action)
    {
        VerifyDispatcherAccess();
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_rules.TrySet(processName, action, out var normalizedProcessName, out var error))
        {
            throw new ArgumentException(error, nameof(processName));
        }

        _ruleSnapshot = _rules.GetSnapshot();
        SaveSettings();
        ReapplyRules();
        HostLog.Info(
            $"Native window appearance rule set: {normalizedProcessName} => {action.ToLowerInvariant()}.");
        PublishStateIfChanged(force: true);
        return GetState();
    }

    public NativeWindowAppearanceState RemoveRule(string processName)
    {
        VerifyDispatcherAccess();
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_rules.TryRemove(processName, out var normalizedProcessName, out var error))
        {
            if (error is not null)
            {
                throw new ArgumentException(error, nameof(processName));
            }

            return GetState();
        }

        _ruleSnapshot = _rules.GetSnapshot();
        SaveSettings();
        ReapplyRules();
        HostLog.Info($"Native window appearance rule removed: {normalizedProcessName}.");
        PublishStateIfChanged(force: true);
        return GetState();
    }

    public void EmergencyRestore()
    {
        _emergencyRestoreRequested = true;
        ReleaseHooks();
        RestoreAllStyledWindows();

        lock (_styleGate)
        {
            _glowTarget = IntPtr.Zero;
        }

        HideAuraWindowsNative();

        HostLog.Warning("Native window appearance emergency restore completed.");
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        if (!_dispatcher.CheckAccess())
        {
            _dispatcher.Invoke(Dispose);
            return;
        }

        _disposed = true;
        _eventTimer.Change(Timeout.Infinite, Timeout.Infinite);
        ReleaseHooks();
        if (_started)
        {
            RestoreAllStyledWindows();
        }
        HideGlow();
        NativeWindowGlowWindow? glowWindow;
        lock (_styleGate)
        {
            glowWindow = _glowWindow;
            _glowWindow = null;
        }

        glowWindow?.Close();
        lock (_eventGate)
        {
            _pendingEvents.Clear();
            _eventDispatchScheduled = false;
        }

        _eventTimer.Dispose();
    }

    private void ApplyMode()
    {
        var effectiveMode = GetEffectiveMode(out _);
        if (effectiveMode == NativeWindowAppearanceMode.Off)
        {
            RestoreAllStyledWindows();
            HideGlow();
            return;
        }

        if (effectiveMode == NativeWindowAppearanceMode.Immersive)
        {
            _ = EnumWindows((window, _) =>
            {
                TryStyleWindow(window);
                return true;
            }, IntPtr.Zero);
        }

        SynchronizeForegroundWindow();
    }

    private void ReapplyRules()
    {
        RestoreAllStyledWindows();
        HideGlow();
        InvalidateCompatibilitySnapshot();
        if (_hooksReady)
        {
            ApplyMode();
        }
    }

    private void OnWinEvent(
        IntPtr hook,
        uint eventType,
        IntPtr window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime)
    {
        if (_disposed || !_hooksReady || window == IntPtr.Zero ||
            (eventType != EventSystemForeground && (objectId != ObjidWindow || childId != 0)))
        {
            return;
        }

        var eventKind = eventType switch
        {
            EventSystemForeground => PendingWindowEvent.Foreground,
            EventObjectCreate => PendingWindowEvent.Create,
            EventObjectDestroy => PendingWindowEvent.Destroy,
            EventObjectShow => PendingWindowEvent.Show,
            EventObjectHide => PendingWindowEvent.Hide,
            EventObjectLocationChange => PendingWindowEvent.Location,
            _ => PendingWindowEvent.None
        };
        if (eventKind == PendingWindowEvent.None)
        {
            return;
        }

        var scheduleDispatch = false;
        lock (_eventGate)
        {
            var canCoalesceLocation = eventKind == PendingWindowEvent.Location &&
                                      _pendingEvents.Count > 0 &&
                                      _pendingEvents[^1] == new QueuedWindowEvent(
                                          window,
                                          PendingWindowEvent.Location);
            if (!canCoalesceLocation)
            {
                _pendingEvents.Add(new QueuedWindowEvent(window, eventKind));
            }

            if (!_eventDispatchScheduled)
            {
                _eventDispatchScheduled = true;
                scheduleDispatch = true;
            }
        }

        if (scheduleDispatch)
        {
            ScheduleEventProcessing();
        }
    }

    private void OnEventTimer(object? state)
    {
        if (_disposed || _dispatcher.HasShutdownStarted)
        {
            return;
        }

        lock (_eventGate)
        {
            _eventDispatchScheduled = false;
        }

        try
        {
            _ = _dispatcher.BeginInvoke(ProcessPendingEvents, DispatcherPriority.Background);
        }
        catch (InvalidOperationException) when (_disposed || _dispatcher.HasShutdownStarted)
        {
            // The dispatcher may reject the last queued native event during shutdown.
        }
    }

    private void ProcessPendingEvents()
    {
        if (_disposed || _processingEvents)
        {
            return;
        }

        _processingEvents = true;
        try
        {
            QueuedWindowEvent[] events;
            lock (_eventGate)
            {
                events = _pendingEvents.ToArray();
                _pendingEvents.Clear();
            }

            var effectiveMode = GetEffectiveMode(out _);
            if (effectiveMode == NativeWindowAppearanceMode.Off)
            {
                return;
            }

            var synchronizeForeground = false;
            foreach (var (window, eventKind) in events)
            {
                if (eventKind == PendingWindowEvent.Foreground)
                {
                    synchronizeForeground = true;
                    continue;
                }

                if (eventKind == PendingWindowEvent.Destroy)
                {
                    lock (_styleGate)
                    {
                        if (_styledWindows.Remove(window))
                        {
                            PersistRecoverySnapshotCore();
                            InvalidateCompatibilitySnapshot();
                        }
                    }

                    if (IsGlowTarget(window))
                    {
                        HideGlow();
                    }

                    continue;
                }

                if (eventKind == PendingWindowEvent.Hide)
                {
                    RestoreStyledWindow(window);
                    if (IsGlowTarget(window))
                    {
                        HideGlow();
                    }

                    continue;
                }

                if (effectiveMode == NativeWindowAppearanceMode.Immersive &&
                    eventKind is (PendingWindowEvent.Create or
                        PendingWindowEvent.Show or
                        PendingWindowEvent.Location))
                {
                    if (IsEligibleWindow(window, requireStandardCaption: true))
                    {
                        TryStyleWindow(window);
                    }
                    else
                    {
                        RestoreStyledWindow(window);
                    }
                }

                if (eventKind is (PendingWindowEvent.Create or
                        PendingWindowEvent.Show or
                        PendingWindowEvent.Location) &&
                    window == GetForegroundWindow())
                {
                    synchronizeForeground = true;
                }
            }

            if (synchronizeForeground)
            {
                SynchronizeForegroundWindow();
            }
        }
        finally
        {
            _processingEvents = false;
            PublishStateIfChanged();
        }
    }

    private void ScheduleEventProcessing()
    {
        try
        {
            _eventTimer.Change(40, Timeout.Infinite);
        }
        catch (ObjectDisposedException) when (_disposed)
        {
            // A native callback may race the service's final timer disposal.
        }
    }

    private void SynchronizeForegroundWindow()
    {
        var effectiveMode = GetEffectiveMode(out _);
        var foreground = GetForegroundWindow();

        if (effectiveMode == NativeWindowAppearanceMode.Enhanced)
        {
            IntPtr[] styledWindows;
            lock (_styleGate)
            {
                styledWindows = _styledWindows.Keys
                    .Where(window => window != foreground)
                    .ToArray();
            }

            foreach (var styledWindow in styledWindows)
            {
                RestoreStyledWindow(styledWindow);
            }
        }

        if (!IsEligibleWindow(foreground, requireStandardCaption: false))
        {
            if (effectiveMode == NativeWindowAppearanceMode.Enhanced)
            {
                RestoreStyledWindow(foreground);
            }

            HideGlow();
            return;
        }

        if (effectiveMode is NativeWindowAppearanceMode.Enhanced or NativeWindowAppearanceMode.Immersive &&
            IsEligibleWindow(foreground, requireStandardCaption: true))
        {
            TryStyleWindow(foreground);
        }

        if (GetEffectiveMode(out _) == NativeWindowAppearanceMode.Off)
        {
            HideGlow();
            return;
        }

        if (TryGetExtendedFrameBounds(foreground, out var bounds))
        {
            lock (_styleGate)
            {
                if (_disposed || _emergencyRestoreRequested)
                {
                    return;
                }

                _glowWindow ??= new NativeWindowGlowWindow();
                _glowTarget = foreground;
                _glowWindow.ShowAround(bounds);
            }
        }
        else
        {
            HideGlow();
        }
    }

    private bool TryStyleWindow(IntPtr window)
    {
        if (_disposed || _emergencyRestoreRequested || _recoveryPersistenceFaulted || !_windows11 ||
            !IsEligibleWindow(window, requireStandardCaption: true))
        {
            return false;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == 0 ||
            !NativeWindowAppearanceRecovery.TryGetProcessStartTimeUtcTicks(
                processId,
                out var processStartTimeUtcTicks))
        {
            return false;
        }

        lock (_styleGate)
        {
            if (_disposed || _emergencyRestoreRequested)
            {
                return false;
            }

            if (_styledWindows.TryGetValue(window, out var existing))
            {
                if (existing.ProcessId == processId &&
                    existing.ProcessStartTimeUtcTicks == processStartTimeUtcTicks)
                {
                    return true;
                }

                _styledWindows.Remove(window);
                if (!PersistRecoverySnapshotCore().Succeeded)
                {
                    InvalidateCompatibilitySnapshot();
                    return false;
                }
            }

            var originalValues = new Dictionary<uint, int>();
            foreach (var (attribute, _) in DwmAppearanceAttributes)
            {
                if (DwmGetWindowAttribute(window, attribute, out int originalValue, sizeof(int)) == 0)
                {
                    originalValues[attribute] = originalValue;
                }
            }

            if (originalValues.Count == 0)
            {
                return false;
            }

            // Arm the crash-recovery snapshot before changing any external DWM
            // value, so even termination between individual writes is recoverable.
            _styledWindows[window] = new StyledWindow(
                processId,
                processStartTimeUtcTicks,
                originalValues);
            var recoveryPersistence = PersistRecoverySnapshotCore();
            if (!recoveryPersistence.Succeeded)
            {
                _styledWindows.Remove(window);
                InvalidateCompatibilitySnapshot();
                return false;
            }

            var appliedAttributes = ApplyRecoveryGuardedAttributes(
                recoveryPersistence,
                originalValues,
                DwmAppearanceAttributes,
                (attribute, desiredValue) =>
                {
                    var value = desiredValue;
                    return DwmSetWindowAttribute(window, attribute, ref value, sizeof(int)) == 0;
                });

            if (appliedAttributes == 0)
            {
                _styledWindows.Remove(window);
                PersistRecoverySnapshotCore();
                InvalidateCompatibilitySnapshot();
                return false;
            }

            InvalidateCompatibilitySnapshot();
            return true;
        }
    }

    private void RestoreAllStyledWindows()
    {
        lock (_styleGate)
        {
            var restoredAny = false;
            foreach (var (window, styledWindow) in _styledWindows.ToArray())
            {
                if (RestoreStyledWindowCore(window, styledWindow))
                {
                    _styledWindows.Remove(window);
                    restoredAny = true;
                }
            }

            PersistRecoverySnapshotCore();
            if (restoredAny)
            {
                InvalidateCompatibilitySnapshot();
            }
        }
    }

    private void RestoreStyledWindow(IntPtr window)
    {
        lock (_styleGate)
        {
            if (!_styledWindows.TryGetValue(window, out var styledWindow))
            {
                return;
            }

            if (RestoreStyledWindowCore(window, styledWindow))
            {
                _styledWindows.Remove(window);
            }

            PersistRecoverySnapshotCore();
            InvalidateCompatibilitySnapshot();
        }
    }

    private static bool RestoreStyledWindowCore(IntPtr window, StyledWindow styledWindow)
    {
        if (!IsWindow(window))
        {
            return true;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId != styledWindow.ProcessId ||
            !NativeWindowAppearanceRecovery.TryGetProcessStartTimeUtcTicks(
                processId,
                out var processStartTimeUtcTicks) ||
            processStartTimeUtcTicks != styledWindow.ProcessStartTimeUtcTicks)
        {
            return true;
        }

        var restored = true;
        foreach (var (attribute, originalValue) in styledWindow.OriginalValues)
        {
            var value = originalValue;
            if (DwmSetWindowAttribute(window, attribute, ref value, sizeof(int)) != 0)
            {
                restored = false;
            }
        }

        return restored;
    }

    internal static int ApplyRecoveryGuardedAttributes(
        NativeWindowSnapshotPersistenceResult persistence,
        IReadOnlyDictionary<uint, int> originalValues,
        IReadOnlyList<(uint Attribute, int DesiredValue)> desiredAttributes,
        Func<uint, int, bool> tryApply)
    {
        if (!persistence.Succeeded)
        {
            return 0;
        }

        var appliedAttributes = 0;
        foreach (var (attribute, desiredValue) in desiredAttributes)
        {
            if (originalValues.ContainsKey(attribute) && tryApply(attribute, desiredValue))
            {
                appliedAttributes++;
            }
        }

        return appliedAttributes;
    }

    private NativeWindowSnapshotPersistenceResult PersistRecoverySnapshotCore()
    {
        var entries = _styledWindows.Select(item => new NativeWindowRecoveryEntry(
                item.Key.ToInt64(),
                item.Value.ProcessId,
                item.Value.ProcessStartTimeUtcTicks,
                item.Value.OriginalValues
                    .Select(attribute => new NativeDwmAttributeValue(attribute.Key, attribute.Value))
                    .ToArray()))
            .ToArray();
        var result = NativeWindowAppearanceRecovery.SaveSnapshot(
            Environment.ProcessId,
            _ownProcessStartTimeUtcTicks,
            entries);
        if (!result.Succeeded)
        {
            _recoveryPersistenceFailureReason = result.FailureReason;
            var firstPersistenceFailure = !_recoveryPersistenceFaulted;
            _recoveryPersistenceFaulted = true;
            if (firstPersistenceFailure)
            {
                HostLog.Warning(
                    "Native window appearance was disabled for this session because its recovery snapshot " +
                    $"could not be verified: {result.FailureReason ?? "unknown persistence failure"}");
                try
                {
                    _ = _dispatcher.BeginInvoke(
                        DispatcherPriority.Send,
                        new Action(ContainRecoveryPersistenceFailure));
                }
                catch (InvalidOperationException) when (_disposed)
                {
                    // Dispatcher shutdown is already fail-closed for external appearance writes.
                }
            }

        }

        return result;
    }

    private void ContainRecoveryPersistenceFailure()
    {
        if (_disposed || !_recoveryPersistenceFaulted)
        {
            return;
        }

        ReleaseHooks();
        var restored = 0;
        var remaining = 0;
        lock (_styleGate)
        {
            foreach (var (window, styledWindow) in _styledWindows.ToArray())
            {
                if (!RestoreStyledWindowCore(window, styledWindow))
                {
                    continue;
                }

                _styledWindows.Remove(window);
                restored++;
            }

            remaining = _styledWindows.Count;
        }

        HideGlow();
        InvalidateCompatibilitySnapshot();
        HostLog.Warning(
            $"Native window appearance recovery containment restored {restored} window(s); " +
            $"{remaining} target(s) remain covered by the last verified recovery snapshot.");
        PublishStateIfChanged(force: true);
    }

    private IReadOnlyList<NativeWindowCompatibilityEntry> GetCompatibilitySnapshot()
    {
        var now = DateTimeOffset.UtcNow;
        if (now < _compatibilitySnapshotExpiresAt)
        {
            return _compatibilitySnapshot;
        }

        HashSet<IntPtr> styledWindows;
        lock (_styleGate)
        {
            styledWindows = _styledWindows.Keys.ToHashSet();
        }

        var processes = new Dictionary<string, CompatibilityAccumulator>(
            StringComparer.OrdinalIgnoreCase);
        _ = EnumWindows((window, state) =>
        {
            if (!IsWindowVisible(window) ||
                GetAncestor(window, GaRoot) != window ||
                GetWindowTextLength(window) == 0)
            {
                return true;
            }

            _ = GetWindowThreadProcessId(window, out var processId);
            if (processId == 0 || !TryGetProcessName(processId, out var processName))
            {
                return true;
            }

            if (!processes.TryGetValue(processName, out var accumulator))
            {
                accumulator = new CompatibilityAccumulator(
                    processName,
                    _rules.Evaluate(processName));
                processes[processName] = accumulator;
            }

            accumulator.WindowCount++;
            if (styledWindows.Contains(window))
            {
                accumulator.StyledWindowCount++;
            }

            var classification = ClassifyWindowForCompatibility(
                window,
                processId,
                accumulator.RuleEvaluation);
            if (classification.Eligible)
            {
                accumulator.EligibleWindowCount++;
                accumulator.Decision = classification.Decision;
                accumulator.ReasonCode = classification.ReasonCode;
            }
            else if (accumulator.EligibleWindowCount == 0 &&
                     (!accumulator.HasClassification ||
                      GetDecisionPriority(classification.Decision) >
                      GetDecisionPriority(accumulator.Decision)))
            {
                accumulator.Decision = classification.Decision;
                accumulator.ReasonCode = classification.ReasonCode;
            }

            accumulator.HasClassification = true;
            return true;
        }, IntPtr.Zero);

        _compatibilitySnapshot = processes.Values
            .OrderBy(item => GetCompatibilitySortOrder(item.Decision))
            .ThenBy(item => item.ProcessName, StringComparer.OrdinalIgnoreCase)
            .Take(64)
            .Select(item => new NativeWindowCompatibilityEntry(
                item.ProcessName,
                item.WindowCount,
                item.EligibleWindowCount,
                item.StyledWindowCount,
                ToWireValue(item.Decision),
                item.ReasonCode))
            .ToArray();
        _compatibilitySnapshotExpiresAt = now.AddSeconds(1);
        return _compatibilitySnapshot;
    }

    private WindowCompatibilityClassification ClassifyWindowForCompatibility(
        IntPtr window,
        uint processId,
        NativeWindowAppearanceRuleEvaluation ruleEvaluation)
    {
        if (processId == _ownProcessId)
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Protected,
                "jarvis-host");
        }

        if (!ruleEvaluation.PermitsAppearance)
        {
            return new WindowCompatibilityClassification(
                false,
                ruleEvaluation.Decision,
                ruleEvaluation.ReasonCode);
        }

        if (IsExcludedOrElevatedProcess(processId))
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Limited,
                "integrity-or-access");
        }

        var style = GetWindowLongPtr(window, GwlStyle).ToInt64();
        var extendedStyle = GetWindowLongPtr(window, GwlExStyle).ToInt64();
        if ((style & WsChild) != 0 || (extendedStyle & WsExToolWindow) != 0)
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Limited,
                "non-application-window");
        }

        if ((style & WsCaption) != WsCaption)
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Limited,
                "no-standard-caption");
        }

        var className = GetWindowClassName(window);
        if (string.IsNullOrWhiteSpace(className) || ExcludedWindowClasses.Contains(className))
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Protected,
                "system-window-class");
        }

        if (IsWindowCloaked(window))
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Limited,
                "window-cloaked");
        }

        if (IsFullscreenWindow(window))
        {
            return new WindowCompatibilityClassification(
                false,
                NativeWindowAppearanceRuleDecision.Limited,
                "fullscreen");
        }

        return new WindowCompatibilityClassification(
            true,
            ruleEvaluation.Decision,
            ruleEvaluation.ReasonCode);
    }

    private static bool TryGetProcessName(uint processId, out string processName)
    {
        processName = string.Empty;
        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            return NativeWindowAppearanceRuleSet.TryNormalizeProcessName(
                process.ProcessName,
                out processName);
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException or Win32Exception)
        {
            return false;
        }
    }

    private void InvalidateCompatibilitySnapshot()
    {
        _compatibilitySnapshotExpiresAt = DateTimeOffset.MinValue;
    }

    private static int GetDecisionPriority(NativeWindowAppearanceRuleDecision decision) =>
        decision switch
        {
            NativeWindowAppearanceRuleDecision.Protected => 4,
            NativeWindowAppearanceRuleDecision.Denied => 3,
            NativeWindowAppearanceRuleDecision.Allowed => 2,
            NativeWindowAppearanceRuleDecision.Automatic => 1,
            _ => 0
        };

    private static int GetCompatibilitySortOrder(NativeWindowAppearanceRuleDecision decision) =>
        decision switch
        {
            NativeWindowAppearanceRuleDecision.Allowed => 0,
            NativeWindowAppearanceRuleDecision.Automatic => 1,
            NativeWindowAppearanceRuleDecision.Denied => 2,
            NativeWindowAppearanceRuleDecision.Limited => 3,
            _ => 4
        };

    private static string ToWireValue(NativeWindowAppearanceRuleDecision decision) =>
        decision switch
        {
            NativeWindowAppearanceRuleDecision.Allowed => "allowed",
            NativeWindowAppearanceRuleDecision.Denied => "denied",
            NativeWindowAppearanceRuleDecision.Protected => "protected",
            NativeWindowAppearanceRuleDecision.Limited => "limited",
            _ => "automatic"
        };

    private bool IsEligibleWindow(IntPtr window, bool requireStandardCaption)
    {
        if (window == IntPtr.Zero || !IsWindow(window) || !IsWindowVisible(window) ||
            GetAncestor(window, GaRoot) != window)
        {
            return false;
        }

        var style = GetWindowLongPtr(window, GwlStyle).ToInt64();
        var extendedStyle = GetWindowLongPtr(window, GwlExStyle).ToInt64();
        var hasStandardCaption = (style & WsCaption) == WsCaption;
        if ((style & WsChild) != 0 || (extendedStyle & WsExToolWindow) != 0 ||
            (requireStandardCaption && !hasStandardCaption))
        {
            return false;
        }

        _ = GetWindowThreadProcessId(window, out var processId);
        if (processId == 0 || processId == _ownProcessId || IsExcludedOrElevatedProcess(processId))
        {
            return false;
        }

        var className = GetWindowClassName(window);
        if (string.IsNullOrWhiteSpace(className) || ExcludedWindowClasses.Contains(className) ||
            GetWindowTextLength(window) == 0 || IsWindowCloaked(window) ||
            IsFullscreenWindow(window))
        {
            return false;
        }

        return true;
    }

    private bool IsExcludedOrElevatedProcess(uint processId)
    {
        if (!_ownIntegrityKnown)
        {
            return true;
        }

        try
        {
            using var process = Process.GetProcessById(checked((int)processId));
            if (!_rules.Evaluate(process.ProcessName).PermitsAppearance)
            {
                return true;
            }
        }
        catch (ArgumentException)
        {
            return true;
        }
        catch (InvalidOperationException)
        {
            return true;
        }
        catch (Win32Exception)
        {
            return true;
        }

        var processHandle = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (processHandle == IntPtr.Zero)
        {
            return true;
        }

        try
        {
            return !TryGetProcessIntegrityLevel(processHandle, out var integrityLevel) ||
                   integrityLevel > _ownIntegrityLevel;
        }
        finally
        {
            _ = CloseHandle(processHandle);
        }
    }

    private static bool TryGetProcessIntegrityLevel(IntPtr processHandle, out int integrityLevel)
    {
        integrityLevel = 0;
        if (!OpenProcessToken(processHandle, TokenQuery, out var tokenHandle))
        {
            return false;
        }

        try
        {
            _ = GetTokenInformation(tokenHandle, TokenIntegrityLevel, IntPtr.Zero, 0, out var size);
            if (size <= 0)
            {
                return false;
            }

            var buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!GetTokenInformation(tokenHandle, TokenIntegrityLevel, buffer, size, out _))
                {
                    return false;
                }

                var label = Marshal.PtrToStructure<TokenMandatoryLabel>(buffer);
                var subAuthorityCountPointer = GetSidSubAuthorityCount(label.Label.Sid);
                if (subAuthorityCountPointer == IntPtr.Zero)
                {
                    return false;
                }

                var count = Marshal.ReadByte(subAuthorityCountPointer);
                if (count == 0)
                {
                    return false;
                }

                var integrityPointer = GetSidSubAuthority(label.Label.Sid, checked((uint)(count - 1)));
                if (integrityPointer == IntPtr.Zero)
                {
                    return false;
                }

                integrityLevel = Marshal.ReadInt32(integrityPointer);
                return true;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            _ = CloseHandle(tokenHandle);
        }
    }

    private static bool IsWindowCloaked(IntPtr window) =>
        DwmGetWindowAttribute(window, DwmwaCloaked, out int cloaked, sizeof(int)) == 0 && cloaked != 0;

    private static bool IsFullscreenWindow(IntPtr window)
    {
        if (!TryGetExtendedFrameBounds(window, out var bounds))
        {
            return false;
        }

        var monitor = MonitorFromWindow(window, MonitorDefaultToNearest);
        var monitorInfo = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (monitor == IntPtr.Zero || !GetMonitorInfo(monitor, ref monitorInfo))
        {
            return false;
        }

        const int tolerance = 2;
        return Math.Abs(bounds.Left - monitorInfo.Monitor.Left) <= tolerance &&
               Math.Abs(bounds.Top - monitorInfo.Monitor.Top) <= tolerance &&
               Math.Abs(bounds.Right - monitorInfo.Monitor.Right) <= tolerance &&
               Math.Abs(bounds.Bottom - monitorInfo.Monitor.Bottom) <= tolerance;
    }

    private static bool TryGetExtendedFrameBounds(IntPtr window, out PixelRect bounds)
    {
        NativeRect nativeBounds;
        if (DwmGetWindowAttribute(
                window,
                DwmwaExtendedFrameBounds,
                out nativeBounds,
                Marshal.SizeOf<NativeRect>()) != 0 && !GetWindowRect(window, out nativeBounds))
        {
            bounds = default;
            return false;
        }

        if (nativeBounds.Right <= nativeBounds.Left || nativeBounds.Bottom <= nativeBounds.Top)
        {
            bounds = default;
            return false;
        }

        bounds = new PixelRect(
            nativeBounds.Left,
            nativeBounds.Top,
            nativeBounds.Right,
            nativeBounds.Bottom);
        return true;
    }

    private NativeWindowAppearanceMode GetEffectiveMode(out string? fallbackReason)
    {
        if (_emergencyRestoreRequested)
        {
            fallbackReason = "Native window appearance is disabled by the emergency restore path.";
            return NativeWindowAppearanceMode.Off;
        }

        if (IsNativeAppearanceSafeMode())
        {
            fallbackReason =
                "Native window appearance is disabled because JARVIS_KEEP_NATIVE_TASKBAR=1.";
            return NativeWindowAppearanceMode.Off;
        }

        if (_recoveryPersistenceFaulted)
        {
            fallbackReason =
                "Native window appearance is disabled because recovery persistence failed verification." +
                (string.IsNullOrWhiteSpace(_recoveryPersistenceFailureReason)
                    ? string.Empty
                    : $" {_recoveryPersistenceFailureReason}");
            return NativeWindowAppearanceMode.Off;
        }

        if (!_ownIntegrityKnown)
        {
            fallbackReason =
                "Native window appearance is disabled because host integrity could not be verified.";
            return NativeWindowAppearanceMode.Off;
        }

        if (_mode == NativeWindowAppearanceMode.Off)
        {
            fallbackReason = null;
            return NativeWindowAppearanceMode.Off;
        }

        if (!_hooksReady)
        {
            fallbackReason = "Windows event hooks are unavailable in this session.";
            return NativeWindowAppearanceMode.Off;
        }

        if (!_windows11 && _mode is NativeWindowAppearanceMode.Enhanced or NativeWindowAppearanceMode.Immersive)
        {
            fallbackReason = "DWM title-bar styling requires Windows 11; conservative aura mode is active.";
            return NativeWindowAppearanceMode.Conservative;
        }

        var safetyHotkeyStatus = GlobalSafetyHotkey.CaptureStatus();
        if (_mode == NativeWindowAppearanceMode.Immersive && !safetyHotkeyStatus.Registered)
        {
            fallbackReason =
                "Immersive mode requires the global Ctrl+Shift+Q safety hotkey; enhanced mode is active." +
                (string.IsNullOrWhiteSpace(safetyHotkeyStatus.FailureReason)
                    ? string.Empty
                    : $" {safetyHotkeyStatus.FailureReason}");
            return NativeWindowAppearanceMode.Enhanced;
        }

        fallbackReason = null;
        return _mode;
    }

    private static bool IsNativeAppearanceSafeMode() =>
        string.Equals(
            Environment.GetEnvironmentVariable("JARVIS_KEEP_NATIVE_TASKBAR"),
            "1",
            StringComparison.Ordinal);

    private void HideAuraWindowsNative()
    {
        _ = EnumWindows((window, state) =>
        {
            _ = GetWindowThreadProcessId(window, out var processId);
            if (processId != _ownProcessId || GetWindowTextLength(window) == 0)
            {
                return true;
            }

            var title = new StringBuilder(64);
            if (GetWindowText(window, title, title.Capacity) > 0 &&
                title.ToString().Equals("JARVIS Window Aura", StringComparison.Ordinal))
            {
                _ = ShowWindowAsync(window, 0);
            }

            return true;
        }, IntPtr.Zero);
    }

    private void HideGlow()
    {
        lock (_styleGate)
        {
            _glowTarget = IntPtr.Zero;
            _glowWindow?.HideAura();
        }
    }

    private bool IsGlowTarget(IntPtr window)
    {
        lock (_styleGate)
        {
            return _glowTarget == window;
        }
    }

    private void PublishStateIfChanged(bool force = false)
    {
        var state = GetState();
        if (!force && state == _lastPublishedState)
        {
            return;
        }

        _lastPublishedState = state;
        StateChanged?.Invoke(state);
    }

    private static NativeWindowAppearanceSettings? LoadSettings()
    {
        try
        {
            if (!File.Exists(SettingsPath))
            {
                return null;
            }

            var settings = JsonSerializer.Deserialize<NativeWindowAppearanceSettings>(
                File.ReadAllText(SettingsPath),
                JsonOptions);
            return settings;
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
        {
            HostLog.Warning($"Native window appearance settings could not be read: {exception.Message}");
            return null;
        }
    }

    private bool IsSettingsPersistenceReady()
    {
        if (!File.Exists(SettingsPath))
        {
            var defaultMode = _windows11
                ? NativeWindowAppearanceMode.Enhanced
                : NativeWindowAppearanceMode.Conservative;
            return _mode == defaultMode && _ruleSnapshot.Count == 0;
        }

        var settings = LoadSettings();
        if (settings is null ||
            !TryParseMode(settings.Mode, out var savedMode) ||
            savedMode != _mode)
        {
            return false;
        }

        var savedRules = new NativeWindowAppearanceRuleSet(settings.Rules).GetSnapshot();
        return savedRules.SequenceEqual(_ruleSnapshot);
    }

    private void SaveSettings()
    {
        var temporaryPath = SettingsPath + ".tmp";
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
            var payload = JsonSerializer.Serialize(
                new NativeWindowAppearanceSettings
                {
                    SchemaVersion = 2,
                    Mode = ToWireValue(_mode),
                    Rules = _ruleSnapshot
                },
                JsonOptions);
            File.WriteAllText(temporaryPath, payload, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            File.Move(temporaryPath, SettingsPath, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            HostLog.Warning($"Native window appearance settings could not be saved: {exception.Message}");
        }
        finally
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                HostLog.Warning($"Temporary window appearance settings could not be removed: {exception.Message}");
            }
        }
    }

    private void ReconcileHookRegistration()
    {
        var shouldTrackWindows = _started &&
                                 _mode != NativeWindowAppearanceMode.Off &&
                                 !IsNativeAppearanceSafeMode() &&
                                 _ownIntegrityKnown &&
                                 !_emergencyRestoreRequested;
        if (!shouldTrackWindows)
        {
            ReleaseHooks();
            return;
        }

        EnsureHooks();
    }

    private void EnsureHooks()
    {
        lock (_hookGate)
        {
            if (_hooksReady || _emergencyRestoreRequested)
            {
                return;
            }

            ReleaseHooksCore();
            _foregroundHook = SetWinEventHook(
                EventSystemForeground,
                EventSystemForeground,
                IntPtr.Zero,
                _eventCallback,
                0,
                0,
                WineventOutOfContext);
            _objectLifecycleHook = SetWinEventHook(
                EventObjectCreate,
                EventObjectHide,
                IntPtr.Zero,
                _eventCallback,
                0,
                0,
                WineventOutOfContext | WineventSkipOwnProcess);
            _locationHook = SetWinEventHook(
                EventObjectLocationChange,
                EventObjectLocationChange,
                IntPtr.Zero,
                _eventCallback,
                0,
                0,
                WineventOutOfContext | WineventSkipOwnProcess);

            _hooksReady = _foregroundHook != IntPtr.Zero &&
                          _objectLifecycleHook != IntPtr.Zero &&
                          _locationHook != IntPtr.Zero;
            if (!_hooksReady)
            {
                ReleaseHooksCore();
                HostLog.Warning("Native window appearance hooks are unavailable; window styling is disabled.");
            }
        }
    }

    private void ReleaseHooks()
    {
        lock (_hookGate)
        {
            ReleaseHooksCore();
        }

        try
        {
            _eventTimer.Change(Timeout.Infinite, Timeout.Infinite);
        }
        catch (ObjectDisposedException) when (_disposed)
        {
            // Disposal may race a final mode reconciliation.
        }

        lock (_eventGate)
        {
            _pendingEvents.Clear();
            _eventDispatchScheduled = false;
        }
    }

    private void ReleaseHooksCore()
    {
        _hooksReady = false;
        if (_foregroundHook != IntPtr.Zero)
        {
            _ = UnhookWinEvent(_foregroundHook);
            _foregroundHook = IntPtr.Zero;
        }

        if (_objectLifecycleHook != IntPtr.Zero)
        {
            _ = UnhookWinEvent(_objectLifecycleHook);
            _objectLifecycleHook = IntPtr.Zero;
        }

        if (_locationHook != IntPtr.Zero)
        {
            _ = UnhookWinEvent(_locationHook);
            _locationHook = IntPtr.Zero;
        }

    }

    private void VerifyDispatcherAccess()
    {
        if (!_dispatcher.CheckAccess())
        {
            throw new InvalidOperationException(
                "Native window appearance operations must run on the host dispatcher.");
        }
    }

    private static bool TryParseMode(string? value, out NativeWindowAppearanceMode mode) =>
        Enum.TryParse(value, ignoreCase: true, out mode) &&
        Enum.IsDefined(mode);

    private static string ToWireValue(NativeWindowAppearanceMode mode) =>
        mode.ToString().ToLowerInvariant();

    private static int ToColorRef(byte red, byte green, byte blue) =>
        red | (green << 8) | (blue << 16);

    private static string GetWindowClassName(IntPtr window)
    {
        var className = new StringBuilder(256);
        return GetClassName(window, className, className.Capacity) > 0
            ? className.ToString()
            : string.Empty;
    }

    private enum PendingWindowEvent
    {
        None = 0,
        Foreground,
        Create,
        Destroy,
        Show,
        Hide,
        Location
    }

    private readonly record struct QueuedWindowEvent(IntPtr Window, PendingWindowEvent Kind);

    private sealed record StyledWindow(
        uint ProcessId,
        long ProcessStartTimeUtcTicks,
        IReadOnlyDictionary<uint, int> OriginalValues);

    private sealed class NativeWindowAppearanceSettings
    {
        public int SchemaVersion { get; init; }

        public string? Mode { get; init; }

        public IReadOnlyList<NativeWindowAppearanceRule>? Rules { get; init; }
    }

    private readonly record struct WindowCompatibilityClassification(
        bool Eligible,
        NativeWindowAppearanceRuleDecision Decision,
        string ReasonCode);

    private sealed class CompatibilityAccumulator
    {
        public CompatibilityAccumulator(
            string processName,
            NativeWindowAppearanceRuleEvaluation ruleEvaluation)
        {
            ProcessName = processName;
            RuleEvaluation = ruleEvaluation;
            Decision = ruleEvaluation.PermitsAppearance
                ? NativeWindowAppearanceRuleDecision.Limited
                : ruleEvaluation.Decision;
            ReasonCode = ruleEvaluation.PermitsAppearance
                ? "no-compatible-window"
                : ruleEvaluation.ReasonCode;
        }

        public string ProcessName { get; }

        public NativeWindowAppearanceRuleEvaluation RuleEvaluation { get; }

        public int WindowCount { get; set; }

        public int EligibleWindowCount { get; set; }

        public int StyledWindowCount { get; set; }

        public NativeWindowAppearanceRuleDecision Decision { get; set; }

        public string ReasonCode { get; set; }

        public bool HasClassification { get; set; }
    }

    private delegate void WinEventDelegate(
        IntPtr hook,
        uint eventType,
        IntPtr window,
        int objectId,
        int childId,
        uint eventThread,
        uint eventTime);

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect WorkArea;
        public uint Flags;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenMandatoryLabel
    {
        public SidAndAttributes Label;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr SetWinEventHook(
        uint eventMin,
        uint eventMax,
        IntPtr module,
        WinEventDelegate callback,
        uint processId,
        uint threadId,
        uint flags);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWinEvent(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindowAsync(IntPtr window, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr window, uint flags);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr window, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern IntPtr GetWindowLong32(IntPtr window, int index);

    private static IntPtr GetWindowLongPtr(IntPtr window, int index) =>
        IntPtr.Size == 8 ? GetWindowLongPtr64(window, index) : GetWindowLong32(window, index);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        uint attribute,
        out int value,
        int valueSize);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr window,
        uint attribute,
        out NativeRect value,
        int valueSize);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr window,
        uint attribute,
        ref int value,
        int valueSize);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(int desiredAccess, bool inheritHandle, uint processId);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr processHandle, int desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(
        IntPtr tokenHandle,
        int tokenInformationClass,
        IntPtr tokenInformation,
        int tokenInformationLength,
        out int returnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint subAuthority);
}

internal sealed record NativeWindowAppearanceState(
    string Mode,
    string EffectiveMode,
    int OsBuild,
    bool Windows11,
    int StyledWindowCount,
    string? FallbackReason,
    bool HooksReady,
    bool HostIntegrityVerified,
    bool SafetyHotkeyRegistered,
    bool RecoveryArmed,
    IReadOnlyList<NativeWindowAppearanceRule> Rules,
    IReadOnlyList<NativeWindowCompatibilityEntry> CompatibilityMatrix);

internal sealed record NativeWindowCompatibilityEntry(
    string ProcessName,
    int WindowCount,
    int EligibleWindowCount,
    int StyledWindowCount,
    string Decision,
    string ReasonCode);

internal sealed record NativeWindowAppearanceDiagnostic(
    bool Ready,
    bool HookContractReady,
    bool ModePersistenceReady,
    bool DwmReadbackPerformed,
    bool DwmReadbackReady,
    int VerifiedStyledWindows,
    bool GlowContractReady,
    int GlowEdges,
    string? FallbackReason,
    string Detail);
