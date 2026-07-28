using Jarvis.Host.Services;

namespace Jarvis.Host.Tests;

public sealed class QuickSearchShortcutSettingsServiceTests
{
    [Fact]
    public void MissingPreferenceDefaultsToEnabled()
    {
        using var settings = new TemporarySettings();

        var state = settings.CreateService().GetState();

        Assert.True(state.Enabled);
        Assert.Equal("Ctrl+Alt+J", state.Shortcut);
        Assert.Null(state.ConfigurationWarning);
    }

    [Fact]
    public void DisabledPreferencePersistsAcrossServiceInstances()
    {
        using var settings = new TemporarySettings();
        var service = settings.CreateService();
        var changes = 0;
        service.EnabledChanged += () => changes++;

        var disabled = service.SetEnabled(false);
        var reloaded = settings.CreateService().GetState();

        Assert.False(disabled.Enabled);
        Assert.False(disabled.Registered);
        Assert.Equal("disabled", disabled.Status);
        Assert.Equal(1, changes);
        Assert.False(reloaded.Enabled);
        Assert.Equal("disabled", reloaded.Status);
    }

    [Fact]
    public void RendererWarmupHasAnExplicitStartingState()
    {
        using var settings = new TemporarySettings();
        var service = settings.CreateService();

        service.ReportRuntimeStarting();
        var starting = service.GetState();
        service.ReportRuntimeSettled();
        var settled = service.GetState();

        Assert.True(starting.Enabled);
        Assert.False(starting.Registered);
        Assert.Equal("starting", starting.Status);
        Assert.NotEqual("starting", settled.Status);
    }

    [Fact]
    public void InvalidPreferenceFallsBackToEnabledWithAWarning()
    {
        using var settings = new TemporarySettings();
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(settings.Path)!);
        File.WriteAllText(settings.Path, "{ invalid json");

        var warnings = new List<string>();
        var state = settings.CreateService(warnings.Add).GetState();

        Assert.True(state.Enabled);
        Assert.NotNull(state.ConfigurationWarning);
        Assert.Single(warnings);
    }

    private sealed class TemporarySettings : IDisposable
    {
        private readonly string _directory = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(),
            "Jarvis.Host.Tests",
            Guid.NewGuid().ToString("N"));

        public string Path => System.IO.Path.Combine(
            _directory,
            "quick-search-shortcut.json");

        public QuickSearchShortcutSettingsService CreateService(
            Action<string>? warningSink = null) =>
            new(Path, warningSink ?? (_ => { }));

        public void Dispose()
        {
            if (Directory.Exists(_directory))
            {
                Directory.Delete(_directory, recursive: true);
            }
        }
    }
}
