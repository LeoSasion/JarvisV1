using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Services;

internal enum SystemSessionAction
{
    Lock,
    SignOut,
    Restart,
    ShutDown
}

internal sealed record SystemSessionActionDescriptor(
    string Id,
    string Label,
    string Detail,
    string Consequence,
    bool Destructive);

internal sealed record SystemSessionControlState(
    bool Available,
    int ConfirmationTimeoutSeconds,
    IReadOnlyList<SystemSessionActionDescriptor> Actions);

internal sealed record SystemSessionActionChallenge(
    string ActionId,
    string Title,
    string Detail,
    string Token,
    DateTimeOffset ExpiresAtUtc,
    bool Destructive);

internal sealed record SystemSessionActionResult(
    bool Accepted,
    string ActionId,
    string Message);

internal sealed record SystemSessionActionCancelResult(bool Cancelled);

internal interface ISystemSessionActionExecutor
{
    void Execute(SystemSessionAction action);
}

internal sealed class SystemSessionActionService : IDisposable
{
    internal const int ConfirmationTimeoutSeconds = 15;

    private static readonly string[] OrderedActionIds =
        ["lock", "sign-out", "restart", "shut-down"];

    private static readonly IReadOnlyDictionary<string, SessionActionDefinition> Definitions =
        new Dictionary<string, SessionActionDefinition>(StringComparer.Ordinal)
        {
            ["lock"] = new(
                SystemSessionAction.Lock,
                new SystemSessionActionDescriptor(
                    "lock",
                    "LOCK DEVICE",
                    "Return to the Windows sign-in screen without closing applications.",
                    "Your applications remain open and the current user session stays active.",
                    Destructive: false)),
            ["sign-out"] = new(
                SystemSessionAction.SignOut,
                new SystemSessionActionDescriptor(
                    "sign-out",
                    "SIGN OUT",
                    "End the current Windows user session.",
                    "Open applications may block sign-out so you can save unsaved work.",
                    Destructive: true)),
            ["restart"] = new(
                SystemSessionAction.Restart,
                new SystemSessionActionDescriptor(
                    "restart",
                    "RESTART",
                    "Restart Windows using the standard local shutdown service.",
                    "Open applications may block restart so you can save unsaved work.",
                    Destructive: true)),
            ["shut-down"] = new(
                SystemSessionAction.ShutDown,
                new SystemSessionActionDescriptor(
                    "shut-down",
                    "SHUT DOWN",
                    "Shut down this PC using the standard local shutdown service.",
                    "Open applications may block shutdown so you can save unsaved work.",
                    Destructive: true))
        };

    private readonly object _gate = new();
    private readonly ISystemSessionActionExecutor _executor;
    private readonly Func<DateTimeOffset> _utcNow;

    private PendingSessionAction? _pending;
    private bool _disposed;

    public SystemSessionActionService(
        ISystemSessionActionExecutor? executor = null,
        Func<DateTimeOffset>? utcNow = null)
    {
        _executor = executor ?? new WindowsSystemSessionActionExecutor();
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public SystemSessionControlState GetState()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        return new SystemSessionControlState(
            Available: OperatingSystem.IsWindows(),
            ConfirmationTimeoutSeconds,
            OrderedActionIds.Select(id => Definitions[id].Descriptor).ToArray());
    }

    public SystemSessionActionChallenge Prepare(string actionId)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        EnsureAvailable();
        var definition = GetDefinition(actionId);
        var now = _utcNow();
        var pending = new PendingSessionAction(
            definition.Action,
            definition.Descriptor.Id,
            RandomNumberGenerator.GetHexString(64).ToLowerInvariant(),
            now.AddSeconds(ConfirmationTimeoutSeconds));

        lock (_gate)
        {
            _pending = pending;
        }

