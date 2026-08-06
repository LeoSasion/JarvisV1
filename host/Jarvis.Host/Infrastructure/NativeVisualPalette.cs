using System.Windows.Media;

namespace Jarvis.Host.Infrastructure;

internal static class NativeVisualPalette
{
    public static readonly Color AccentColor = Color.FromRgb(255, 106, 0);

    public static readonly SolidColorBrush BackgroundBrush = CreateBrush("#FF000000");
    public static readonly SolidColorBrush SurfaceBrush = CreateBrush("#F4050403");
    public static readonly SolidColorBrush SurfaceHoverBrush = CreateBrush("#F4100E0C");
    public static readonly SolidColorBrush StructureBrush = CreateBrush("#4A4540");
    public static readonly SolidColorBrush AccentBrush = CreateBrush("#FF6A00");
    public static readonly SolidColorBrush InkBrush = CreateBrush("#F5F1E9");
    public static readonly SolidColorBrush MutedBrush = CreateBrush("#837D75");
    public static readonly SolidColorBrush DangerBrush = CreateBrush("#FF806D");

    private static SolidColorBrush CreateBrush(string value)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));
        brush.Freeze();
        return brush;
    }
}
