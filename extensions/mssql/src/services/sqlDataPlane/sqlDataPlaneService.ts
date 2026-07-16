/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL Data Plane composition root v2 (web addendum §3.2, TSQ2 addendum §3.5):
 * an activation-owned registry that supports multiple concurrently active
 * LOCAL providers, per-session provider binding, live default changes for
 * future sessions, passive status, and explicit lifecycle ownership.
 *
 * Rules enforced here (not in factories):
 *  - unknown backend kind is a typed failure, never a local-STS fallback;
 *  - passive status/capability queries never construct a backend, prompt for
 *    auth, or resolve a credential;
 *  - a failed startup clears the single-flight promise (retryable);
 *  - a configuration change drains only the affected entry;
 *  - requiredCapabilities are evaluated BEFORE any credential provider runs;
 *  - sessions are explicitly registered and finalized (counts drive stale
 *    entry swap), and every session records its provider identity.
 */

import * as vscode from "vscode";
import { RequestType, NotificationType } from "vscode-languageclient";
import SqlToolsServiceClient from "../../languageservice/serviceclient";
import {
    CapabilityCheck,
    DataPlaneAvailability,
    ISqlConnectionService,
    ISqlSession,
    OpenSessionParams,
    SqlCapabilityId,
    SqlCapabilityRequirement,
    SqlCapabilitySet,
    SqlCapabilityValue,
    SqlDataPlaneError,
    DataPlaneErrorCodes,
    SqlDataPlaneErrorInfo,
} from "./api";
import {
    BackendEntrySnapshot,
    BackendEntryState,
    DataPlaneConfigReader,
    SqlBackendFactory,
    SqlBackendFactoryContext,
    SqlBackendIdentity,
    SqlBackendKind,
    normalizeBackendKind,
} from "./backendFactory";
import {
    CapabilityAnswer,
    answerFromSet,
    capabilitySet,
    conditional,
    evaluateRequirements,
    mergeCapabilitySets,
    setFromNegotiated,
    supported,
    unsupported,
} from "./capabilityRegistry";
import {
    CapabilityFallbackPolicy,
    CAPABILITY_FALLBACK_SETTING,
    FallbackDecision,
    FallbackInteraction,
    resolveCapabilityFallback,
} from "./providerSuggestions";
import { FakeBackend, FAKE_CAPABILITIES } from "./fakeBackend";
import { Sts2Backend, Sts2Rpc, DEFAULT_DEADLINES, Sts2Deadlines } from "../sts2/sts2Backend";
// Pure parsing module (driver-port types only — no tedious in this graph).
import {
    TS_NATIVE_OVERRIDES_SETTING,
    TsNativeOverrides,
    parseTsNativeOverrides,
} from "../tsNative/overrides";
// Observability lives in the ACTIVATION bundle, not the lazy provider chunk:
// the chunk bundles its own sink-less copy of diagnosticsCore, so an observer
// built inside it emits into a dead diag singleton (no session-journal
// events). Building the observer here binds it to the real diag substrate and
// injecting it into the chunk restores every sqlDataPlane.tsNative.* event.
// observability.ts keeps its engine/api imports type-only, so this pulls NO
// tedious (and no engine runtime) into activation — packaging tests enforce it.
import { createDiagEngineObserver } from "../tsNative/observability";
import type { EngineObserver } from "../tsNative/queryEngine";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const SETTING_ENABLED = "mssql.sqlDataPlane.enabled";
const SETTING_BACKEND = "mssql.sqlDataPlane.backend";
const TIMEOUT_SETTINGS = [
    "mssql.sqlDataPlane.timeouts.openMs",
    "mssql.sqlDataPlane.timeouts.cancelAckMs",
    "mssql.sqlDataPlane.timeouts.closeMs",
    "mssql.sqlDataPlane.timeouts.disposeDrainMs",
    "mssql.sqlDataPlane.timeouts.initializeMs",
] as const;

function vscodeConfigReader(): DataPlaneConfigReader {
    return {
        get<T>(section: string, defaultValue: T): T {
            return vscode.workspace.getConfiguration().get<T>(section, defaultValue);
        },
    };
}

