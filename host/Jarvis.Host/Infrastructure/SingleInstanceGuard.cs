using System.Diagnostics;

namespace Jarvis.Host.Infrastructure;

internal sealed class SingleInstanceGuard : IDisposable
{
    private readonly Mutex _mutex;
    private bool _ownsMutex;

    private SingleInstanceGuard(Mutex mutex, bool ownsMutex)
    {
        _mutex = mutex;
        _ownsMutex = ownsMutex;
    }

    public static SingleInstanceGuard TryAcquire()
    {
        using var process = Process.GetCurrentProcess();
        var name = $@"Local\JARVIS.Host.Session.{process.SessionId}";
        var mutex = new Mutex(initiallyOwned: true, name, out var createdNew);
        return new SingleInstanceGuard(mutex, createdNew);
    }

    public bool IsAcquired => _ownsMutex;

    public void Dispose()
    {
        if (_ownsMutex)
        {
            try
            {
                _mutex.ReleaseMutex();
            }
            catch (ApplicationException)
            {
                // A process teardown race can release ownership before this cleanup path.
            }

            _ownsMutex = false;
        }

        _mutex.Dispose();
    }
}
