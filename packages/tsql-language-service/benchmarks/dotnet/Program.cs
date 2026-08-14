// ---------------------------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.
// ---------------------------------------------------------------------------------------------

using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Microsoft.SqlServer.Management.SqlParser.Common;
using Microsoft.SqlServer.Management.SqlParser.Parser;

Dictionary<string, string> options = ParseArguments(args);
string original = File.ReadAllText(Required(options, "file"));
int samples = PositiveInt(options, "samples", 3);
int warmups = NonNegativeInt(options, "warmups", 1);
var edits = new[] { "start", "middle", "end" }.Select(location => new
{
    location,
    text = File.ReadAllText(Required(options, $"edited-{location}")),
}).ToArray();
if (edits.Any(edit => edit.text.Length != original.Length))
{
    throw new InvalidOperationException("Every benchmark edit must preserve UTF-16 length.");
}

ParseOptions parserOptions = new(
    "GO",
    true,
    DatabaseCompatibilityLevel.Version170,
    TransactSqlVersion.Version170);
ForceGc();
Timed<ParseResult> initial = Measure(() => Parser.Parse(original, parserOptions));
int errorCount = initial.Value.Errors.Count();
int batchCount = initial.Value.BatchCount;

for (int index = 0; index < warmups; index++) _ = Parser.Parse(original, parserOptions);
double[] warmedFull = Samples(samples, () => Parser.Parse(original, parserOptions));

var editReports = edits.Select(edit =>
{
    for (int index = 0; index < warmups; index++) _ = Parser.Parse(edit.text, parserOptions);
    double[] fullReparse = Samples(samples, () => Parser.Parse(edit.text, parserOptions));

    ParseResult previous = Parser.IncrementalParse(original, null, parserOptions);
    bool useEdited = true;
    for (int index = 0; index < warmups; index++)
    {
        previous = Parser.IncrementalParse(useEdited ? edit.text : original, previous, parserOptions);
        useEdited = !useEdited;
    }
    double[] incremental = new double[samples];
    ParseResult latest = previous;
    for (int index = 0; index < samples; index++)
    {
        Timed<ParseResult> measured = Measure(() => Parser.IncrementalParse(
            useEdited ? edit.text : original,
            latest,
            parserOptions));
        incremental[index] = measured.ElapsedMs;
        latest = measured.Value;
        useEdited = !useEdited;
    }
    ParseResult editedResult = Parser.Parse(edit.text, parserOptions);
    return new
    {
        location = edit.location,
        fullReparseMs = Summarize(fullReparse),
        incrementalMs = Summarize(incremental),
        diagnostics = editedResult.Errors.Count(),
        batchCount = editedResult.BatchCount,
    };
}).ToArray();

Assembly parserAssembly = typeof(Parser).Assembly;
var report = new
{
    engine = "sqlparser",
    fullStrategy = "full-reparse",
    editStrategy = "native-incremental",
    parserAssembly = parserAssembly.Location,
    parserAssemblyVersion = parserAssembly.GetName().Version?.ToString(),
    parserAssemblyInformationalVersion = parserAssembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
        ?.InformationalVersion,
    runtime = Environment.Version.ToString(),
    characters = original.Length,
    samples,
    warmups,
    firstFullMs = initial.ElapsedMs,
    warmedFullMs = Summarize(warmedFull),
    edits = editReports,
    batchCount,
    diagnostics = errorCount,
    managedHeapBytes = GC.GetTotalMemory(forceFullCollection: true),
    workingSetBytes = Process.GetCurrentProcess().WorkingSet64,
    peakWorkingSetBytes = Process.GetCurrentProcess().PeakWorkingSet64,
};
Console.WriteLine(JsonSerializer.Serialize(report));

static double[] Samples(int count, Func<ParseResult> action)
{
    double[] values = new double[count];
    for (int index = 0; index < count; index++) values[index] = Measure(action).ElapsedMs;
    return values;
}

static Timed<T> Measure<T>(Func<T> action)
{
    Stopwatch stopwatch = Stopwatch.StartNew();
    T value = action();
    stopwatch.Stop();
    return new Timed<T>(stopwatch.Elapsed.TotalMilliseconds, value);
}

static object Summarize(double[] values)
{
    double[] ordered = values.Order().ToArray();
    return new
    {
        min = ordered[0],
        median = Percentile(ordered, 0.5),
        p95 = Percentile(ordered, 0.95),
        max = ordered[^1],
        mean = ordered.Average(),
        values,
    };
}

static double Percentile(double[] ordered, double percentile)
{
    if (ordered.Length == 1) return ordered[0];
    double position = (ordered.Length - 1) * percentile;
    int lower = (int)Math.Floor(position);
    int upper = (int)Math.Ceiling(position);
    return lower == upper
        ? ordered[lower]
        : ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

static void ForceGc()
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
}

static Dictionary<string, string> ParseArguments(string[] arguments)
{
    Dictionary<string, string> parsed = new(StringComparer.OrdinalIgnoreCase);
    for (int index = 0; index < arguments.Length; index += 2)
    {
        if (!arguments[index].StartsWith("--", StringComparison.Ordinal) || index + 1 >= arguments.Length)
        {
            throw new ArgumentException($"Expected --name value, got '{arguments[index]}'.");
        }
        parsed[arguments[index][2..]] = arguments[index + 1];
    }
    return parsed;
}

static string Required(Dictionary<string, string> options, string name) =>
    options.TryGetValue(name, out string? value)
        ? value
        : throw new ArgumentException($"Missing --{name}.");

static int PositiveInt(Dictionary<string, string> options, string name, int fallback)
{
    int value = options.TryGetValue(name, out string? text) ? int.Parse(text) : fallback;
    return value > 0 ? value : throw new ArgumentOutOfRangeException(name);
}

static int NonNegativeInt(Dictionary<string, string> options, string name, int fallback)
{
    int value = options.TryGetValue(name, out string? text) ? int.Parse(text) : fallback;
    return value >= 0 ? value : throw new ArgumentOutOfRangeException(name);
}

readonly record struct Timed<T>(double ElapsedMs, T Value);
