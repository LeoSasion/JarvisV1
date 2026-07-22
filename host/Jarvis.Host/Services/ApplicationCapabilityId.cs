using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Jarvis.Host.Services;

internal static class ApplicationCapabilityId
{
    public static string FromShortcutPath(string shortcutPath) =>
        Create($"shortcut:{Path.GetFullPath(shortcutPath)}");

    public static string FromPackagedAppUserModelId(string appUserModelId) =>
        Create($"packaged:{appUserModelId}");

    private static string Create(string identity)
    {
        var normalized = identity.ToUpperInvariant();
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(normalized));
        return Convert.ToHexString(hash.AsSpan(0, 12)).ToLowerInvariant();
    }
}