function deadlinesFromConfig(config: DataPlaneConfigReader): Sts2Deadlines {
    return {
        openMs: config.get<number>("mssql.sqlDataPlane.timeouts.openMs", DEFAULT_DEADLINES.openMs),
        cancelAckMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.cancelAckMs",
            DEFAULT_DEADLINES.cancelAckMs,
        ),
        closeMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.closeMs",
            DEFAULT_DEADLINES.closeMs,
        ),
        disposeDrainMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.disposeDrainMs",
            DEFAULT_DEADLINES.disposeDrainMs,
        ),
        completeAfterCancelMs: DEFAULT_DEADLINES.completeAfterCancelMs,
        initializeMs: config.get<number>(
            "mssql.sqlDataPlane.timeouts.initializeMs",
            DEFAULT_DEADLINES.initializeMs,
        ),
    };
}

/** Transport over the shared STS stdio (multiplexer v2 lane). */
class ServiceClientRpc implements Sts2Rpc {
    private client = SqlToolsServiceClient.instance;

    sendRequest<R>(method: string, params: unknown): Promise<R> {
        const type = new RequestType<unknown, R, void>(method);
        return Promise.resolve(this.client.sendRequest(type, params));
    }

    sendNotification(method: string, params: unknown): void {
        const type = new NotificationType<unknown>(method);
        void this.client.sendNotification(type, params);
    }

    onNotification(method: string, handler: (params: unknown) => void): { dispose(): void } {
        const type = new NotificationType<unknown>(method);
        this.client.onNotification(type, handler);
        // The language client keeps handlers for its lifetime; per-handler
        // disposal is not exposed — the backend subscribes once.
        return { dispose: () => undefined };
    }
}

// ---------------------------------------------------------------------------
// Built-in factories
// ---------------------------------------------------------------------------

function sts2LocalFactory(providerVersion: string): SqlBackendFactory {
    return {
        kind: "sts2-local",
        displayName: "SQL Tools Service (STS v2)",
        realmClass: "local",
        identity: {
            kind: "sts2-local",
            implementation: "sts2",
            transport: "stdio-jsonrpc",
            driver: "sqlclient",
            deployment: "extension-local",
            realmId: "local",
            providerVersion,
            protocolVersion: "2.0",
        },
        // Honest static statement (TSQ2 §8.1): initialize-negotiated facts are
        // `conditional` here and refined per session from the live handshake.
        staticCapabilities: capabilitySet({
            "auth.sqlLogin": supported("static"),
            "auth.entraToken": supported("static"),
            "auth.integrated": supported("static"),
            "auth.hostDelegated": unsupported("static", "localDeployment"),
            "connect.tcp": supported("static"),
            "connect.routeAlias": unsupported("static", "localDeployment"),
            "connect.localdb": supported("static"),
            "connect.tds8Strict": supported("static"),
            "exec.streamingRows": supported("static"),
            "exec.multipleResultSets": supported("static"),
            "exec.oneActiveQuery": supported("static"),
            "exec.cancel": supported("static"),
            "exec.dispose": supported("static"),
            "exec.queryTimeout": conditional("static", "negotiatedAtInitialize"),
            "exec.compactRows": conditional("static", "negotiatedAtInitialize"),
            "exec.maxCellBytes": conditional("static", "negotiatedAtInitialize"),
            "exec.pageRows": conditional("static", "negotiatedAtInitialize"),
            "exec.pageBytes": conditional("static", "negotiatedAtInitialize"),
            "exec.windowPages": supported("static", "exact", { limit: 4, unit: "pages" }),
            "types.typedCells": supported("static"),
            "types.vectorBinaryV1": conditional("static", "negotiatedAtInitialize"),
            "types.spatialWkbV1": conditional("static", "negotiatedAtInitialize"),
            "types.decimalExact": supported("static"),
            "types.datetimeOffsetOriginal": supported("static"),
            "types.largeValueStreaming": supported("static"),
            "types.jsonNative": conditional("static", "serverDependent"),
            "messages.verbatim": supported("static"),
            "messages.rowsAffectedStructured": supported("static"),
            "plan.xmlResult": unsupported("static", "notExposed"),
            "plan.estimated": supported("static"),
            "plan.actual": supported("static"),
            "metadata.catalogSql": supported("static"),
            "metadata.endpoints": unsupported("static", "notImplemented"),
            "diag.supportCapsule": unsupported("static", "notImplemented"),
            "diag.captureControl": conditional("static", "negotiatedAtInitialize"),
            "diag.replayDescriptor": supported("static"),
            "diag.resumeAfterDisconnect": unsupported("static", "notSupported"),
        }),
        fingerprintSettings: [...TIMEOUT_SETTINGS],
        create: async (context: SqlBackendFactoryContext): Promise<ISqlConnectionService> => {
            const backend = new Sts2Backend(
                new ServiceClientRpc(),
                deadlinesFromConfig(context.config),
            );
            await backend.start();
            return backend;
        },
    };
}

