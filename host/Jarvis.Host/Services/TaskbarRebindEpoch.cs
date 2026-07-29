namespace Jarvis.Host.Services;

internal sealed class TaskbarRebindEpoch
{
    private long _current;

    public long Current => Volatile.Read(ref _current);

    public long Next() => Interlocked.Increment(ref _current);

    public bool IsCurrent(long generation) =>
        generation > 0 && generation == Current;

    public void Invalidate() => _ = Next();
}
