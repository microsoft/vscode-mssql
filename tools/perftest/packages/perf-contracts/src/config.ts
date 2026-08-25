/**
 * TypeScript mirror of schemas/perf-config.schema.json (design §25).
 */

import type { ArtifactRetention, PassType } from "./result";

export type LaunchMode = "directSpawn" | "testElectron";

export type ProfileMode = "fresh" | "warmed" | "reuse" | "scenarioDefault";

export type SqlProvider = "dockerCompose" | "testcontainers" | "external";

export type SqlCacheMode = "warm" | "coldDb" | "coldOs" | "unknown";

export type OtelMode = "off" | "minimal" | "full";

export type ExtensionSource = "vsix" | "developmentPath" | "marketplace";

export interface ExtensionSpec {
    id: string;
    source: ExtensionSource;
    path: string;
    version?: string;
}

export interface VscodeConfig {
    version: string;
    quality?: string;
    launchMode: LaunchMode;
    profileMode?: ProfileMode;
    workspaceRoot?: string;
    extensions: ExtensionSpec[];
    extraArgs?: string[];
    env?: Record<string, string>;
    [key: string]: unknown;
}

export interface SqlConfig {
    provider: SqlProvider;
    composeFile?: string;
    service?: string;
    imageDigest?: string;
    snapshot: string;
    cacheMode: SqlCacheMode;
    connectionProfile: string;
    /** Skip harness seed mutation and use the database in an external connection string. */
    provisionSeed?: boolean;
    [key: string]: unknown;
}

export interface EnvironmentRequirements {
    requireIdle?: boolean;
    idleCpuPctMax?: number;
    pinCpuAffinity?: number[];
    requireAcPower?: boolean;
    fixCpuFrequency?: "off" | "warn" | "required";
    [key: string]: unknown;
}

export interface CdpDiagnostics {
    extHostProfile?: boolean;
    rendererTrace?: boolean;
    rendererProfile?: boolean;
}

export type DiagnosticRecipe = "light" | "ui-rendering" | "service" | "sql" | "memory" | "full";
export type DotnetTraceProfile = "cpu" | "gc-verbose" | "gc-collect";

export interface DiagnosticsConfig {
    /**
     * Named collector preset (peer-review recipes). Expanded at config load;
     * explicit flags below OVERRIDE the recipe defaults. Heavy recipes belong
     * in diagnostic passes — a warning fires when one runs in a measurement
     * pass (collector metrics stay diagnostic-only regardless).
     */
    recipe?: DiagnosticRecipe;
    markers?: boolean;
    processSampler?: boolean;
    otel?: OtelMode;
    sqlServerXEvents?: boolean;
    startupProfile?: boolean;
    cdp?: CdpDiagnostics;
    dotnetCounters?: boolean;
    dotnetTrace?: boolean;
    /** EventPipe profile; gc-verbose records sampled allocation types/stacks. */
    dotnetTraceProfile?: DotnetTraceProfile;
    /** Bounded trace window beginning when the STS process is discovered. */
    dotnetTraceDurationSeconds?: number;
    wprEtw?: boolean;
    vscodeDiag?: { logs?: boolean; status?: boolean };
    [key: string]: unknown;
}

export interface StoreConfig {
    type: "sqlite" | "postgres" | "none";
    path?: string;
}

export interface ThresholdSpec {
    pct?: number;
    absMs?: number;
    minSamples?: number;
    maxCv?: number;
    test?: string;
    pValue?: number;
    [key: string]: unknown;
}

export interface RegressionConfig {
    baseline?: string;
    failOnRegression?: boolean;
    thresholds?: {
        default?: ThresholdSpec;
        metrics?: Record<string, ThresholdSpec>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface OutputConfig {
    dir: string;
    keepArtifacts: ArtifactRetention;
}

export interface PerfConfig {
    schemaVersion: 2;
    runId?: string;
    passType: PassType;
    repetitions: number;
    warmupRepetitions: number;
    scenarios: string[];
    vscode: VscodeConfig;
    sql: SqlConfig;
    environment: EnvironmentRequirements;
    diagnostics: DiagnosticsConfig;
    store: StoreConfig;
    regression: RegressionConfig;
    output: OutputConfig;
    [key: string]: unknown;
}
