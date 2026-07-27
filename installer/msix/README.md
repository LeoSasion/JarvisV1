# MSIX notification-history gate

JARVIS currently ships through the unpackaged installer path. Windows
notification history stays disabled there.

Before enabling the packaged adapter:

1. Create and sign an MSIX package identity for `Jarvis.Host.exe`.
2. Merge `user-notification-listener.capability.xml` into the package
   `Capabilities` element.
3. Declare the notification-history privacy purpose in release documentation.
4. Implement and test `UserNotificationListener.RequestAccessAsync` on the UI
   thread.
5. Treat every non-allowed access status as a normal unavailable state.
6. Validate installation, upgrade, uninstall, and revocation on Windows 10
   1809+ and Windows 11.

The current host probe intentionally returns no Windows notification items and
does not display a permission prompt. This prevents unpackaged development
builds from claiming access they do not possess.
