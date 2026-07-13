/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — default validator registry construction.
 *
 * `createDefaultRegistry` wires the four shipping validators against
 * production providers. Construction is centralized here so the service
 * layer (and any future entry point) builds the same registry; tests
 * substitute by constructing their own `ValidatorRegistry` from fakes
 * via `defineRegistry({ ... })`.
 */

import { ValidationType } from "../environments/types";
import type { ArtifactProvider } from "./providers/artifactProvider";
import type { ProcessProvider } from "./providers/processProvider";
import type { WorkloadSimulationEngineLocation } from "./providers/workloadSimulationEngine";
import { defineRegistry, ValidatorRegistry } from "./types";
import { ConnectivityValidator } from "./validators/connectivityValidator";
import { StaticAnalysisValidator } from "./validators/staticAnalysisValidator";
import { UnitTestsValidator } from "./validators/unitTestsValidator";
import { WorkloadPlaybackValidator } from "./validators/workloadPlaybackValidator";
import { WorkloadSimulationValidator } from "./validators/workloadSimulationValidator";

/**
 * Provider bundle injected into `createDefaultRegistry`: the process seam
 * every shelling-out validator needs plus the artifact seam the
 * workload-playback validator reads its spec through. The service layer
 * constructs the bundle once and hands it to `createDefaultRegistry`.
 */
export interface RegistryProviders {
    readonly process: ProcessProvider;
    readonly artifact: ArtifactProvider;
    /**
     * Optional overrides for the build-based static-analysis validator: an
     * absolute `dotnet` path and the sql-database-projects `BuildDirectory`
     * (`systemDacpacsLocation`, needed only by projects with system-database
     * references). Omitted in tests; the service layer supplies them.
     */
    readonly staticAnalysis?: {
        readonly dotnetCommand?: string;
        readonly systemDacpacsLocation?: string;
    };
    /**
     * Host-injected location of the sqlpysim engine for the workload-simulation
     * gate. Omitted when the host has no engine configured; the gate then skips.
     */
    readonly workloadSimulation?: WorkloadSimulationEngineLocation;
    /** Workspace root used to resolve a relative workload path for the simulation gate. */
    readonly workspaceRoot?: string;
}

/**
 * Builds the default production registry. Every `ValidationType` arm is
 * wired to its concrete validator; there is no placeholder slot.
 *
 * Service layer constructs this once per `CloudDeployService` and hands
 * the result to the runner.
 */
export function createDefaultRegistry(providers: RegistryProviders): ValidatorRegistry {
    return defineRegistry({
        [ValidationType.Connectivity]: new ConnectivityValidator(),
        [ValidationType.StaticAnalysis]: new StaticAnalysisValidator(
            providers.process,
            providers.staticAnalysis ?? {},
        ),
        [ValidationType.UnitTests]: new UnitTestsValidator(),
        [ValidationType.WorkloadPlayback]: new WorkloadPlaybackValidator(providers.artifact),
        [ValidationType.WorkloadSimulation]: new WorkloadSimulationValidator(
            providers.process,
            providers.workloadSimulation,
            providers.workspaceRoot,
        ),
    });
}