        return new SystemSessionActionChallenge(
            pending.ActionId,
            definition.Descriptor.Label,
            definition.Descriptor.Consequence,
            pending.Token,
            pending.ExpiresAtUtc,
            definition.Descriptor.Destructive);
    }

    public SystemSessionActionResult Commit(string actionId, string token)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        EnsureAvailable();
        var definition = GetDefinition(actionId);
        var normalizedToken = NormalizeToken(token);
        PendingSessionAction? pending;

        lock (_gate)
        {
            pending = _pending;
            _pending = null;
        }

        if (pending is null ||
            pending.Action != definition.Action ||
            !string.Equals(pending.ActionId, definition.Descriptor.Id, StringComparison.Ordinal) ||
            !string.Equals(pending.Token, normalizedToken, StringComparison.Ordinal) ||
            pending.ExpiresAtUtc <= _utcNow())
        {
            throw new BridgeFaultException(
                "SESSION_CONFIRMATION_EXPIRED",
                "The session-action confirmation expired or no longer matches this request.");
        }

        _executor.Execute(definition.Action);
        return new SystemSessionActionResult(
            Accepted: true,
            definition.Descriptor.Id,
            $"{definition.Descriptor.Label} was accepted by Windows.");
    }

    public SystemSessionActionCancelResult Cancel()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        lock (_gate)
        {
            var cancelled = _pending is not null;
            _pending = null;
            return new SystemSessionActionCancelResult(cancelled);
        }
    }

    private static SessionActionDefinition GetDefinition(string actionId)
    {
        var normalized = actionId?.Trim();
        if (string.IsNullOrEmpty(normalized) ||
            !Definitions.TryGetValue(normalized, out var definition))
        {
            throw new BridgeFaultException(
                "SESSION_ACTION_NOT_ALLOWED",
                "Only lock, sign-out, restart, and shut-down session actions are allowed.");
        }

        return definition;
    }

    private static string NormalizeToken(string token)
    {
        var normalized = token?.Trim();
        if (normalized is null ||
            normalized.Length != 64 ||
            !normalized.All(char.IsAsciiHexDigit))
        {
            throw new BridgeFaultException(
                "INVALID_PARAMS",
                "The session-action confirmation token is invalid.");
        }

        return normalized.ToLowerInvariant();
    }

    private static void EnsureAvailable()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new BridgeFaultException(
                "SESSION_CONTROL_UNAVAILABLE",
                "Windows session controls are unavailable on this platform.");
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        lock (_gate)
        {
            _pending = null;
            _disposed = true;
        }
    }

    private sealed record SessionActionDefinition(
        SystemSessionAction Action,
        SystemSessionActionDescriptor Descriptor);

    private sealed record PendingSessionAction(
        SystemSessionAction Action,
        string ActionId,
        string Token,
        DateTimeOffset ExpiresAtUtc);
}

internal sealed class WindowsSystemSessionActionExecutor : ISystemSessionActionExecutor
{
    public void Execute(SystemSessionAction action)
    {
        if (action == SystemSessionAction.Lock)
        {
            if (!LockWorkStation())
            {
                throw new BridgeFaultException(
                    "SESSION_ACTION_FAILED",
                    $"Windows could not lock the workstation: {new Win32Exception().Message}");
            }

            return;
        }

        var arguments = action switch
        {
            SystemSessionAction.SignOut => new[] { "/l" },
            SystemSessionAction.Restart => new[] { "/r", "/t", "0" },
            SystemSessionAction.ShutDown => new[] { "/s", "/t", "0" },
            _ => throw new BridgeFaultException(
                "SESSION_ACTION_NOT_ALLOWED",
                "The requested Windows session action is not supported.")
        };

        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "shutdown.exe"),
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        try
        {
            using var process = Process.Start(startInfo);
            if (process is null)
            {
                throw new BridgeFaultException(
                    "SESSION_ACTION_FAILED",
                    "Windows did not accept the requested session action.");
            }
        }
        catch (Exception ex) when (ex is InvalidOperationException or Win32Exception)
        {
            throw new BridgeFaultException(
                "SESSION_ACTION_FAILED",
                $"Windows could not start the requested session action: {ex.Message}");
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LockWorkStation();
}
