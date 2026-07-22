using System.Diagnostics;
using Microsoft.Web.WebView2.Core;

namespace Jarvis.Host.Infrastructure;

internal static class WebViewHostConfiguration
{
    private const string AppHostName = "jarvis.local";

    public static Uri CreateAppUri(string query) =>
        new($"https://{AppHostName}/index.html?{query}");

    public static void Apply(
        CoreWebView2 core,
        string frontendDirectory,
        string surfaceName,
        Action<CoreWebView2ProcessFailedEventArgs> onProcessFailed)
    {
        core.SetVirtualHostNameToFolderMapping(
            AppHostName,
            frontendDirectory,
            CoreWebView2HostResourceAccessKind.DenyCors);

        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.AreDevToolsEnabled = Debugger.IsAttached ||
                                            Environment.GetEnvironmentVariable("JARVIS_WEBVIEW2_DEVTOOLS") == "1";

        core.NavigationStarting += (_, args) =>
        {
            if (!IsTrustedAppUri(args.Uri))
            {
                args.Cancel = true;
                HostLog.Warning($"Blocked {surfaceName} WebView navigation: {args.Uri}");
            }
        };
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            HostLog.Warning($"Blocked {surfaceName} WebView popup: {args.Uri}");
        };
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        core.ProcessFailed += (_, args) => onProcessFailed(args);
    }

    private static bool IsTrustedAppUri(string? rawUri) =>
        Uri.TryCreate(rawUri, UriKind.Absolute, out var uri) &&
        uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
        uri.Host.Equals(AppHostName, StringComparison.OrdinalIgnoreCase);
}
