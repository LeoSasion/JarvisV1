using System.Globalization;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.InteropServices;

namespace Jarvis.Host.Services;

internal sealed class PackagedApplicationService
{
    private const string AppsFolderParsingName = "shell:AppsFolder";
    private static readonly Guid ActivationManagerClassId = new("45BA127D-10A8-46EA-8AB7-56EA9078943C");

    public IReadOnlyList<PackagedApplication> ListApplications()
    {
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
        {
            return EnumerateAppsFolder();
        }

        var completion = new TaskCompletionSource<IReadOnlyList<PackagedApplication>>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                completion.SetResult(EnumerateAppsFolder());
            }
            catch (Exception ex)
            {
                completion.SetException(ex);
            }
        })
        {
            IsBackground = true,
            Name = "JARVIS AppsFolder index"
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return completion.Task.GetAwaiter().GetResult();
    }

    public int? ActivateApplication(string appUserModelId)
    {
        if (!IsValidAppUserModelId(appUserModelId))
        {
            throw new ArgumentException("The packaged application identifier is malformed.", nameof(appUserModelId));
        }

        var activationType = Type.GetTypeFromCLSID(ActivationManagerClassId, throwOnError: true)!;
        object? activationObject = null;
        try
        {
            activationObject = Activator.CreateInstance(activationType);
            if (activationObject is not IApplicationActivationManager activationManager)
            {
                throw new InvalidCastException("Windows did not expose the application activation manager.");
            }

            var result = activationManager.ActivateApplication(
                appUserModelId,
                null,
                ActivateOptions.None,
                out var processId);
            Marshal.ThrowExceptionForHR(result);
            return processId == 0 ? null : checked((int)processId);
        }
        finally
        {
            ReleaseComObject(activationObject);
        }
    }

    public static bool IsValidAppUserModelId([NotNullWhen(true)] string? appUserModelId)
    {
        if (string.IsNullOrWhiteSpace(appUserModelId) ||
            appUserModelId.Length > 512 ||
            appUserModelId.IndexOf('!') <= 0 ||
            appUserModelId.EndsWith('!'))
        {
            return false;
        }

        return appUserModelId.All(character =>
            !char.IsControl(character) &&
            !char.IsWhiteSpace(character) &&
            character is not '"' and not '\'' and not '\\' and not '/');
    }

    private static IReadOnlyList<PackagedApplication> EnumerateAppsFolder()
    {
        var applications = new List<PackagedApplication>();
        object? shellObject = null;
        object? folderObject = null;
        object? itemsObject = null;

        try
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application", throwOnError: false);
            if (shellType is null)
            {
                return applications;
            }

            shellObject = Activator.CreateInstance(shellType);
            if (shellObject is null)
            {
                return applications;
            }

            folderObject = ((dynamic)shellObject).NameSpace(AppsFolderParsingName);
            if (folderObject is null)
            {
                return applications;
            }

            itemsObject = ((dynamic)folderObject).Items();
            if (itemsObject is null)
            {
                return applications;
            }

            var count = Convert.ToInt32(((dynamic)itemsObject).Count, CultureInfo.InvariantCulture);
            for (var index = 0; index < count; index++)
            {
                object? itemObject = null;
                try
                {
                    itemObject = ((dynamic)itemsObject).Item(index);
                    if (itemObject is null)
                    {
                        continue;
                    }

                    var item = (dynamic)itemObject;
                    var label = Convert.ToString(item.Name, CultureInfo.CurrentCulture)?.Trim();
                    var appUserModelId = Convert.ToString(
                        item.ExtendedProperty("System.AppUserModel.ID"),
                        CultureInfo.InvariantCulture)?.Trim();
                    if (string.IsNullOrWhiteSpace(label) || !IsValidAppUserModelId(appUserModelId))
                    {
                        continue;
                    }

                    applications.Add(new PackagedApplication(
                        appUserModelId,
                        label,
                        ShellIconReader.TryReadParsingName($"{AppsFolderParsingName}\\{appUserModelId}")));
                }
                catch (Exception ex) when (ex is COMException or InvalidCastException or InvalidOperationException)
                {
                    // One stale AppsFolder entry must not prevent the rest of the catalog from loading.
                }
                finally
                {
                    ReleaseComObject(itemObject);
                }
            }
        }
        finally
        {
            ReleaseComObject(itemsObject);
            ReleaseComObject(folderObject);
            ReleaseComObject(shellObject);
        }

        return applications
            .DistinctBy(application => application.AppUserModelId, StringComparer.OrdinalIgnoreCase)
            .OrderBy(application => application.Label, StringComparer.CurrentCultureIgnoreCase)
            .ToArray();
    }

    private static void ReleaseComObject(object? instance)
    {
        if (instance is not null && Marshal.IsComObject(instance))
        {
            _ = Marshal.FinalReleaseComObject(instance);
        }
    }

    [ComImport]
    [Guid("2E941141-7F97-4756-BA1D-9DECDE894A3D")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string? arguments,
            ActivateOptions options,
            out uint processId);
    }

    [Flags]
    private enum ActivateOptions
    {
        None = 0
    }
}

internal sealed record PackagedApplication(
    string AppUserModelId,
    string Label,
    string? IconDataUrl);
