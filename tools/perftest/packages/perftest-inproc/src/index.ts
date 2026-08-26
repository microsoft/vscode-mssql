/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @mssqlperf/inproc — run perftest scenarios directly inside a live VS Code
 * extension host (self-test). Self-contained (only `vscode` as an external),
 * so vscode-mssql imports it relatively from its built `dist`.
 */

export { MarkerBus } from "./markerBus";
export type { BusMarker } from "./markerBus";

export { runScenario, ScenarioCancelledError } from "./scenarioEngine";
export type {
    ConnectionProfileSpec,
    EngineContext,
    MeasureSpec,
    ScenarioLoopSpec,
    ScenarioRunResult,
    ScenarioSpec,
    ScenarioStep,
    StepOutcome,
    SuccessCriterion,
} from "./scenarioEngine";

export { deriveMetrics } from "./metrics";
export type { DerivedMetric } from "./metrics";

export { BUILTIN_SCENARIOS, builtinScenario } from "./scenarios";
export type { BuiltinScenario, MetricDef } from "./scenarios";

export { SelfTestRunner } from "./runner";
export type {
    RepResult,
    ScenarioResult,
    SelfTestEvent,
    SelfTestRunOptions,
    SelfTestRunResult,
} from "./runner";
