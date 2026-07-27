using System.Collections.Specialized;
using System.Runtime.InteropServices;
using System.Windows;
using Jarvis.Host.Bridge;

namespace Jarvis.Host.Services;

internal sealed class DesktopClipboardService
{
    private const string PreferredDropEffect = "Preferred DropEffect";
    private const uint DropEffectCopy = 1;
    private const uint DropEffectMove = 2;

    public DesktopClipboardState Write(IReadOnlyList<string> requestedPaths, string requestedMode)
    {
        var mode = NormalizeMode(requestedMode);
        var paths = FileExplorerService.NormalizeOperationPaths(requestedPaths);
        var collection = new StringCollection();
        collection.AddRange(paths.ToArray());

        var data = new DataObject();
        data.SetFileDropList(collection);
        data.SetData(
            PreferredDropEffect,
            new MemoryStream(BitConverter.GetBytes(mode == "move" ? DropEffectMove : DropEffectCopy)));

        try
        {
            Clipboard.SetDataObject(data, copy: true);
        }
        catch (ExternalException exception)
        {
            throw new BridgeFaultException(
                "CLIPBOARD_BUSY",
                $"Windows clipboard is temporarily unavailable: {exception.Message}");
        }

        return new DesktopClipboardState(paths, mode, "jarvis", DateTimeOffset.UtcNow);
    }

    public DesktopClipboardState Read()
    {
        try
        {
            if (!Clipboard.ContainsFileDropList())
            {
                return DesktopClipboardState.Empty;
            }

            var paths = Clipboard.GetFileDropList()
                .Cast<string>()
                .Where(path => File.Exists(path) || Directory.Exists(path))
                .Take(128)
                .SelectMany(path =>
                {
                    try
                    {
                        return FileExplorerService.NormalizeOperationPaths([path]);
                    }
                    catch (BridgeFaultException)
                    {
                        return Array.Empty<string>();
                    }
                })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (paths.Length == 0)
            {
                return DesktopClipboardState.Empty;
            }

            return new DesktopClipboardState(
                paths,
                ReadPreferredMode(),
                "windows",
                DateTimeOffset.UtcNow);
        }
        catch (ExternalException exception)
        {
            throw new BridgeFaultException(
                "CLIPBOARD_BUSY",
                $"Windows clipboard is temporarily unavailable: {exception.Message}");
        }
    }

    public DesktopClipboardState Clear()
    {
        try
        {
            Clipboard.Clear();
            return DesktopClipboardState.Empty;
        }
        catch (ExternalException exception)
        {
            throw new BridgeFaultException(
                "CLIPBOARD_BUSY",
                $"Windows clipboard is temporarily unavailable: {exception.Message}");
        }
    }

    private static string ReadPreferredMode()
    {
        var data = Clipboard.GetDataObject()?.GetData(PreferredDropEffect);
        var bytes = data switch
        {
            MemoryStream stream => stream.ToArray(),
            byte[] raw => raw,
            _ => Array.Empty<byte>()
        };
        return bytes.Length >= sizeof(uint) && BitConverter.ToUInt32(bytes, 0) == DropEffectMove
            ? "move"
            : "copy";
    }

    private static string NormalizeMode(string mode)
    {
        var normalized = mode.Trim().ToLowerInvariant();
        return normalized is "copy" or "move"
            ? normalized
            : throw new BridgeFaultException(
                "INVALID_PARAMS",
                "Clipboard mode must be copy or move.");
    }
}

internal sealed record DesktopClipboardState(
    IReadOnlyList<string> Paths,
    string Mode,
    string Source,
    DateTimeOffset ChangedAtUtc)
{
    public static DesktopClipboardState Empty { get; } = new(
        Array.Empty<string>(),
        "copy",
        "empty",
        DateTimeOffset.UtcNow);
}
