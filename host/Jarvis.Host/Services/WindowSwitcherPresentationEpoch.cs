namespace Jarvis.Host.Services;

internal sealed class WindowSwitcherPresentationEpoch
{
    private long _current;

    public long Begin() => Interlocked.Increment(ref _current);

    public void Invalidate() => Interlocked.Increment(ref _current);

    public bool IsCurrent(long epoch) =>
        epoch == Volatile.Read(ref _current);
}
