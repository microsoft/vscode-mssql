/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * TsNativeBackend (TSQ2 addendum §5, §7-8): ISqlConnectionService over an
 * injected ITdsDriver. The tedious module never appears here — the factory
 * (sqlDataPlane composition) lazy-loads the driver bundle and hands the port
 * in; the fake driver makes the whole backend testable in-process.
 *
 * Open sequence (§5.5): validate profile → resolve secrets inside ONE
 * absolute open deadline → driver.open → install session event router →
 * publish session with negotiated capabilities. Credential material lives
 * only in the open-request local and is never retained after connect
 * settles; a deadline-abandoned open destroys the late connection.
 */

import {
    CapabilityCheck,
    DataPlaneAvailability,
    DataPlaneErrorCodes,
    DataPlaneEvent,
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
    SessionInfo,
    SqlBackendCapabilities,
    SqlDataPlaneError,
} from "../sqlDataPlane/api";
import {
    EngineClock,
    EngineIds,
    ITdsConnection,
    ITdsDriver,
    TdsOpenRequest,
} from "./driver/tdsDriver";
import { DEFAULT_ENGINE_DEADLINES, EngineObserver, EngineSlicePolicy } from "./queryEngine";
import { TsNativeSession } from "./tsNativeSession";

// ---------------------------------------------------------------------------
// Negotiated capability struct (honest v1: vector/spatial/capture land with
// their transcoder/capture tasks; never advertised from scaffolding).
// ---------------------------------------------------------------------------

export const TS_NATIVE_CAPABILITIES: SqlBackendCapabilities = {
    protocolVersion: "ts-native/1",
    streamingRows: true,
    creditBackpressure: true,
    cancel: true,
    dispose: true,
    oneActiveQueryPerSession: true,
    multipleResultSets: true,
    serverMessagesVerbatim: true,
    rowsAffectedStructured: true,
    executionPlanXml: false,
    estimatedPlan: true,
    actualPlan: true,
    typedCells: true,
    maxCellBytesHonored: true,
    pageRowsHonored: true,
    pageBytesHonored: true,
    queryTimeoutHonored: true,
    compactRows: true,
    // Vector: tedious/TDS 7.4 down-converts to identity-less varchar
    // (empirical probe) — §6.8 forbids guessing, so NOT advertised. The
    // transcoder exists and lights up when a driver exposes the identity.
    vectorBinaryV1: false,
    // Spatial: UDT identity IS reliable (udtInfo.typeName) and the CLR→WKB
    // transcoder is live-fixture proven (§6.9 gate).
    spatialWkbV1: true,
    captureControl: false,
    replayDescriptors: true,
    resumeAfterDisconnect: false,
    metadataEndpoints: false,
};

export interface TsNativeBackendDeps {
    driver: ITdsDriver;
    clock: EngineClock;
    ids: EngineIds;
    deadlines?: Partial<TsNativeDeadlines>;
    slice?: EngineSlicePolicy;
    observer?: EngineObserver;
    lossyPreview?: boolean;
    /** Server-facts/@@SPID probes on open (tedious adapter turns on). */
    probeOnOpen?: boolean;
    /** Advertised struct (capability masks apply at composition; masks only
     *  ever turn support OFF — TSQ2 §11). */
    capabilities?: SqlBackendCapabilities;
    /** Debug default execute options (lower-only; engine clamps enforce). */
    defaultExecuteOptions?: { pageRows?: number; pageBytes?: number; maxCellBytes?: number };
    /** §5.13 memory breaker inputs; off when absent. */
    memoryBudget?: import("./memoryBudget").MemoryBudgetConfig;
    memoryReader?: import("./memoryBudget").MemoryReader;
    /** Status-surface summary of active debug overrides (safe fields only). */
    overridesSummary?: Record<string, unknown>;
}

export interface TsNativeDeadlines {
    openMs: number;
    cancelAckMs: number;
    completeAfterCancelMs: number;
    disposeDrainMs: number;
    closeMs: number;
    sinkCallbackDeadlineMs: number;
}

export const TS_NATIVE_DEFAULT_DEADLINES: TsNativeDeadlines = {
    openMs: 30_000,
    cancelAckMs: DEFAULT_ENGINE_DEADLINES.cancelAckMs,
    completeAfterCancelMs: DEFAULT_ENGINE_DEADLINES.completeAfterCancelMs,
    disposeDrainMs: DEFAULT_ENGINE_DEADLINES.disposeDrainMs,
    closeMs: 15_000,
    sinkCallbackDeadlineMs: DEFAULT_ENGINE_DEADLINES.sinkCallbackDeadlineMs,
};

