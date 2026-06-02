/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export { Runner } from "./runner";
export type { RunnerRunOptions } from "./runner";
export { createDefaultRegistry } from "./registry";
export type { RegistryProviders } from "./registry";
export {
    CancellationError,
    assertNeverValidationType,
    defineRegistry,
    throwIfCancelled,
} from "./types";
export type { SettingsFor, Validator, ValidatorRegistry, ValidatorRunOptions } from "./types";
export {
    ConnectionError,
    FakeConnectionHandle,
    FakeConnectionProvider,
    LiveConnectionProvider,
} from "./providers/connectionProvider";
export type {
    ConnectionFailureKind,
    ConnectionHandle,
    ConnectionProvider,
    FakeConnectionBehavior,
    FakeConnectionHandleConfig,
    LiveConnectionStrategy,
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
