using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Jarvis.Host.Services;

internal static class ShortcutProcessIdentityReader
{
    private const int BufferLength = 1_024;
    private static readonly Guid ShellLinkClassId = new("00021401-0000-0000-C000-000000000046");

    public static IReadOnlyList<string> TryReadProcessNames(string shortcutPath)
    {
        object? shellLinkObject = null;
        try
        {
            var shellLinkType = Type.GetTypeFromCLSID(ShellLinkClassId, throwOnError: true)!;
            shellLinkObject = Activator.CreateInstance(shellLinkType);
            if (shellLinkObject is not IShellLinkW shellLink ||
                shellLinkObject is not IPersistFile persistFile)
            {
                return Array.Empty<string>();
            }

            persistFile.Load(shortcutPath, 0);
            var targetPath = new StringBuilder(BufferLength);
            shellLink.GetPath(targetPath, targetPath.Capacity, IntPtr.Zero, 0);
            var arguments = new StringBuilder(BufferLength);
            shellLink.GetArguments(arguments, arguments.Capacity);

            var processNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            AddTargetProcessName(processNames, targetPath.ToString());
            AddProcessStartArgument(processNames, arguments.ToString());
            AddKnownAliases(processNames);
            return processNames.ToArray();
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException or IOException or UnauthorizedAccessException)
        {
            return Array.Empty<string>();
        }
        finally
        {
            if (shellLinkObject is not null && Marshal.IsComObject(shellLinkObject))
            {
                _ = Marshal.FinalReleaseComObject(shellLinkObject);
            }
        }
    }

    private static void AddTargetProcessName(ISet<string> processNames, string targetPath)
    {
        var expandedPath = Environment.ExpandEnvironmentVariables(targetPath.Trim());
        if (string.IsNullOrWhiteSpace(expandedPath)) return;
        var extension = Path.GetExtension(expandedPath);
        if (extension.Equals(".msc", StringComparison.OrdinalIgnoreCase))
        {
            processNames.Add("mmc");
            return;
        }
        if (extension.Equals(".cmd", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".bat", StringComparison.OrdinalIgnoreCase))
        {
            processNames.Add("cmd");
            return;
        }
        if (!extension.Equals(".exe", StringComparison.OrdinalIgnoreCase) &&
            !extension.Equals(".com", StringComparison.OrdinalIgnoreCase)) return;
        var processName = Path.GetFileNameWithoutExtension(expandedPath);
        if (!string.IsNullOrWhiteSpace(processName)) processNames.Add(processName);
    }

    private static void AddProcessStartArgument(ISet<string> processNames, string arguments)
    {
        const string marker = "--processStart";
        var markerIndex = arguments.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex < 0) return;
        var value = arguments[(markerIndex + marker.Length)..].TrimStart();
        if (value.Length == 0) return;
        string executable;
        if (value[0] == '"')
        {
            var closingQuote = value.IndexOf('"', 1);
            executable = closingQuote > 1 ? value[1..closingQuote] : value[1..];
        }
        else
        {
            var separator = value.IndexOf(' ');
            executable = separator > 0 ? value[..separator] : value;
        }

        var processName = Path.GetFileNameWithoutExtension(executable.Trim());
        if (!string.IsNullOrWhiteSpace(processName)) processNames.Add(processName);
    }

    private static void AddKnownAliases(ISet<string> processNames)
    {
        if (processNames.Contains("wt")) processNames.Add("WindowsTerminal");
    }

    [ComImport]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath(
            [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file,
            int fileLength,
            IntPtr findData,
            uint flags);

        void GetIdList(out IntPtr itemIdList);
        void SetIdList(IntPtr itemIdList);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int nameLength);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder directory, int directoryLength);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string directory);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder arguments, int argumentsLength);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string arguments);
        void GetHotkey(out short hotkey);
        void SetHotkey(short hotkey);
        void GetShowCommand(out int showCommand);
        void SetShowCommand(int showCommand);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int iconPathLength, out int iconIndex);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string iconPath, int iconIndex);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
        void Resolve(IntPtr window, uint flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string path);
    }
}