export class TsNativeBackend implements ISqlConnectionService {
    availability: DataPlaneAvailability;
    readonly onDidChangeAvailability: DataPlaneEvent<DataPlaneAvailability> = () => ({
        dispose: () => undefined,
    });
    readonly backendInfo = {
        kind: "ts-native",
        displayName: "Native TypeScript",
        version: "",
    };

    private readonly deadlines: TsNativeDeadlines;
    private readonly sessions = new Map<string, TsNativeSession>();

    private readonly effectiveCapabilities: SqlBackendCapabilities;

    constructor(private readonly deps: TsNativeBackendDeps) {
        this.deadlines = { ...TS_NATIVE_DEFAULT_DEADLINES, ...deps.deadlines };
        this.backendInfo.version = deps.driver.version;
        this.effectiveCapabilities = deps.capabilities ?? TS_NATIVE_CAPABILITIES;
        this.availability = {
            state: "available",
            backend: "ts-native",
            capabilities: this.effectiveCapabilities,
        };
    }

    async canOpen(params: OpenSessionParams): Promise<CapabilityCheck> {
        // Registry-level requirement evaluation already ran; this is the
        // backend's own hard floor (never reinterpret auth — §7.3).
        if (params.profile.authKind === "integrated") {
            return {
                ok: false,
                missing: ["auth.integrated"],
                reason: "Windows integrated authentication is not supported by the Native TypeScript provider",
            };
        }
        return { ok: true };
    }

