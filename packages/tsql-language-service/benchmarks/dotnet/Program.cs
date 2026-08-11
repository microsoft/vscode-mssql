// ---------------------------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.
// ---------------------------------------------------------------------------------------------

using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Microsoft.SqlServer.Management.SqlParser.Parser;

Dictionary<string, string> options = ParseOptions(args);
string originalPath = Required(options, "file");
string editedPath = Required(options, "edited");
string label = options.GetValueOrDefault("label", "sqlparser");
int samples = PositiveInt(options, "samples", 3);
int warmups = NonNegativeInt(options, "warmups", 1);
string original = File.ReadAllText(originalPath);
string edited = File.ReadAllText(editedPath);
if (original.Length != edited.Length)
{
    throw new InvalidOperationException("The benchmark edit must preserve UTF-16 length.");
}

ForceGc();
Stopwatch stopwatch = Stopwatch.StartNew();
ParseResult initial = Parser.IncrementalParse(original, null);
stopwatch.Stop();
double initialMs = stopwatch.Elapsed.TotalMilliseconds;
int batchCount = initial.BatchCount;
int errorCount = initial.Errors.Count();
initial = null!;
ForceGc();

for (int index = 0; index < warmups; index++)
{
    _ = Parser.IncrementalParse(original, null);
}

double[] warmedFull = new double[samples];
for (int index = 0; index < samples; index++)
{
    stopwatch.Restart();
    _ = Parser.IncrementalParse(original, null);
    stopwatch.Stop();
    warmedFull[index] = stopwatch.Elapsed.TotalMilliseconds;
}

ParseResult incremental = Parser.IncrementalParse(original, null);
bool useEdited = true;
for (int index = 0; index < warmups; index++)
{
    incremental = Parser.IncrementalParse(useEdited ? edited : original, incremental);
    useEdited = !useEdited;
}

double[] warmedIncremental = new double[samples];
for (int index = 0; index < samples; index++)
{
    stopwatch.Restart();
    incremental = Parser.IncrementalParse(useEdited ? edited : original, incremental);
    stopwatch.Stop();
    warmedIncremental[index] = stopwatch.Elapsed.TotalMilliseconds;
    useEdited = !useEdited;
}

Assembly parserAssembly = typeof(Parser).Assembly;
var report = new
{
    engine = label,
    parserAssembly = parserAssembly.Location,
    parserAssemblyVersion = parserAssembly.GetName().Version?.ToString(),
    parserAssemblyFileVersion = FileVersionInfo.GetVersionInfo(parserAssembly.Location).FileVersion,
    parserAssemblyInformationalVersion = parserAssembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
        ?.InformationalVersion,
    runtime = Environment.Version.ToString(),
    bytes = new FileInfo(originalPath).Length,
    characters = original.Length,
    samples,
    warmups,
    initialMs,
    warmedFullMs = Summarize(warmedFull),
    warmedIncrementalMs = Summarize(warmedIncremental),
    batchCount,
    errorCount,
    managedHeapBytes = GC.GetTotalMemory(forceFullCollection: true),
    peakWorkingSetBytes = Process.GetCurrentProcess().PeakWorkingSet64,
};
Console.WriteLine(JsonSerializer.Serialize(report));

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
    if (lower == upper) return ordered[lower];
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower);
}

static void ForceGc()
{
    GC.Collect();
    GC.WaitForPendingFinalizers();
    GC.Collect();
}

static Dictionary<string, string> ParseOptions(string[] arguments)
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
