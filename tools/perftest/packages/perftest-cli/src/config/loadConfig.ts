/**
 * Config loading (design §25): JSONC parse → JSON Schema validation →
 * normalized PerfConfig with resolved runId. The raw text and parsed snapshot
 * are kept so each run can persist its exact config (reproducibility rule §A3.3).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import { newRunId, validateConfig, type PerfConfig } from "@mssqlperf/contracts";

export class ConfigError extends Error {
    constructor(
        message: string,
        readonly details: string[] = [],
    ) {
        super(message);
        this.name = "ConfigError";
    }
}

export interface LoadedConfig {
    config: PerfConfig;
    /** Resolved run id ("auto" replaced with a fresh id). */
    runId: string;
    /** sha256 of the raw config text. */
    configHash: string;
    configPath: string;
    rawText: string;
}

export function parseJsoncStrict(text: string, sourcePath: string): unknown {
    const errors: ParseError[] = [];
    const data: unknown = parseJsonc(text, errors, {
        allowTrailingComma: true,
        disallowComments: false,
    });
    if (errors.length > 0) {
        throw new ConfigError(
            `Failed to parse ${sourcePath}`,
            errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`),
        );
    }
    return data;
}

export function loadConfig(configPath: string): LoadedConfig {
    let rawText: string;
    try {
        rawText = readFileSync(configPath, "utf8");
    } catch (error) {
        throw new ConfigError(`Cannot read config file ${configPath}: ${String(error)}`);
    }

    const data = parseJsoncStrict(rawText, configPath);
    const outcome = validateConfig(data);
    if (!outcome.valid) {
        throw new ConfigError(`Config ${configPath} failed schema validation`, outcome.errors);
    }

    const config = data as PerfConfig;
    expandDiagnosticRecipe(config);
    const runId = !config.runId || config.runId === "auto" ? newRunId() : config.runId;
    const configHash = "sha256:" + createHash("sha256").update(rawText, "utf8").digest("hex");

    return { config, runId, configHash, configPath, rawText };
}

/**
 * Named collector presets ("which question is this run asking?"). Recipe
 * values are DEFAULTS — explicit diagnostics flags in the config win. Heavy
 * recipes are meant for diagnostic passes; running one in a measurement pass
 * warns loudly (collector metrics remain diagnostic-only regardless — the
 * eligibility rules make that structural, not conventional).
 */
const DIAGNOSTIC_RECIPES: Record<string, Partial<PerfConfig["diagnostics"]>> = {
    // Did it regress, and which process grew?
    light: { markers: true, processSampler: true },
    // Was this UI / rendering / event-loop bound?
    "ui-rendering": {
        markers: true,
        processSampler: true,
        cdp: { extHostProfile: true, rendererTrace: true, rendererProfile: true },
    },
    // Was this STS, DacFx, SMO, SqlClient, or dispatcher bound?
    service: { markers: true, processSampler: true, dotnetCounters: true, dotnetTrace: true },
    // Did SQL round-trips, reads, or waits change?
    sql: { markers: true, processSampler: true, sqlServerXEvents: true },
    // What memory grew? (heap snapshots are a recorded follow-up)
    memory: { markers: true, processSampler: true, dotnetCounters: true },
    // The big lantern.
    full: {
        markers: true,
        processSampler: true,
        cdp: { extHostProfile: true, rendererTrace: true, rendererProfile: true },
        dotnetCounters: true,
        dotnetTrace: true,
        sqlServerXEvents: true,
    },
};

const HEAVY_RECIPES = new Set(["ui-rendering", "service", "sql", "memory", "full"]);

function expandDiagnosticRecipe(config: PerfConfig): void {
    const recipe = config.diagnostics?.recipe;
    if (!recipe) {
        return;
    }
    const preset = DIAGNOSTIC_RECIPES[recipe];
    if (!preset) {
        throw new ConfigError(`Unknown diagnostics recipe '${recipe}'`, [
            `known recipes: ${Object.keys(DIAGNOSTIC_RECIPES).join(", ")}`,
        ]);
    }
    // Preset first, explicit flags override.
    config.diagnostics = { ...preset, ...config.diagnostics };
    if (HEAVY_RECIPES.has(recipe) && config.passType === "measurement") {
        process.stderr.write(
            `WARNING: diagnostics recipe '${recipe}' in a MEASUREMENT pass — collector overhead can perturb official numbers. Prefer --pass diagnostic for heavy recipes.
`,
        );
    }
}