    async openSession(params: OpenSessionParams): Promise<ISqlSession> {
        const gate = await this.canOpen(params);
        if (!gate.ok) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.capabilityUnsupported,
                gate.reason ?? "unsupported profile",
                false,
                { backend: { kind: "ts-native" } },
            );
        }
        const openTimeoutMs = params.openTimeoutMs ?? this.deadlines.openMs;
        let abandoned = false;
        let openTimer: { dispose(): void } | undefined;
        const timer = new Promise<never>((_resolve, reject) => {
            openTimer = this.deps.clock.setTimeout(() => {
                abandoned = true;
                reject(
                    new SqlDataPlaneError(
                        DataPlaneErrorCodes.clientTimeout,
                        `open deadline (${openTimeoutMs}ms) expired`,
                        true,
                        { synthesized: true },
                    ),
                );
            }, openTimeoutMs);
        });
        try {
            return await Promise.race([this.openInner(params, () => abandoned), timer]);
        } finally {
            openTimer?.dispose(); // leak discipline (N-I10)
        }
    }

    private async openInner(
        params: OpenSessionParams,
        isAbandoned: () => boolean,
    ): Promise<ISqlSession> {
        // 1) Resolve secrets (inside the shared deadline; never retained).
        const request = await this.buildOpenRequest(params);
        // 2) Physical open with a router that binds to the session later —
        //    events before the session exists are structurally impossible
        //    because the driver only emits through this observer after open.
        let session: TsNativeSession | undefined;
        let connection: ITdsConnection;
        try {
            connection = await this.deps.driver.open(
                request,
                {
                    onLost: (reason) => session?.handleConnectionLost(reason),
                    onDatabaseChanged: (database) => session?.handleDatabaseChanged(database),
                    onOrphanMessage: (message) => session?.handleOrphanMessage(message),
                },
                { operationId: this.deps.ids.next("op") },
            );
        } catch (error) {
            throw this.mapOpenError(error);
        }
        if (isAbandoned()) {
            // The caller already saw the deadline rejection; never leak the
            // late socket.
            connection.destroy("open abandoned after deadline");
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.clientTimeout,
                "open abandoned after deadline",
                true,
            );
        }
        // 3) Session facts (probes are the tedious adapter's job — TSQ2-3).
        const info: SessionInfo = {
            backendKind: "ts-native",
            ...(request.database !== undefined ? { database: request.database } : {}),
            ...(connection.serverFacts.serverVersion !== undefined
                ? { serverVersion: connection.serverFacts.serverVersion }
                : {}),
            ...(params.profile.trustServerCertificate !== undefined
                ? { trustServerCertificate: params.profile.trustServerCertificate }
                : {}),
            encrypted: request.encrypt !== false,
        };
        session = new TsNativeSession(connection, info, this.effectiveCapabilities, {
            clock: this.deps.clock,
            ids: this.deps.ids,
            deadlines: {
                cancelAckMs: this.deadlines.cancelAckMs,
                completeAfterCancelMs: this.deadlines.completeAfterCancelMs,
                disposeDrainMs: this.deadlines.disposeDrainMs,
                sinkCallbackDeadlineMs: this.deadlines.sinkCallbackDeadlineMs,
                closeMs: this.deadlines.closeMs,
            },
            ...(this.deps.slice ? { slice: this.deps.slice } : {}),
            ...(this.deps.observer ? { observer: this.deps.observer } : {}),
            ...(this.deps.lossyPreview !== undefined
                ? { lossyPreview: this.deps.lossyPreview }
                : {}),
            ...(this.deps.defaultExecuteOptions
                ? { defaultExecuteOptions: this.deps.defaultExecuteOptions }
                : {}),
            ...(this.deps.memoryBudget && this.deps.memoryReader
                ? { memoryBudget: this.deps.memoryBudget, memoryReader: this.deps.memoryReader }
                : {}),
            onFinalized: (sessionId) => this.sessions.delete(sessionId),
        });
        this.sessions.set(session.sessionId, session);
        return session;
    }

    private async buildOpenRequest(params: OpenSessionParams): Promise<TdsOpenRequest> {
        const profile = params.profile;
        const { server, instanceName, port } = parseServer(profile.server);
        const base: Omit<TdsOpenRequest, "auth"> = {
            server,
            ...(instanceName !== undefined ? { instanceName } : {}),
            ...(port !== undefined ? { port } : {}),
            ...((params.database ?? profile.database)
                ? { database: params.database ?? profile.database }
                : {}),
            applicationName: params.applicationName,
            encrypt: mapEncrypt(profile.encrypt),
            trustServerCertificate: profile.trustServerCertificate === true,
            connectTimeoutMs: params.openTimeoutMs ?? this.deadlines.openMs,
        };
        if (profile.authKind === "sql") {
            const password = await params.auth?.passwordProvider?.();
            if (password === undefined) {
                throw new SqlDataPlaneError(
                    DataPlaneErrorCodes.auth,
                    "no password provider resolved a credential for SQL login",
                    false,
                );
            }
            return { ...base, auth: { kind: "sqlLogin", user: profile.user ?? "", password } };
        }
        // aad | bearer — deferred token provider, fresh per physical open.
        const token = await params.auth?.tokenProvider?.();
        if (!token) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.auth,
                "no token provider resolved an access token",
                false,
            );
        }
        return { ...base, auth: { kind: "accessToken", token } };
    }

    private mapOpenError(error: unknown): SqlDataPlaneError {
        if (error instanceof SqlDataPlaneError) {
            return error;
        }
        const category = (error as { category?: string })?.category;
        const serverDetail = (error as { serverDetail?: { number?: number } })?.serverDetail;
        if (category === "auth") {
            return new SqlDataPlaneError(DataPlaneErrorCodes.auth, "login failed", false, {
                backend: { kind: "ts-native" },
                ...(serverDetail ? { server: serverDetail } : {}),
            });
        }
        return new SqlDataPlaneError(
            DataPlaneErrorCodes.unavailable,
            category === "timeout" ? "connection timed out" : "connection failed",
            true,
            { backend: { kind: "ts-native" } },
        );
    }

    /** Diagnostic snapshot (status/Debug Console). */
    snapshot(): Record<string, unknown> {
        return {
            backend: "ts-native",
            driver: { name: this.deps.driver.name, version: this.deps.driver.version },
            ...(this.deps.overridesSummary ? { overrides: this.deps.overridesSummary } : {}),
            sessions: [...this.sessions.values()].map((session) => session.snapshot()),
        };
    }

    async dispose(): Promise<void> {
        await Promise.all(
            [...this.sessions.values()].map((session) =>
                session.close({ reason: "backend dispose" }).catch(() => undefined),
            ),
        );
        this.sessions.clear();
    }
}

// ---------------------------------------------------------------------------
// Profile mapping helpers
// ---------------------------------------------------------------------------

function mapEncrypt(encrypt: string | boolean | undefined): boolean | "strict" {
    if (encrypt === "strict") {
        return "strict";
    }
    if (encrypt === false || encrypt === "false" || encrypt === "optional") {
        return false;
    }
    return true; // default and "true"/"mandatory"
}

/** `host,port` and `host\instance` forms (TCP only — no pipes/LocalDB). */
function parseServer(raw: string): { server: string; instanceName?: string; port?: number } {
    const commaIndex = raw.lastIndexOf(",");
    if (commaIndex > 0) {
        const port = Number(raw.slice(commaIndex + 1).trim());
        if (Number.isInteger(port) && port > 0) {
            return { server: raw.slice(0, commaIndex).trim(), port };
        }
    }
    const slashIndex = raw.indexOf("\\");
    if (slashIndex > 0) {
        return {
            server: raw.slice(0, slashIndex).trim(),
            instanceName: raw.slice(slashIndex + 1).trim(),
        };
    }
    return { server: raw.trim() };
}
