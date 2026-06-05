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
 *
 * Per-commit growth: commit 1 ships the surface and an empty default that
 * throws on `run()`. Each subsequent commit replaces one arm with the
 * concrete validator + provider it adds (commit 2 wires connectivity,
 * commit 3 wires static analysis, etc.). Commit 5 leaves the registry
 * fully populated; commit 6 is the service-side wiring that calls this.
 */

import { ValidationType } from "../environments/types";
import type { ArtifactProvider } from "./providers/artifactProvider";
import type { ConnectionProvider } from "./providers/connectionProvider";
import type { ProcessProvider } from "./providers/processProvider";
import { defineRegistry, ValidatorRegistry } from "./types";
import { ConnectivityValidator } from "./validators/connectivityValidator";
import { StaticAnalysisValidator } from "./validators/staticAnalysisValidator";
import { UnitTestsValidator } from "./validators/unitTestsValidator";
import { WorkloadPlaybackValidator } from "./validators/workloadPlaybackValidator";

/**
 * Provider bundle injected into `createDefaultRegistry`. Commit 5 added
 * `artifact` (the workload-playback validator's artifact seam); the bundle
 * is now complete for Scope 1. The service layer (commit 6) constructs the
 * bundle once and hands it to `createDefaultRegistry` to build the registry.
 */
export interface RegistryProviders {
    readonly connection: ConnectionProvider;
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
}

/**
 * Builds the default production registry. Every `ValidationType` arm is
 * wired to its concrete validator as of commit 5; there is no longer a
 * placeholder slot.
 *
 * Service layer constructs this once per `CloudDeployService` and hands
 * the result to the runner.
 */
export function createDefaultRegistry(providers: RegistryProviders): ValidatorRegistry {
    return defineRegistry({
        [ValidationType.Connectivity]: new ConnectivityValidator(providers.connection),
        [ValidationType.StaticAnalysis]: new StaticAnalysisValidator(
            providers.process,
            providers.staticAnalysis ?? {},
        ),
        [ValidationType.UnitTests]: new UnitTestsValidator(providers.connection),
        [ValidationType.WorkloadPlayback]: new WorkloadPlaybackValidator(
            providers.artifact,
            providers.process,
        ),
    });
}
