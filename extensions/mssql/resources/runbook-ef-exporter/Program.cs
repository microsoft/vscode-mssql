// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

using System.Reflection;
using System.Runtime.Versioning;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

if (args.Length != 3)
{
    Console.Error.WriteLine(
        "Expected: <application assembly> <DbContext name> <output JSON path>");
    return 2;
}

var applicationAssemblyPath = Path.GetFullPath(args[0]);
var requestedContext = args[1].Trim();
var outputPath = Path.GetFullPath(args[2]);
if (!File.Exists(applicationAssemblyPath) || requestedContext.Length == 0 || requestedContext.Length > 512)
{
    Console.Error.WriteLine("The requested assembly or DbContext is invalid.");
    return 2;
}
Console.Error.WriteLine("runbook-ef-exporter: discover factories");
var factories = new List<(Type Factory, Type Context)>();
var applicationAssembly = Assembly.LoadFrom(applicationAssemblyPath);
Type[] applicationTypes;
try
{
    applicationTypes = applicationAssembly.GetTypes();
}
catch (ReflectionTypeLoadException error)
{
    applicationTypes = error.Types.OfType<Type>().ToArray();
}
foreach (var type in applicationTypes.Where(value => !value.IsAbstract && !value.IsInterface))
{
    var contract = type.GetInterfaces().FirstOrDefault(value =>
        value.IsGenericType &&
        value.GetGenericTypeDefinition() == typeof(IDesignTimeDbContextFactory<>));
    if (contract is not null)
    {
        factories.Add((type, contract.GetGenericArguments()[0]));
    }
}

var matches = factories.Where(value =>
    string.Equals(value.Context.Name, requestedContext, StringComparison.Ordinal) ||
    string.Equals(value.Context.FullName, requestedContext, StringComparison.Ordinal)).ToArray();
if (matches.Length != 1)
{
    Console.Error.WriteLine($"Expected exactly one IDesignTimeDbContextFactory for '{requestedContext}', found {matches.Length}.");
    return 3;
}

var selected = matches[0];
Console.Error.WriteLine("runbook-ef-exporter: create design-time context");
var factory = Activator.CreateInstance(selected.Factory)
    ?? throw new InvalidOperationException("The design-time factory could not be constructed.");
var create = selected.Factory.GetMethod(
    "CreateDbContext",
    BindingFlags.Instance | BindingFlags.Public,
    binder: null,
    types: [typeof(string[])],
    modifiers: null)
    ?? throw new InvalidOperationException("The design-time factory does not expose CreateDbContext(string[]). ");
await using var context = (DbContext?)create.Invoke(factory, [Array.Empty<string>()])
    ?? throw new InvalidOperationException("The design-time factory returned no DbContext.");

Console.Error.WriteLine("runbook-ef-exporter: materialize relational model");
var relationalModel = context.GetService<IDesignTimeModel>().Model.GetRelationalModel();
var tables = new List<TableDocument>();
var unsupported = new List<UnsupportedDocument>();
foreach (var table in relationalModel.Tables.OrderBy(value => value.Schema).ThenBy(value => value.Name))
{
    var storeObject = StoreObjectIdentifier.Table(table.Name, table.Schema);
    var columns = new List<ColumnDocument>();
    foreach (var column in table.Columns.OrderBy(value => value.Name))
    {
        var property = column.PropertyMappings.Select(value => value.Property).FirstOrDefault();
        if (property is null)
        {
            unsupported.Add(new("column", $"{table.Schema}.{table.Name}.{column.Name}", "No mapped EF property was available."));
        }
        var strategy = property?.FindAnnotation("SqlServer:ValueGenerationStrategy")?.Value?.ToString();
        var identity = strategy?.Contains("Identity", StringComparison.OrdinalIgnoreCase) == true;
        var defaultSql = identity ? null : property?.GetDefaultValueSql(storeObject);
        // EF returns the CLR default for some store-generated properties even
        // when no SQL DEFAULT constraint exists. Identity semantics are
        // represented explicitly and must not be misclassified as a default.
        var defaultValue = identity
            ? null
            : property?.FindAnnotation(RelationalAnnotationNames.DefaultValue)?.Value;
        var computedSql = property?.GetComputedColumnSql(storeObject);
        var identitySeed = identity
            ? Convert.ToInt64(property?.FindAnnotation("SqlServer:IdentitySeed")?.Value ?? 1)
            : (long?)null;
        var identityIncrement = identity
            ? Convert.ToInt64(property?.FindAnnotation("SqlServer:IdentityIncrement")?.Value ?? 1)
            : (long?)null;
        var defaultFingerprint = defaultSql is not null
            ? defaultSql
            : defaultValue is not null
                ? JsonSerializer.Serialize(defaultValue, defaultValue.GetType())
                : null;
        columns.Add(new(
            column.Name,
            column.StoreType,
            column.IsNullable,
            identity,
            identitySeed,
            identityIncrement,
            computedSql is not null,
            property?.GetMaxLength(),
            property?.GetPrecision(),
            property?.GetScale(),
            defaultSql is not null ? "sql" : defaultValue is not null ? "constant" : "none",
            defaultFingerprint is null ? null : Sha256(defaultFingerprint),
            computedSql is null ? null : Sha256(computedSql),
            property?.GetCollation()));
    }

    var primaryKey = table.PrimaryKey is null ? null : KeyOf(table.PrimaryKey);
    var uniqueConstraints = table.UniqueConstraints
        .Where(value => table.PrimaryKey is null || value.Name != table.PrimaryKey.Name)
        .OrderBy(value => value.Name)
        .Select(KeyOf)
        .ToArray();
    var indexes = table.Indexes.OrderBy(value => value.Name).Select(value =>
    {
        var indexColumns = value.Columns.Select(column => column.Name).ToArray();
        return new IndexDocument(
            value.Name,
            indexColumns,
            value.IsUnique,
            string.IsNullOrWhiteSpace(value.Filter) ? null : Sha256(value.Filter),
            ParseNotNullFilterColumns(value.Filter, indexColumns));
    }).ToArray();
    var foreignKeys = table.ForeignKeyConstraints.OrderBy(value => value.Name).Select(value =>
        new ForeignKeyDocument(
            value.Name,
            value.Columns.Select(column => column.Name).ToArray(),
            value.PrincipalTable.Schema ?? "dbo",
            value.PrincipalTable.Name,
            value.PrincipalColumns.Select(column => column.Name).ToArray(),
            value.OnDeleteAction.ToString())).ToArray();
    var checks = table.CheckConstraints.OrderBy(value => value.Name).Select(value =>
        new CheckDocument(value.Name!, Sha256(value.Sql))).ToArray();
    var temporal = table.EntityTypeMappings.Any(mapping =>
        mapping.TypeBase.FindAnnotation("SqlServer:IsTemporal")?.Value is true);
    tables.Add(new(
        table.Schema ?? "dbo",
        table.Name,
        columns.ToArray(),
        primaryKey,
        uniqueConstraints,
        indexes,
        foreignKeys,
        checks,
        temporal));
}

