using System.IO;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host.Infrastructure;

internal static class WebViewEnvironmentProvider
{
    private static string? _isolatedUserDataDirectory;

    private static readonly Lazy<Task<CoreWebView2Environment>> SharedEnvironment =
        new(CreateEnvironmentAsync, LazyThreadSafetyMode.ExecutionAndPublication);

    public static Task<CoreWebView2Environment> GetAsync() => SharedEnvironment.Value;

    public static void UseIsolatedUserDataDirectory(string directory)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        if (SharedEnvironment.IsValueCreated)
        {
            throw new InvalidOperationException(
                "WebView2 user data cannot change after environment initialization.");
        }

        _isolatedUserDataDirectory = Path.GetFullPath(directory);
    }

    private static Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        var userDataDirectory = _isolatedUserDataDirectory ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS",
            "WebView2");
        Directory.CreateDirectory(userDataDirectory);
        return CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataDirectory);
    }
}
