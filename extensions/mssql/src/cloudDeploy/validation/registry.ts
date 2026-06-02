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
import type { ConnectionProvider } from "./providers/connectionProvider";
import { defineRegistry, Validator, ValidatorRegistry } from "./types";
import { ConnectivityValidator } from "./validators/connectivityValidator";

/**
 * Provider bundle injected into `createDefaultRegistry`. Each subsequent
 * commit adds one field as its provider lands (commit 3: `process`, commit
 * 5: `artifact`). Service layer (commit 6) constructs the bundle once and
 * hands it to `createDefaultRegistry` to build the registry.
 */
export interface RegistryProviders {
    readonly connection: ConnectionProvider;
}

/**
 * Placeholder validator used by `createDefaultRegistry` until each real
 * validator lands in its own commit. Throws on `run()` so an accidental
 * invocation surfaces immediately rather than silently producing a
 * "passed" result.
 *
 * Not exported: tests should build their own registries via
 * `defineRegistry({ ... fakes })`, not reach for the placeholder.
 */
class NotYetWiredValidator<T extends ValidationType> implements Validator<T> {
    public constructor(public readonly type: T) {}

    public run(): never {
        throw new Error(
            `Validator for "${this.type}" is not wired yet (added in a later D2 commit).`,
        );
    }
}

/**
 * Builds the default production registry. Wires each `ValidationType` arm
 * to its concrete validator; entries that haven't landed yet point at
 * `NotYetWiredValidator` so calling `run()` is loud instead of silent.
 *
 * Service layer constructs this once per `CloudDeployService` and hands
 * the result to the runner.
 */
export function createDefaultRegistry(providers: RegistryProviders): ValidatorRegistry {
    return defineRegistry({
        [ValidationType.Connectivity]: new ConnectivityValidator(providers.connection),
        [ValidationType.StaticAnalysis]: new NotYetWiredValidator(ValidationType.StaticAnalysis),
        [ValidationType.UnitTests]: new NotYetWiredValidator(ValidationType.UnitTests),
        [ValidationType.WorkloadPlayback]: new NotYetWiredValidator(
            ValidationType.WorkloadPlayback,
        ),
    });
}
