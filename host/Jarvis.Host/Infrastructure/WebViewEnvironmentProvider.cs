using System.IO;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host.Infrastructure;

internal static class WebViewEnvironmentProvider
{
    private static readonly Lazy<Task<CoreWebView2Environment>> SharedEnvironment =
        new(CreateEnvironmentAsync, LazyThreadSafetyMode.ExecutionAndPublication);

    public static Task<CoreWebView2Environment> GetAsync() => SharedEnvironment.Value;

    private static Task<CoreWebView2Environment> CreateEnvironmentAsync()
    {
        var userDataDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JARVIS",
            "WebView2");
        Directory.CreateDirectory(userDataDirectory);
        return CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: userDataDirectory);
    }
}
