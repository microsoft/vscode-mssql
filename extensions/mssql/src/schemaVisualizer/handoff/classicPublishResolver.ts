/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Classic publish resolver + legacy service adapter (SV-R8b; addendum
 * §8.1). THE ONLY visualizer module allowed to touch ConnectionManager —
 * and only at explicit Preview/Publish command time (§3.3). Mirrors the
 * legacy schemaDesignerWebviewManager resolution recipe exactly:
 * prepareConnectionInfo (credential/token resolution) →
 * createConnectionDetails → getConnectionString(details, includePassword,
 * includeApplicationName) + azureAccountToken. Credentials ride a
 * dispose()-scoped holder that the state machine drops right after
 * createSession; nothing here is cached, keyed, or logged.
 */

import { randomUUID } from "crypto";
import { IConnectionProfile } from "../../models/interfaces";
import { SchemaDesigner } from "../../sharedInterfaces/schemaDesigner";
import {
    LegacySchemaDesignerPort,
    ResolvedClassicConnection,
    SchemaVisualizerClassicPublishResolver,
} from "./schemaVisualizerHandoff";

/** Structural ConnectionManager subset (mirrors the legacy manager usage). */
export interface ClassicConnectionSeam {
    prepareConnectionInfo(profile: IConnectionProfile): Promise<unknown>;
    createConnectionDetails(profile: IConnectionProfile): Promise<unknown> | unknown;
    getConnectionString(
        details: unknown,
        includePassword: boolean,
        includeApplicationName: boolean,
    ): Promise<string>;
}

export interface ClassicResolverDeps {
    connections: ClassicConnectionSeam;
    /** The SAVED profile backing this visualizer panel. */
    storedProfile: IConnectionProfile;
}

export function createClassicPublishResolver(
    deps: ClassicResolverDeps,
): SchemaVisualizerClassicPublishResolver {
    return {
        async resolve({ database }): Promise<ResolvedClassicConnection> {
            // Re-resolve the STORED profile at command time (§8.1) — never
            // a cached credential; target database set explicitly.
            const profile = {
                ...deps.storedProfile,
                database,
            } as IConnectionProfile;
            const prepared = (await deps.connections.prepareConnectionInfo(
                profile,
            )) as IConnectionProfile;
            prepared.database = database;
            const details = await deps.connections.createConnectionDetails(prepared);
            const connectionString = await deps.connections.getConnectionString(
                details,
                true,
                true,
            );
            let token: string | undefined = prepared.azureAccountToken;
            return {
                connectionString,
                ...(token !== undefined ? { accessToken: token } : {}),
                dispose: () => {
                    token = undefined;
                },
            };
        },
    };
}

/** Adapter: the machine's fakeable port over the real v1 service client. */
export function legacyPortOverService(
    service: SchemaDesigner.ISchemaDesignerService,
): LegacySchemaDesignerPort {
    return {
        async createSession(input) {
            const response = await service.createSession({
                sessionId: randomUUID(),
                connectionString: input.connectionString,
                ...(input.accessToken !== undefined ? { accessToken: input.accessToken } : {}),
                databaseName: input.database,
            });
            return { sessionId: response.sessionId, schema: response.schema };
        },
        async getReport(input) {
            return service.getReport({
                sessionId: input.sessionId,
                updatedSchema: input.updatedSchema,
            });
        },
        async publishSession(input) {
            await service.publishSession({ sessionId: input.sessionId });
        },
        async disposeSession(input) {
            await service.disposeSession({ sessionId: input.sessionId });
        },
    };
}