Console.Error.WriteLine("runbook-ef-exporter: write manifest");

var providerName = context.Database.ProviderName ?? "unknown";
var providerAssembly = AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(value =>
    value.GetName().Name?.Equals(providerName, StringComparison.OrdinalIgnoreCase) == true);
var providerVersion = providerAssembly?.GetName().Version?.ToString()
    ?? typeof(DbContext).Assembly.GetName().Version?.ToString()
    ?? "unknown";
var targetFramework = selected.Context.Assembly
    .GetCustomAttribute<TargetFrameworkAttribute>()?.FrameworkName ?? "unknown";
var document = new ExportDocument(
    new(providerName, providerVersion),
    targetFramework,
    unsupported.Count == 0,
    unsupported.ToArray(),
    tables.ToArray());
Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
await File.WriteAllTextAsync(
    outputPath,
    JsonSerializer.Serialize(document, new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    }));
Console.Error.WriteLine("runbook-ef-exporter: complete");
return 0;

static KeyDocument KeyOf(IUniqueConstraint constraint) =>
    new(constraint.Name, constraint.Columns.Select(value => value.Name).ToArray());

static string Sha256(string value) =>
    Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
        System.Text.Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

static string[]? ParseNotNullFilterColumns(string? filter, IReadOnlyCollection<string> indexColumns)
{
    if (string.IsNullOrWhiteSpace(filter))
    {
        return null;
    }
    var allowed = indexColumns.ToHashSet(StringComparer.OrdinalIgnoreCase);
    var result = new List<string>();
    foreach (var clause in Regex.Split(
        filter.Trim(),
        @"\s+AND\s+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
    {
        var match = Regex.Match(
            clause.Trim(),
            @"^\[(?<name>(?:[^\]]|\]\])+)\]\s+IS\s+NOT\s+NULL$",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        if (!match.Success)
        {
            return null;
        }
        var name = match.Groups["name"].Value.Replace("]]", "]", StringComparison.Ordinal);
        if (!allowed.Contains(name) || result.Contains(name, StringComparer.OrdinalIgnoreCase))
        {
            return null;
        }
        result.Add(indexColumns.First(value => value.Equals(name, StringComparison.OrdinalIgnoreCase)));
    }
    return result.Count == 0 ? null : result.ToArray();
}

internal sealed record ExportDocument(
    ProviderDocument Provider,
    string TargetFramework,
    bool Complete,
    UnsupportedDocument[] Unsupported,
    TableDocument[] Tables);
internal sealed record ProviderDocument(string Name, string Version);
internal sealed record UnsupportedDocument(string Scope, string Name, string Reason);
internal sealed record TableDocument(
    string Schema,
    string Name,
    ColumnDocument[] Columns,
    KeyDocument? PrimaryKey,
    KeyDocument[] UniqueConstraints,
    IndexDocument[] Indexes,
    ForeignKeyDocument[] ForeignKeys,
    CheckDocument[] Checks,
    bool Temporal);
internal sealed record ColumnDocument(
    string Name,
    string StoreType,
    bool Nullable,
    bool Identity,
    long? IdentitySeed,
    long? IdentityIncrement,
    bool Computed,
    int? MaxLength,
    int? Precision,
    int? Scale,
    string DefaultKind,
    string? DefaultSha256,
    string? ComputedSha256,
    string? Collation);
internal record KeyDocument(string Name, string[] Columns);
internal sealed record IndexDocument(
    string Name,
    string[] Columns,
    bool Unique,
    string? FilterSha256,
    string[]? NotNullFilterColumns) : KeyDocument(Name, Columns);
internal sealed record ForeignKeyDocument(
    string Name,
    string[] Columns,
    string PrincipalSchema,
    string PrincipalTable,
    string[] PrincipalColumns,
    string OnDelete) : KeyDocument(Name, Columns);
internal sealed record CheckDocument(string Name, string SqlSha256);
