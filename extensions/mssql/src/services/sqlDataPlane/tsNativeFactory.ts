/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataPlaneErrorCodes, ISqlConnectionService, SqlDataPlaneError } from "./api";
import { SqlBackendFactory, SqlBackendFactoryContext } from "./backendFactory";
import { capabilitySet, conditional, supported, unsupported } from "./capabilityRegistry";
import { createDiagEngineObserver } from "../tsNative/observability";
import {
    parseTsNativeOverrides,
    TS_NATIVE_OVERRIDES_SETTING,
    type TsNativeOverrides,
} from "../tsNative/overrides";
import type { EngineObserver } from "../tsNative/queryEngine";
import { NativeSqlProvider } from "../../constants/locConstants";

const TIMEOUT_SETTINGS = [
    "mssql.sqlDataPlane.timeouts.openMs",
    "mssql.sqlDataPlane.timeouts.cancelAckMs",
    "mssql.sqlDataPlane.timeouts.closeMs",
    "mssql.sqlDataPlane.timeouts.disposeDrainMs",
] as const;

const TS_NATIVE_MIN_NODE_MAJOR = 22; // tedious 20 engines

/**
 * ts-native factory (TSQ2 §4.2, D6): the provider ships as the dedicated
 * lazy chunk dist/tsNativeProvider.js (tedious inside). Loading happens on
 * FIRST create(), via a computed-path require so esbuild never inlines the
 * chunk into the activation bundle. Unit tests exercise the compiled
 * out/-tree sibling instead.
 */
export function tsNativeFactory(providerVersion: string): SqlBackendFactory {
    return {
        kind: "ts-native",
        displayName: NativeSqlProvider.name,
        realmClass: "local",
        identity: {
            kind: "ts-native",
            implementation: "ts-native",
            transport: "inprocess",
            driver: "tedious",
            deployment: "extension-local",
            realmId: "local",
            providerVersion,
        },
        // Conservative honest statement (TSQ2 §8.1): never optimistic; the
        // gaps are the capability catalog, not a surprise list.
        staticCapabilities: capabilitySet({
            "auth.sqlLogin": supported("static"),
            "auth.entraToken": supported("static"),
            "auth.integrated": unsupported("static", "driver.noIntegratedAuth"),
            "auth.hostDelegated": unsupported("static", "localDeployment"),
            "connect.tcp": supported("static"),
            "connect.routeAlias": unsupported("static", "localDeployment"),
            "connect.localdb": unsupported("static", "driver.tcpOnly"),
            "connect.tds8Strict": conditional("static", "strictModeUnvalidated"),
            "exec.streamingRows": supported("static"),
            "exec.multipleResultSets": supported("static"),
            "exec.oneActiveQuery": supported("static"),
            "exec.cancel": supported("static"),
            "exec.dispose": supported("static"),
            "exec.queryTimeout": supported("static"),
            "exec.compactRows": supported("static"),
            "exec.maxCellBytes": supported("static"),
            "exec.pageRows": supported("static"),
            "exec.pageBytes": supported("static"),
            "exec.windowPages": supported("static", "exact", { limit: 4, unit: "pages" }),
            "types.typedCells": supported("static"),
            // TDS 7.4 down-converts vector to identity-less varchar — the
            // provider never guesses from text shape (§6.8).
            "types.vectorBinaryV1": unsupported("static", "driver.noWireTypeIdentity"),
            "types.spatialWkbV1": supported("static"),
            "types.decimalExact": unsupported("static", "driver.decimalToDouble"),
            "types.datetimeOffsetOriginal": unsupported("static", "driver.offsetDiscarded"),
            "types.largeValueStreaming": unsupported("static", "driver.plpBuffering"),
            "types.jsonNative": unsupported("static", "driver.noJsonType"),
            "messages.verbatim": supported("static"),
            "messages.rowsAffectedStructured": supported("static"),
            "plan.xmlResult": unsupported("static", "notExposed"),
            "plan.estimated": supported("static"),
            "plan.actual": supported("static"),
            "metadata.catalogSql": supported("static"),
            "metadata.endpoints": unsupported("static", "notImplemented"),
            "diag.supportCapsule": unsupported("static", "notImplemented"),
            "diag.captureControl": unsupported("static", "notImplemented"),
            "diag.replayDescriptor": supported("static"),
            "diag.resumeAfterDisconnect": unsupported("static", "notSupported"),
        }),
        fingerprintSettings: [...TIMEOUT_SETTINGS, TS_NATIVE_OVERRIDES_SETTING],
        create: async (context: SqlBackendFactoryContext): Promise<ISqlConnectionService> => {
            const nodeMajor = Number(process.versions.node.split(".")[0]);
            if (!Number.isInteger(nodeMajor) || nodeMajor < TS_NATIVE_MIN_NODE_MAJOR) {
                throw new SqlDataPlaneError(
                    DataPlaneErrorCodes.unavailable,
                    NativeSqlProvider.unsupportedRuntime(
                        TS_NATIVE_MIN_NODE_MAJOR,
                        process.versions.node,
                    ),
                    false,
                );
            }
            const overrides = parseTsNativeOverrides(
                context.config.get<unknown>(TS_NATIVE_OVERRIDES_SETTING, undefined),
            );
            const provider = loadTsNativeProvider();
            return provider.createBackend({
                // Bound to the activation-bundle diag singleton (the one with
                // registered sinks) — see the import note above.
                observer: createDiagEngineObserver(),
                deadlines: {
                    openMs: context.config.get<number>(
                        "mssql.sqlDataPlane.timeouts.openMs",
                        30_000,
                    ),
                    cancelAckMs: context.config.get<number>(
                        "mssql.sqlDataPlane.timeouts.cancelAckMs",
                        10_000,
                    ),
                    closeMs: context.config.get<number>(
                        "mssql.sqlDataPlane.timeouts.closeMs",
                        15_000,
                    ),
                    disposeDrainMs: context.config.get<number>(
                        "mssql.sqlDataPlane.timeouts.disposeDrainMs",
                        10_000,
                    ),
                },
                overrides,
            });
        },
    };
}

interface TsNativeProviderExports {
    createBackend(options?: {
        deadlines?: Partial<Record<string, number>>;
        overrides?: TsNativeOverrides;
        observer?: EngineObserver;
    }): ISqlConnectionService;
    driverVersion: string;
}

function loadTsNativeProvider(): TsNativeProviderExports {
    // Computed paths: esbuild must NOT statically resolve these (the chunk
    // stays out of the activation bundle). Runtime layouts:
    //  - bundled: __dirname = <ext>/dist            → dist/tsNativeProvider.js
    //  - tsc/out: __dirname = out/src/services/sqlDataPlane
    //             → out/src/services/tsNative/providerEntry.js
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path") as typeof import("path");
    const candidates = [
        path.join(__dirname, "tsNativeProvider.js"),
        path.join(__dirname, "..", "tsNative", "providerEntry.js"),
    ];
    for (const candidate of candidates) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require(candidate) as TsNativeProviderExports;
        } catch {
            // Try the compiled development layout before reporting unavailable.
        }
    }
    throw new SqlDataPlaneError(
        DataPlaneErrorCodes.unavailable,
        NativeSqlProvider.bundleUnavailable,
        false,
    );
}
