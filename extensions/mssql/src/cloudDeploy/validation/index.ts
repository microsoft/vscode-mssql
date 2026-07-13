/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { Runner } from "./runner";
export type { RunnerRunOptions, RunnerRuntimeDeps } from "./runner";
export { createDefaultRegistry } from "./registry";
export type { RegistryProviders } from "./registry";
export {
    CancellationError,
    assertNeverValidationType,
    defineRegistry,
    throwIfCancelled,
} from "./types";
export type { SettingsFor, Validator, ValidatorRegistry, ValidatorRunOptions } from "./types";
export { ConnectionError, FakeConnectionHandle } from "./providers/connectionProvider";
export type {
    ConnectionFailureKind,
    ConnectionHandle,
    FakeConnectionHandleConfig,
} from "./providers/connectionProvider";
export { ConnectivityValidator } from "./validators/connectivityValidator";
export { FakeProcessProvider, LiveProcessProvider } from "./providers/processProvider";
export type {
    FakeProcessResponse,
    FakeSpawnInvocation,
    ProcessProvider,
    ProcessResult,
    ProcessSpawnOptions,
} from "./providers/processProvider";
export { StaticAnalysisValidator } from "./validators/staticAnalysisValidator";
export { UnitTestsValidator } from "./validators/unitTestsValidator";
export { WorkloadPlaybackValidator } from "./validators/workloadPlaybackValidator";
export { WorkloadSimulationValidator } from "./validators/workloadSimulationValidator";
export {
    measureWorkloadSimulation,
    WorkloadSimulationEngineError,
} from "./providers/workloadSimulationEngine";
export type {
    WorkloadSimulationEngineLocation,
    WorkloadSimulationMetrics,
    WorkloadSimulationRunOptions,
} from "./providers/workloadSimulationEngine";
export {
    ArtifactNotFoundError,
    FakeArtifactProvider,
    LiveArtifactProvider,
} from "./providers/artifactProvider";
export type { ArtifactProvider, FakeArtifactRead } from "./providers/artifactProvider";
export {
    DockerEphemeralDatabaseProvider,
    EphemeralProvisionError,
    FakeEphemeralDatabase,
    FakeEphemeralDatabaseProvider,
} from "./providers/ephemeralDatabaseProvider";
export type {
    DockerEphemeralDatabaseOptions,
    EphemeralConnectionParams,
    EphemeralConnector,
    EphemeralDatabase,
    EphemeralDatabaseProvider,
    FakeProvisionInvocation,
} from "./providers/ephemeralDatabaseProvider";
export { ConnectionEphemeralDatabaseProvider } from "./providers/connectionEphemeralDatabaseProvider";
export type {
    ConnectionEphemeralDatabaseOptions,
    ConnectionHostGateway,
} from "./providers/connectionEphemeralDatabaseProvider";
export { DispatchingEphemeralDatabaseProvider } from "./providers/dispatchingEphemeralDatabaseProvider";
export type { EphemeralDatabaseProvidersByHost } from "./providers/dispatchingEphemeralDatabaseProvider";
export { SchemaResolutionError, resolveSchemaToDacpac } from "./providers/schemaResolver";
export type {
    ResolvedSchema,
    SchemaResolverOptions,
    SourceConnectionStringResolver,
} from "./providers/schemaResolver";
export { DataGeneratorError, LiveDataGenerator, splitSqlBatches } from "./dataGenerator";
export type { DataGenerator } from "./dataGenerator";
export { ValidationService } from "./validationApi";
export type {
    CloudDeployValidationApi,
    CloudDeployValidationRunOptions,
    CloudDeployValidationRunResult,
} from "./validationApi";
export { OutputChannelSubscriber, formatEvent } from "./outputChannelSubscriber";
export type { OutputChannelLike } from "./outputChannelSubscriber";
