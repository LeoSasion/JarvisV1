using System.IO;
using System.Text.RegularExpressions;

namespace Jarvis.Host.Infrastructure;

internal sealed record LifecycleProbeOptions(
    string DataRoot,
    string ReceiptPath,
    string Nonce)
{
    private const string ProbeArgument = "--lifecycle-probe";
    private const string DataRootArgument = "--lifecycle-data-root=";
    private const string ReceiptArgument = "--lifecycle-receipt=";
    private const string NonceArgument = "--lifecycle-nonce=";

    private static readonly Regex NoncePattern = new(
        "^[0-9a-fA-F]{32}$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    public static bool IsRequested(IReadOnlyList<string> arguments) =>
        arguments.Any(argument =>
            argument.Equals(ProbeArgument, StringComparison.OrdinalIgnoreCase) ||
            argument.StartsWith("--lifecycle-", StringComparison.OrdinalIgnoreCase));

    public static bool TryParse(
        IReadOnlyList<string> arguments,
        out LifecycleProbeOptions? options,
        out string? error)
    {
        options = null;
        error = null;

        if (!IsRequested(arguments))
        {
            return false;
        }

        if (arguments.Count != 4 ||
            arguments.Count(argument =>
                argument.Equals(ProbeArgument, StringComparison.OrdinalIgnoreCase)) != 1)
        {
            error = "Lifecycle probe requires exactly one marker and three value arguments.";
            return false;
        }

        if (!TryGetSingleValue(arguments, DataRootArgument, out var dataRootValue) ||
            !TryGetSingleValue(arguments, ReceiptArgument, out var receiptValue) ||
            !TryGetSingleValue(arguments, NonceArgument, out var nonceValue))
        {
            error = "Lifecycle probe arguments are missing, duplicated, or unsupported.";
            return false;
        }

        if (!Path.IsPathFullyQualified(dataRootValue) ||
            !Path.IsPathFullyQualified(receiptValue))
        {
            error = "Lifecycle probe paths must be absolute.";
            return false;
        }

        string dataRoot;
        string receiptPath;
        string productionRoot;
        try
        {
            dataRoot = Path.GetFullPath(dataRootValue).TrimEnd(Path.DirectorySeparatorChar);
            receiptPath = Path.GetFullPath(receiptValue);
            productionRoot = Path.GetFullPath(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "JARVIS")).TrimEnd(Path.DirectorySeparatorChar);
        }
        catch (Exception exception) when (
            exception is ArgumentException or NotSupportedException or PathTooLongException)
        {
            error = "Lifecycle probe paths are invalid.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(dataRoot) ||
            PathsOverlap(dataRoot, productionRoot))
        {
            error = "Lifecycle probe data must be isolated from the production JARVIS data root.";
            return false;
        }

        if (!IsStrictChild(receiptPath, dataRoot))
        {
            error = "Lifecycle probe receipt must remain beneath the isolated data root.";
            return false;
        }

        if (!NoncePattern.IsMatch(nonceValue))
        {
            error = "Lifecycle probe nonce must contain exactly 32 hexadecimal characters.";
            return false;
        }

        options = new LifecycleProbeOptions(
            dataRoot,
            receiptPath,
            nonceValue.ToLowerInvariant());
        return true;
    }

    private static bool TryGetSingleValue(
        IReadOnlyList<string> arguments,
        string prefix,
        out string value)
    {
        var matches = arguments
            .Where(argument => argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (matches.Length != 1 || matches[0].Length == prefix.Length)
        {
            value = string.Empty;
            return false;
        }

        value = matches[0][prefix.Length..].Trim();
        return value.Length > 0;
    }

    private static bool PathsOverlap(string left, string right) =>
        PathsEqual(left, right) ||
        IsStrictChild(left, right) ||
        IsStrictChild(right, left);

    private static bool IsStrictChild(string candidate, string parent)
    {
        var parentPrefix = parent.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return candidate.StartsWith(parentPrefix, StringComparison.OrdinalIgnoreCase);
    }

    private static bool PathsEqual(string left, string right) =>
        left.Equals(right, StringComparison.OrdinalIgnoreCase);
}
