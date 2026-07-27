namespace Jarvis.Host.Services;

internal enum NativeWindowAppearanceRuleAction
{
    Allow,
    Deny
}

internal enum NativeWindowAppearanceRuleDecision
{
    Automatic,
    Allowed,
    Denied,
    Protected,
    Limited
}

internal sealed record NativeWindowAppearanceRule(
    string ProcessName,
    string Action);

internal sealed record NativeWindowAppearanceRuleEvaluation(
    NativeWindowAppearanceRuleDecision Decision,
    string ReasonCode)
{
    public bool PermitsAppearance =>
        Decision is NativeWindowAppearanceRuleDecision.Automatic or
            NativeWindowAppearanceRuleDecision.Allowed;
}

internal sealed class NativeWindowAppearanceRuleSet
{
    public const int MaximumRules = 64;
    public const int MaximumProcessNameLength = 64;

    private static readonly HashSet<string> ProtectedProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "dwm",
        "LockApp",
        "SearchHost",
        "SearchApp",
        "ShellExperienceHost",
        "StartMenuExperienceHost",
        "TextInputHost"
    };

    private readonly Dictionary<string, NativeWindowAppearanceRuleAction> _rules =
        new(StringComparer.OrdinalIgnoreCase);

    public NativeWindowAppearanceRuleSet(IEnumerable<NativeWindowAppearanceRule>? rules = null)
    {
        if (rules is null)
        {
            return;
        }

        foreach (var rule in rules)
        {
            if (_rules.Count >= MaximumRules)
            {
                break;
            }

            if (!TryNormalizeProcessName(rule.ProcessName, out var processName) ||
                IsProtectedProcess(processName) ||
                !TryParseAction(rule.Action, out var action))
            {
                continue;
            }

            _rules[processName] = action;
        }
    }

    public IReadOnlyList<NativeWindowAppearanceRule> GetSnapshot() =>
        _rules
            .OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase)
            .Select(item => new NativeWindowAppearanceRule(
                item.Key,
                ToWireValue(item.Value)))
            .ToArray();

    public NativeWindowAppearanceRuleEvaluation Evaluate(string? processName)
    {
        if (!TryNormalizeProcessName(processName, out var normalized))
        {
            return new NativeWindowAppearanceRuleEvaluation(
                NativeWindowAppearanceRuleDecision.Denied,
                "invalid-process");
        }

        if (IsProtectedProcess(normalized))
        {
            return new NativeWindowAppearanceRuleEvaluation(
                NativeWindowAppearanceRuleDecision.Protected,
                "system-protected");
        }

        if (!_rules.TryGetValue(normalized, out var action))
        {
            return new NativeWindowAppearanceRuleEvaluation(
                NativeWindowAppearanceRuleDecision.Automatic,
                "automatic");
        }

        return action == NativeWindowAppearanceRuleAction.Allow
            ? new NativeWindowAppearanceRuleEvaluation(
                NativeWindowAppearanceRuleDecision.Allowed,
                "user-allow")
            : new NativeWindowAppearanceRuleEvaluation(
                NativeWindowAppearanceRuleDecision.Denied,
                "user-deny");
    }

    public bool TrySet(
        string? processName,
        string? actionValue,
        out string normalizedProcessName,
        out string? error)
    {
        normalizedProcessName = string.Empty;
        if (!TryNormalizeProcessName(processName, out var normalized))
        {
            error =
                $"Process names must contain 1-{MaximumProcessNameLength} filename characters and cannot include a path.";
            return false;
        }

        if (IsProtectedProcess(normalized))
        {
            error = "Windows protected processes cannot be overridden.";
            return false;
        }

        if (!TryParseAction(actionValue, out var action))
        {
            error = "Rule action must be allow or deny.";
            return false;
        }

        if (!_rules.ContainsKey(normalized) && _rules.Count >= MaximumRules)
        {
            error = $"At most {MaximumRules} window appearance rules can be saved.";
            return false;
        }

        _rules[normalized] = action;
        normalizedProcessName = normalized;
        error = null;
        return true;
    }

    public bool TryRemove(string? processName, out string normalizedProcessName, out string? error)
    {
        normalizedProcessName = string.Empty;
        if (!TryNormalizeProcessName(processName, out var normalized))
        {
            error =
                $"Process names must contain 1-{MaximumProcessNameLength} filename characters and cannot include a path.";
            return false;
        }

        normalizedProcessName = normalized;
        error = null;
        return _rules.Remove(normalized);
    }

    public static bool IsProtectedProcess(string? processName) =>
        TryNormalizeProcessName(processName, out var normalized) &&
        ProtectedProcesses.Contains(normalized);

    public static bool TryNormalizeProcessName(string? value, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        var candidate = value.Trim();
        if (candidate.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            candidate = candidate[..^4];
        }

        if (candidate.Length is 0 or > MaximumProcessNameLength ||
            candidate is "." or ".." ||
            candidate.Any(character =>
                char.IsControl(character) ||
                character is '\\' or '/' or ':' or '*' or '?' or '"' or '<' or '>' or '|'))
        {
            return false;
        }

        normalized = candidate;
        return true;
    }

    public static bool TryParseAction(
        string? value,
        out NativeWindowAppearanceRuleAction action)
    {
        if (string.Equals(value, "allow", StringComparison.OrdinalIgnoreCase))
        {
            action = NativeWindowAppearanceRuleAction.Allow;
            return true;
        }

        if (string.Equals(value, "deny", StringComparison.OrdinalIgnoreCase))
        {
            action = NativeWindowAppearanceRuleAction.Deny;
            return true;
        }

        action = default;
        return false;
    }

    private static string ToWireValue(NativeWindowAppearanceRuleAction action) =>
        action == NativeWindowAppearanceRuleAction.Allow ? "allow" : "deny";
}
