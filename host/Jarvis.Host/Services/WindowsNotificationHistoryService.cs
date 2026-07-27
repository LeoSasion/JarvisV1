using System.Runtime.InteropServices;
using System.Text;

namespace Jarvis.Host.Services;

internal sealed class WindowsNotificationHistoryService
{
    private const int AppModelErrorNoPackage = 15700;
    private const int ErrorInsufficientBuffer = 122;

    public WindowsNotificationHistoryState GetState()
    {
        var osBuild = Environment.OSVersion.Version.Build;
        var packageIdentity = TryGetPackageIdentity();
        var apiAvailable = osBuild >= 14393;
        var packaged = !string.IsNullOrWhiteSpace(packageIdentity);
        var accessStatus = !apiAvailable
            ? "unsupported"
            : !packaged
                ? "requires-package-identity"
                : "adapter-not-enabled";
        var reason = accessStatus switch
        {
            "unsupported" =>
                "UserNotificationListener is unavailable on this Windows build.",
            "requires-package-identity" =>
                "Windows notification history requires a signed MSIX package identity and explicit user consent.",
            _ =>
                "A signed package identity is present, but the audited permission adapter is not enabled in this build."
        };

        return new WindowsNotificationHistoryState(
            Provider: "UserNotificationListener",
            ApiAvailable: apiAvailable,
            Packaged: packaged,
            PackageIdentity: packageIdentity,
            AccessStatus: accessStatus,
            HistoryAvailable: false,
            CanRequestAccess: false,
            Reason: reason,
            OsBuild: osBuild,
            MinimumBuild: 14393,
            Items: Array.Empty<WindowsNotificationHistoryItem>(),
            CheckedAtUtc: DateTimeOffset.UtcNow);
    }

    public WindowsNotificationHistoryState RequestAccess()
    {
        var state = GetState();
        return state with
        {
            CheckedAtUtc = DateTimeOffset.UtcNow
        };
    }

    private static string? TryGetPackageIdentity()
    {
        uint length = 0;
        var result = GetCurrentPackageFullName(ref length, null);
        if (result == AppModelErrorNoPackage)
        {
            return null;
        }

        if (result != ErrorInsufficientBuffer || length == 0)
        {
            return null;
        }

        var builder = new StringBuilder((int)length);
        result = GetCurrentPackageFullName(ref length, builder);
        return result == 0 ? builder.ToString() : null;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetCurrentPackageFullName(
        ref uint packageFullNameLength,
        StringBuilder? packageFullName);
}

internal sealed record WindowsNotificationHistoryState(
    string Provider,
    bool ApiAvailable,
    bool Packaged,
    string? PackageIdentity,
    string AccessStatus,
    bool HistoryAvailable,
    bool CanRequestAccess,
    string Reason,
    int OsBuild,
    int MinimumBuild,
    IReadOnlyList<WindowsNotificationHistoryItem> Items,
    DateTimeOffset CheckedAtUtc);

internal sealed record WindowsNotificationHistoryItem(
    uint Id,
    string AppName,
    string Title,
    string Body,
    DateTimeOffset CreatedAtUtc);
