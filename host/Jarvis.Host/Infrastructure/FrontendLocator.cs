using System.IO;

namespace Jarvis.Host.Infrastructure;

internal static class FrontendLocator
{
    private const string OverrideVariable = "JARVIS_FRONTEND_DIST";

    public static string FindDistributionDirectory()
    {
        var overridePath = Environment.GetEnvironmentVariable(OverrideVariable);
        if (!string.IsNullOrWhiteSpace(overridePath))
        {
            return Validate(overridePath, $"environment variable {OverrideVariable}");
        }

        var packagedPath = Path.Combine(AppContext.BaseDirectory, "frontend");
        if (HasIndex(packagedPath))
        {
            return Path.GetFullPath(packagedPath);
        }

        foreach (var startPath in new[] { AppContext.BaseDirectory, Environment.CurrentDirectory })
        {
            var current = new DirectoryInfo(Path.GetFullPath(startPath));
            for (var depth = 0; depth < 10 && current is not null; depth++, current = current.Parent)
            {
                var candidate = Path.Combine(current.FullName, "frontend", "dist");
                if (HasIndex(candidate))
                {
                    return Path.GetFullPath(candidate);
                }
            }
        }

        throw new DirectoryNotFoundException(
            "Could not find frontend/dist/index.html. Build the frontend or set JARVIS_FRONTEND_DIST.");
    }

    private static string Validate(string candidate, string source)
    {
        var fullPath = Path.GetFullPath(candidate);
        if (!HasIndex(fullPath))
        {
            throw new DirectoryNotFoundException(
                $"The frontend directory from {source} does not contain index.html: {fullPath}");
        }

        return fullPath;
    }

    private static bool HasIndex(string directory)
    {
        return Directory.Exists(directory) && File.Exists(Path.Combine(directory, "index.html"));
    }
}
