/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — runtime-host dispatcher (Scope 2).
 *
 * Routes a `provision()` call to the right `EphemeralDatabaseProvider` by the
 * runtime host the run resolved to: `docker` → the tool-managed container
 * provider, `connection` → the borrow-an-existing-server provider. The runner
 * (`resolveRuntimeHost`) already picks the host; this is the single seam that
 * turns that choice into a concrete provider, so neither the runner nor the
 * service needs to know which hosts exist.
 *
 * Adding a future host (e.g. a CI service container) is one more arm here plus
 * its provider — nothing else changes.
 */

import { SourceOfTruth, RuntimeHostConfig } from "../../environments/types";
import {
    EphemeralDatabase,
    EphemeralDatabaseProvider,
    EphemeralProvisionError,
} from "./ephemeralDatabaseProvider";

/**
 * Providers the dispatcher routes between. `connection` is optional so a
 * Docker-only wiring (no connection host glue available) still constructs;
 * a run that asks for the `connection` host without it surfaces a clear
 * provisioning error rather than a silent fallback to Docker.
 */
export interface EphemeralDatabaseProvidersByHost {
    readonly docker: EphemeralDatabaseProvider;
    readonly connection?: EphemeralDatabaseProvider;
}

/** `EphemeralDatabaseProvider` that delegates by `RuntimeHostConfig.kind`. */
export class DispatchingEphemeralDatabaseProvider implements EphemeralDatabaseProvider {
    public constructor(private readonly _providers: EphemeralDatabaseProvidersByHost) {}

    public provision(
        sourceOfTruth: SourceOfTruth,
        host: RuntimeHostConfig,
        signal: AbortSignal,
    ): Promise<EphemeralDatabase> {
        switch (host.kind) {
            case "docker":
                return this._providers.docker.provision(sourceOfTruth, host, signal);
            case "connection": {
                const provider = this._providers.connection;
                if (provider === undefined) {
                    throw new EphemeralProvisionError(
                        'The "connection" runtime host is not available (no connection host glue is wired).',
                    );
                }
                return provider.provision(sourceOfTruth, host, signal);
            }
            default: {
                // Exhaustive: every `RuntimeHostConfig` arm is handled above.
                const exhaustive: never = host;
                throw new EphemeralProvisionError(
                    `Unsupported runtime host: ${JSON.stringify(exhaustive)}`,
                );
            }
        }
    }
}