function fakeFactory(providerVersion: string): SqlBackendFactory {
    return {
        kind: "fake",
        displayName: "Fake (test transcripts)",
        realmClass: "test",
        identity: {
            kind: "fake",
            implementation: "fake",
            transport: "inprocess",
            driver: "fake",
            deployment: "test",
            realmId: "test",
            providerVersion,
        },
        // The fake's negotiated struct IS its honest static statement, plus
        // auth/metadata facts the struct never carried (it accepts any
        // scripted profile).
        staticCapabilities: mergeCapabilitySets(
            setFromNegotiated(FAKE_CAPABILITIES, "static"),
            capabilitySet({
                "auth.sqlLogin": supported("static"),
                "auth.entraToken": supported("static"),
                "auth.integrated": supported("static"),
                "metadata.catalogSql": supported("static"),
            }),
        ),
        fingerprintSettings: [],
        create: async (): Promise<ISqlConnectionService> => new FakeBackend({}),
    };
}

const TS_NATIVE_MIN_NODE_MAJOR = 22; // tedious 20 engines

/**
 * ts-native factory (TSQ2 §4.2, D6): the provider ships as the dedicated
 * lazy chunk dist/tsNativeProvider.js (tedious inside). Loading happens on
 * FIRST create(), via a computed-path require so esbuild never inlines the
 * chunk into the activation bundle. Unit tests exercise the compiled
 * out/-tree sibling instead.
 */
