using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;

namespace Jarvis.Host.Services;

internal static class ShellIconReader
{
    private const uint ShgfiIcon = 0x000000100;
    private const uint ShgfiPidl = 0x000000008;

    public static string? TryReadPath(string path)
    {
        var fileInfo = new ShFileInfo();
        if (SHGetFileInfoByPath(
                path,
                0,
                ref fileInfo,
                (uint)Marshal.SizeOf<ShFileInfo>(),
                ShgfiIcon) == IntPtr.Zero ||
            fileInfo.IconHandle == IntPtr.Zero)
        {
            return null;
        }

        return TryEncodeAndDestroyIcon(fileInfo.IconHandle);
    }

    public static string? TryReadParsingName(string parsingName)
    {
        var result = SHParseDisplayName(
            parsingName,
            IntPtr.Zero,
            out var itemIdList,
            0,
            out _);
        if (result < 0 || itemIdList == IntPtr.Zero)
        {
            return null;
        }

        try
        {
            var fileInfo = new ShFileInfo();
            if (SHGetFileInfoByPidl(
                    itemIdList,
                    0,
                    ref fileInfo,
                    (uint)Marshal.SizeOf<ShFileInfo>(),
                    ShgfiPidl | ShgfiIcon) == IntPtr.Zero ||
                fileInfo.IconHandle == IntPtr.Zero)
            {
                return null;
            }

            return TryEncodeAndDestroyIcon(fileInfo.IconHandle);
        }
        finally
        {
            Marshal.FreeCoTaskMem(itemIdList);
        }
    }

    private static string? TryEncodeAndDestroyIcon(IntPtr iconHandle)
    {
        try
        {
            var bitmap = Imaging.CreateBitmapSourceFromHIcon(
                iconHandle,
                Int32Rect.Empty,
                BitmapSizeOptions.FromWidthAndHeight(32, 32));
            bitmap.Freeze();
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            using var stream = new MemoryStream();
            encoder.Save(stream);
            return $"data:image/png;base64,{Convert.ToBase64String(stream.ToArray())}";
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or NotSupportedException)
        {
            return null;
        }
        finally
        {
            _ = DestroyIcon(iconHandle);
        }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, EntryPoint = "SHGetFileInfoW")]
    private static extern IntPtr SHGetFileInfoByPath(
        string path,
        uint fileAttributes,
        ref ShFileInfo fileInfo,
        uint fileInfoSize,
        uint flags);

    [DllImport("shell32.dll", EntryPoint = "SHGetFileInfoW")]
    private static extern IntPtr SHGetFileInfoByPidl(
        IntPtr itemIdList,
        uint fileAttributes,
        ref ShFileInfo fileInfo,
        uint fileInfoSize,
        uint flags);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHParseDisplayName(
        string name,
        IntPtr bindContext,
        out IntPtr itemIdList,
        uint attributesIn,
        out uint attributesOut);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DestroyIcon(IntPtr icon);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShFileInfo
    {
        public IntPtr IconHandle;
        public int IconIndex;
        public uint Attributes;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string DisplayName;

        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string TypeName;
    }
}