function tsNativeFactory(providerVersion: string): SqlBackendFactory {
    return {
        kind: "ts-native",
        displayName: "Native TypeScript (tedious)",
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
                    `ts-native requires Node >= ${TS_NATIVE_MIN_NODE_MAJOR} (host has ${process.versions.node})`,
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

    const path = require("path") as typeof import("path");
    const candidates = [
        path.join(__dirname, "tsNativeProvider.js"),
        path.join(__dirname, "..", "tsNative", "providerEntry.js"),
    ];
    let lastError: unknown;
    for (const candidate of candidates) {
        try {
            return require(candidate) as TsNativeProviderExports;
        } catch (error) {
            lastError = error;
        }
    }
    throw new SqlDataPlaneError(
        DataPlaneErrorCodes.unavailable,
        `ts-native provider bundle not found (${lastError instanceof Error ? lastError.message : "unknown"})`,
        false,
    );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

interface BackendEntry {
    readonly factory: SqlBackendFactory;
    state: BackendEntryState;
    startup?: Promise<ISqlConnectionService>;
    service?: ISqlConnectionService;
    /** Registry view handed to consumers (wraps sessions for accounting). */
    view?: ISqlConnectionService;
    configFingerprint: string;
    staleConfig: boolean;
    activeSessionCount: number;
    lastError?: SqlDataPlaneErrorInfo;
}

interface SessionRecord {
    readonly kind: SqlBackendKind;
    readonly identity: SqlBackendIdentity;
    finalized: boolean;
}

export interface OpenSessionOptions {
    /** Explicit provider override (per-document binding); wins over settings. */
    backendKind?: SqlBackendKind;
}

const DISPOSE_TIMEOUT_MS = 10_000;

let instance: SqlDataPlaneService | undefined;

export class SqlDataPlaneService {
    private readonly entries = new Map<SqlBackendKind, BackendEntry>();
    private readonly sessions = new Map<string, SessionRecord>();
    private readonly disposables: { dispose(): void }[] = [];
    private disposed = false;
    /**
     * Per-profile fallback memory (TSQ2 §8.2 UX): once a profile has been
     * routed to an alternative backend (e.g. a Windows-auth profile that
     * ts-native can't open falls back to sts2-local), remember it so reconnects
     * to the SAME profile don't re-prompt. In-memory / session-scoped and
     * cleared on any sqlDataPlane config change; an explicit per-document
     * override always wins over the remembered choice.
     */
    private readonly rememberedFallback = new Map<string, SqlBackendKind>();

    constructor(
        private readonly config: DataPlaneConfigReader = vscodeConfigReader(),
        factories?: readonly SqlBackendFactory[],
        private readonly providerVersion: string = "dev",
    ) {
        for (const factory of factories ?? [
            sts2LocalFactory(providerVersion),
            tsNativeFactory(providerVersion),
            fakeFactory(providerVersion),
        ]) {
            this.registerFactory(factory);
        }
    }

    /** Transitional accessor; activation owns the instance via register(). */
    static get(): SqlDataPlaneService {
        instance ??= new SqlDataPlaneService();
        return instance;
    }

    /** Test seam: install a specific instance (undefined resets). */
    static setForTests(next: SqlDataPlaneService | undefined): void {
        instance = next;
    }

    /**
     * Register an additional provider factory (the ts-native module
     * self-registers through this — the registry has no static import of the
     * provider bundle). Duplicate kinds are a programming error.
     */
    registerFactory(factory: SqlBackendFactory): void {
        if (this.entries.has(factory.kind)) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.invalidRequest,
                `backend factory already registered: ${factory.kind}`,
            );
        }
        this.entries.set(factory.kind, {
            factory,
            state: "idle",
            configFingerprint: this.fingerprintFor(factory),
            staleConfig: false,
            activeSessionCount: 0,
        });
    }

    get enabled(): boolean {
        return this.config.get<boolean>(SETTING_ENABLED, false);
    }

    /** The configured default kind for FUTURE sessions (alias-normalized). */
    defaultBackendKind(): SqlBackendKind {
        const raw = this.config.get<string>(SETTING_BACKEND, "sts2-local");
        const kind = normalizeBackendKind(raw);
        if (!kind) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.invalidRequest,
                `unknown mssql.sqlDataPlane.backend value: ${raw}`,
            );
        }
        return kind;
    }

    /**
     * Resolve (and lazily start, single-flight) the provider for `kind`.
     * The returned service is the registry view: sessions it opens are
     * registered/finalized for lifecycle accounting and identity stamping.
     */
    /**
     * Resolve the service for a profile, honoring a remembered fallback route
     * (TSQ2 §8.2). Background/dedicated consumers that can't prompt — metadata
     * hydration above all — call this so a Windows-auth profile whose primary
     * connection already fell back to sts2-local opens ITS metadata sessions on
     * sts2-local too (silently), instead of failing on the ts-native default.
     * Falls back to the configured default when nothing is remembered.
     */
    async serviceForProfile(profileFingerprint?: string): Promise<ISqlConnectionService> {
        const backendKind = profileFingerprint
            ? this.rememberedFallback.get(profileFingerprint)
            : undefined;
        return this.service(backendKind ? { backendKind } : undefined);
    }

    async service(opts?: OpenSessionOptions): Promise<ISqlConnectionService> {
        this.assertNotDisposed();
        const kind = opts?.backendKind ?? this.defaultBackendKind();
        const entry = this.requireEntry(kind);
        if (entry.service) {
            return (entry.view ??= this.makeView(entry));
        }
        if (!entry.startup) {
            entry.state = "starting";
            entry.startup = entry.factory
                .create({ config: this.config, providerVersion: this.providerVersion })
                .then((service) => {
                    entry.service = service;
                    entry.state = "running";
                    delete entry.lastError;
                    return service;
                })
                .catch((error: unknown) => {
                    // Failed startup is retryable: clear the single flight.
                    entry.startup = undefined;
                    entry.state = "failed";
                    entry.lastError = toErrorInfo(error, kind);
                    throw error;
                });
        }
        await entry.startup;
        return (entry.view ??= this.makeView(this.requireEntry(kind)));
    }

    // -----------------------------------------------------------------------
    // Capability oracle (pure; zero side effects — never constructs backends)
    // -----------------------------------------------------------------------

    providerSupports(kind: SqlBackendKind, id: SqlCapabilityId): CapabilityAnswer {
        const entry = this.requireEntry(kind);
        const set = this.effectiveSet(entry);
        const answer = answerFromSet(set, id);
        if (answer.supported === false) {
            const alternatives = this.alternativesFor(id, kind);
            return alternatives.length > 0 ? { ...answer, alternatives } : answer;
        }
        return answer;
    }

    sessionSupports(session: ISqlSession, id: SqlCapabilityId): CapabilityAnswer {
        const record = this.sessions.get(session.sessionId);
        const kind = record?.kind ?? normalizeBackendKind(session.info.backendKind) ?? "sts2-local";
        const entry = this.entries.get(kind);
        const negotiated = setFromNegotiated(session.capabilities, "session");
        const set = entry
            ? mergeCapabilitySets(entry.factory.staticCapabilities, negotiated)
            : negotiated;
        const answer = answerFromSet(set, id);
        if (answer.supported === false) {
            const alternatives = this.alternativesFor(id, kind);
            return alternatives.length > 0 ? { ...answer, alternatives } : answer;
        }
        return answer;
    }

    anyProviderSupports(id: SqlCapabilityId): CapabilityAnswer {
        const kinds = this.alternativesFor(id);
        if (kinds.length > 0) {
            return { supported: true, alternatives: kinds };
        }
        const anyConditional = [...this.entries.values()].some(
            (entry) => entry.factory.staticCapabilities.values[id]?.support === "conditional",
        );
        return anyConditional ? { supported: "unknown" } : { supported: false };
    }

    /**
     * canOpen without side effects: static statement (plus live negotiated
     * facts when the provider is already running) — never constructs a
     * backend, never touches params.auth.
     */
    async canOpen(params: OpenSessionParams, opts?: OpenSessionOptions): Promise<CapabilityCheck> {
        const kind = opts?.backendKind ?? this.defaultBackendKind();
        const entry = this.requireEntry(kind);
        const check = evaluateRequirements(this.effectiveSet(entry), this.requirementsFor(params));
        if (check.ok) {
            return check;
        }
        const alternatives = this.kindsSatisfying(this.requirementsFor(params), kind);
        return alternatives.length > 0 ? { ...check, alternatives } : check;
    }

    /**
     * Open a session on the resolved provider. Requirement evaluation happens
     * HERE, before the provider (and therefore before any credential
     * provider) is invoked — the credential tripwire tests pin this order.
     */
    async openSession(params: OpenSessionParams, opts?: OpenSessionOptions): Promise<ISqlSession> {
        const check = await this.canOpen(params, opts);
        if (!check.ok) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.capabilityUnsupported,
                check.reason ?? "required capabilities not supported by the selected backend",
                false,
                { backend: { kind: opts?.backendKind ?? this.defaultBackendKind() } },
            );
        }
        const service = await this.service(opts);
        return service.openSession(params);
    }

    /**
     * Open a session, applying the capability-fallback policy (TSQ2 §8.2) when
     * the resolved backend can't open the profile — the single place every
     * consumer (Query Studio, Object Explorer v2, …) routes through so the
     * Windows-auth → SQL Tools Service experience is identical everywhere.
     *
     * Resolution order for the backend:
     *   1. explicit per-document override (opts.backendKind) — always wins;
     *   2. a remembered fallback for this profile (no re-prompt on reconnect);
     *   3. the configured default.
     * If canOpen still fails, resolveCapabilityFallback decides (prompt/auto/
     * off). A chosen alternative is remembered per profile (unless the caller
     * pinned an override). Every route is attributable via session.info.
     */
    async openSessionWithFallback(
        params: OpenSessionParams,
        opts: OpenSessionOptions | undefined,
        interaction: FallbackInteraction,
    ): Promise<{ session: ISqlSession; decision?: FallbackDecision }> {
        const fingerprint = params.profile.profileFingerprint;
        const pinned = opts?.backendKind;
        let backendKind = pinned ?? this.rememberedFallback.get(fingerprint);
        const check = await this.canOpen(params, backendKind ? { backendKind } : undefined);
        let decision: FallbackDecision | undefined;
        if (!check.ok) {
            const policy = this.config.get<CapabilityFallbackPolicy>(
                CAPABILITY_FALLBACK_SETTING,
                "prompt",
            );
            decision = await resolveCapabilityFallback({
                check,
                policy,
                currentKind: backendKind ?? this.defaultBackendKind(),
                displayNameFor: (kind) => this.displayNameFor(kind),
                interaction,
            });
            if (decision.kind !== "useAlternative" || !decision.alternative) {
                throw new SqlDataPlaneError(
                    DataPlaneErrorCodes.capabilityUnsupported,
                    check.reason ?? "the selected SQL data plane provider cannot open this profile",
                    false,
                    { backend: { kind: backendKind ?? this.defaultBackendKind() } },
                );
            }
            backendKind = decision.alternative;
            // Remember only a policy-resolved route, and only when the caller
            // didn't pin an override — an override is the caller's own choice.
            if (!pinned) {
                this.rememberedFallback.set(fingerprint, backendKind);
            }
        }
        const session = await this.openSession(params, backendKind ? { backendKind } : undefined);
        return { session, ...(decision ? { decision } : {}) };
    }

    /** Remembered per-profile fallback routes (for status / Debug Console). */
    rememberedFallbacks(): Array<{ profileFingerprint: string; backendKind: SqlBackendKind }> {
        return [...this.rememberedFallback.entries()].map(([profileFingerprint, backendKind]) => ({
            profileFingerprint,
            backendKind,
        }));
    }

    // -----------------------------------------------------------------------
    // Status (passive: reads state only)
    // -----------------------------------------------------------------------

    availability(): DataPlaneAvailability {
        const entry = this.entries.get(this.tryDefaultKind() ?? "sts2-local");
        return entry?.service?.availability ?? { state: "unknown" };
    }

    /** Display name for UX (fallback prompts, status, suggestions). */
    displayNameFor(kind: SqlBackendKind): string {
        return this.entries.get(kind)?.factory.displayName ?? kind;
    }

    entrySnapshots(): BackendEntrySnapshot[] {
        return [...this.entries.values()].map((entry) => ({
            kind: entry.factory.kind,
            state: entry.state,
            displayName: entry.factory.displayName,
            realmClass: entry.factory.realmClass,
            activeSessionCount: entry.activeSessionCount,
            configFingerprint: entry.configFingerprint,
            staleConfig: entry.staleConfig,
            ...(entry.lastError ? { lastError: entry.lastError } : {}),
        }));
    }

    /**
     * Passive per-backend detail for status surfaces: running services'
     * own diagnostic snapshots (ts-native `snapshot()`, STS2 `status()`).
     * Reads state only — never constructs or connects.
     */
    entryDetails(): Record<string, unknown> {
        const details: Record<string, unknown> = {};
        for (const entry of this.entries.values()) {
            const service = entry.service as
                | { snapshot?: () => unknown; status?: () => unknown }
                | undefined;
            const detail = service?.snapshot?.() ?? service?.status?.();
            if (detail !== undefined) {
                details[entry.factory.kind] = detail;
            }
        }
        return details;
    }

    /** Safe, PASSIVE status dump (never constructs a backend — D5). */
    statusSummary(): Record<string, unknown> {
        const rawKind = this.config.get<string>(SETTING_BACKEND, "sts2-local");
        return {
            enabled: this.enabled,
            backend: rawKind,
            normalizedBackend: this.tryDefaultKind() ?? `INVALID(${rawKind})`,
            availability: this.availability(),
            activeSessions: this.sessions.size,
            entries: this.entrySnapshots(),
            details: this.entryDetails(),
        };
    }

    /**
     * Per-backend capability values (static, merged with negotiated facts once
     * a backend is running) for the Debug Console capability matrix. Passive;
     * every field is safe protocol metadata (support/fidelity/limit/reasonCode/
     * source — reasonCode is a stable id, never raw driver text).
     */
    capabilitySnapshot(): Record<string, Record<string, SqlCapabilityValue>> {
        const out: Record<string, Record<string, SqlCapabilityValue>> = {};
        for (const entry of this.entries.values()) {
            out[entry.factory.kind] = { ...this.effectiveSet(entry).values } as Record<
                string,
                SqlCapabilityValue
            >;
        }
        return out;
    }

    // -----------------------------------------------------------------------
    // Configuration changes: drain only the affected entry
    // -----------------------------------------------------------------------

    attachConfigWatcher(): { dispose(): void } {
        const watcher = vscode.workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration("mssql.sqlDataPlane")) {
                return;
            }
            this.handleConfigurationChanged();
        });
        this.disposables.push(watcher);
        return watcher;
    }

    /** Re-fingerprint every entry; drain/recompose only what changed. */
    handleConfigurationChanged(): void {
        // The default backend or fallback policy may have changed — forget
        // remembered routes so the new policy is honored on the next connect.
        this.rememberedFallback.clear();
        for (const entry of this.entries.values()) {
            if (!entry.service && !entry.startup) {
                // idle entries just refresh their fingerprint
                entry.configFingerprint = this.fingerprintFor(entry.factory);
                continue;
            }
            const next = this.fingerprintFor(entry.factory);
            if (next !== entry.configFingerprint) {
                entry.configFingerprint = next;
                if (entry.activeSessionCount === 0) {
                    void this.recomposeEntry(entry);
                } else {
                    entry.staleConfig = true; // swapped when count reaches 0
                }
            }
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        for (const d of this.disposables.splice(0)) {
            d.dispose();
        }
        await Promise.all([...this.entries.values()].map((entry) => this.disposeEntry(entry)));
        this.sessions.clear();
        if (instance === this) {
            instance = undefined;
        }
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    private requireEntry(kind: SqlBackendKind): BackendEntry {
        const entry = this.entries.get(kind);
        if (!entry) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.invalidRequest,
                `no backend factory registered for kind: ${kind}`,
            );
        }
        return entry;
    }

    private tryDefaultKind(): SqlBackendKind | undefined {
        return normalizeBackendKind(this.config.get<string>(SETTING_BACKEND, "sts2-local"));
    }

    /** Static statement, refined by live negotiated facts when running. */
    private effectiveSet(entry: BackendEntry): SqlCapabilitySet {
        const staticSet = entry.factory.staticCapabilities;
        const availability = entry.service?.availability;
        if (availability?.state === "available") {
            return mergeCapabilitySets(
                staticSet,
                setFromNegotiated(availability.capabilities, "handshake"),
            );
        }
        return staticSet;
    }

    private requirementsFor(params: OpenSessionParams) {
        const fromParams = params.requiredCapabilities ?? [];
        // Profile-derived hard requirements (auth kind must be openable).
        const authRequirement =
            params.profile.authKind === "integrated"
                ? ([{ id: "auth.integrated", require: "supported" }] as const)
                : params.profile.authKind === "sql"
                  ? ([{ id: "auth.sqlLogin", require: "supported" }] as const)
                  : ([{ id: "auth.entraToken", require: "supported" }] as const);
        return [...fromParams, ...authRequirement];
    }

    private alternativesFor(id: SqlCapabilityId, excluding?: SqlBackendKind): SqlBackendKind[] {
        return [...this.entries.values()]
            .filter(
                (entry) =>
                    entry.factory.kind !== excluding &&
                    entry.factory.realmClass !== "test" &&
                    entry.factory.staticCapabilities.values[id]?.support === "supported",
            )
            .map((entry) => entry.factory.kind);
    }

    private kindsSatisfying(
        requirements: readonly SqlCapabilityRequirement[],
        excluding?: SqlBackendKind,
    ): SqlBackendKind[] {
        return [...this.entries.values()]
            .filter(
                (entry) =>
                    entry.factory.kind !== excluding &&
                    entry.factory.realmClass !== "test" &&
                    evaluateRequirements(entry.factory.staticCapabilities, requirements).ok,
            )
            .map((entry) => entry.factory.kind);
    }

    private fingerprintFor(factory: SqlBackendFactory): string {
        const parts = factory.fingerprintSettings.map(
            (key) => `${key}=${JSON.stringify(this.config.get<unknown>(key, undefined))}`,
        );
        return parts.join(";");
    }

    private makeView(entry: BackendEntry): ISqlConnectionService {
        const service = entry.service;
        if (!service) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                `backend not running: ${entry.factory.kind}`,
                true,
            );
        }
        const registry = this;
        return {
            get availability() {
                return service.availability;
            },
            get onDidChangeAvailability() {
                return service.onDidChangeAvailability;
            },
            get backendInfo() {
                return service.backendInfo;
            },
            canOpen: (params) => service.canOpen(params),
            openSession: async (params) => {
                const session = await service.openSession(params);
                registry.registerSession(entry, session);
                return session;
            },
        };
    }

    private registerSession(entry: BackendEntry, session: ISqlSession): void {
        entry.activeSessionCount++;
        const record: SessionRecord = {
            kind: entry.factory.kind,
            identity: entry.factory.identity,
            finalized: false,
        };
        this.sessions.set(session.sessionId, record);
        const finalize = () => {
            if (record.finalized) {
                return;
            }
            record.finalized = true;
            this.sessions.delete(session.sessionId);
            entry.activeSessionCount = Math.max(0, entry.activeSessionCount - 1);
            if (entry.activeSessionCount === 0 && entry.staleConfig && !this.disposed) {
                void this.recomposeEntry(entry);
            }
        };
        const stateSub = session.onDidChangeState((change) => {
            if (change.current === "closed" || change.current === "lost") {
                stateSub.dispose();
                finalize();
            }
        });
        // Explicit finalization on close/dispose too — state events are the
        // normal path, but lifecycle ownership must not depend on them alone.
        const originalClose = session.close.bind(session);
        const originalDispose = session.dispose.bind(session);
        session.close = async (opts) => {
            try {
                await originalClose(opts);
            } finally {
                finalize();
            }
        };
        session.dispose = async () => {
            try {
                await originalDispose();
            } finally {
                finalize();
            }
        };
    }

    private async recomposeEntry(entry: BackendEntry): Promise<void> {
        await this.disposeEntry(entry);
        entry.state = "idle";
        entry.staleConfig = false;
        entry.configFingerprint = this.fingerprintFor(entry.factory);
        // next service() call recreates lazily
    }

    private async disposeEntry(entry: BackendEntry): Promise<void> {
        const service = entry.service;
        entry.service = undefined;
        entry.view = undefined;
        entry.startup = undefined;
        if (entry.state !== "failed") {
            entry.state = "disposed";
        }
        const disposable = service as unknown as { dispose?: () => void | Promise<void> };
        if (service && typeof disposable.dispose === "function") {
            await Promise.race([
                Promise.resolve(disposable.dispose()).catch(() => undefined),
                new Promise((resolve) => {
                    const timer = setTimeout(resolve, DISPOSE_TIMEOUT_MS);
                    // Never keep the host alive just for the dispose bound.
                    (timer as { unref?: () => void }).unref?.();
                }),
            ]);
        }
    }

    private assertNotDisposed(): void {
        if (this.disposed) {
            throw new SqlDataPlaneError(
                DataPlaneErrorCodes.unavailable,
                "SqlDataPlaneService is disposed",
                false,
            );
        }
    }
}

function toErrorInfo(error: unknown, kind: SqlBackendKind): SqlDataPlaneErrorInfo {
    if (error instanceof SqlDataPlaneError) {
        return {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            backend: { kind },
        };
    }
    return {
        code: DataPlaneErrorCodes.providerInternal,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        backend: { kind },
    };
}

export function registerSqlDataPlane(context: vscode.ExtensionContext): void {
    const service = SqlDataPlaneService.get();
    service.attachConfigWatcher();
    context.subscriptions.push({
        dispose: () => void service.dispose(),
    });
    context.subscriptions.push(
        vscode.commands.registerCommand("mssql.sqlDataPlane.showStatus", async () => {
            // PASSIVE (D5): never constructs a backend or resolves credentials.
            const summary = JSON.stringify(SqlDataPlaneService.get().statusSummary(), undefined, 2);
            const doc = await vscode.workspace.openTextDocument({
                language: "json",
                content: summary,
            });
            await vscode.window.showTextDocument(doc, { preview: true });
        }),
    );
}
