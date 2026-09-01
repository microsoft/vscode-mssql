/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    CatalogObserver,
    createMetadataNameComparison,
    type CatalogFetchContext,
    type CatalogStatsSnapshot,
    type ClrTypeMetadata,
    type ColumnMetadata,
    type DatabaseCatalogCompleteness,
    type DatabaseMetadata,
    type Disposable,
    type ForeignKeyAction,
    type ForeignKeyMetadata,
    type IndexMetadata,
    type IndexColumnMetadata,
    type MetadataCompleteness,
    type MetadataHydrationRequest,
    type MetadataLoadState,
    type MetadataNameComparison,
    type MetadataProvider,
    type MetadataRefreshResult,
    type MetadataSection,
    type MetadataSectionState,
    type MetadataView,
    type ObjectMetadata,
    type ObjectRef,
    type ObjectResolution,
    type ObjectSearchQuery,
    type ParameterMetadata,
    type PrincipalMetadata,
    type PrincipalSearchQuery,
    type SchemaMetadata,
    type SecurableMetadata,
    type SecurableSearchQuery,
    type SqlEnvironment,
    type TriggerMetadata,
} from "@vscode-mssql/tsql-language-service";
import type {
    CatalogSection,
    CatalogSnapshot,
    FkReferentialAction,
    ObjectInfo,
    ObjectKind,
    SectionState,
} from "../../services/metadata/catalogModel";
import type {
    DatabaseCatalogLease,
    ServerCatalogLease,
} from "../../services/metadata/metadataStore";
import type { MetadataStatus } from "../../services/metadata/metadataService";
import type {
    AuxCatalogItem,
    AuxSectionReadiness,
    AuxiliaryCatalog,
} from "../../services/metadata/auxiliaryCatalog";

const databaseAuxiliaryKeys = [
    "language/identity",
    "systemObjects",
    "language/systemColumns",
    "language/hiddenColumns",
    "language/systemParameters",
    "language/indexes",
    "language/triggers",
    "language/userTypes",
    "language/objectFacts",
    "language/principals",
    "language/securables",
    "language/collations",
] as const;
const serverAuxiliaryKeys = ["language/principals", "language/securables"] as const;

export interface SharedMetadataEnvironment {
    readonly database: string;
    readonly serverVersion?: string;
    readonly compatibilityLevel?: number;
    readonly serverName?: string;
    readonly engineEdition?: number;
}

export interface SharedMetadataProviderOptions {
    readonly acquireServer: () => Promise<ServerCatalogLease>;
    readonly acquireDatabase: (database: string) => Promise<DatabaseCatalogLease>;
    readonly environment: SharedMetadataEnvironment;
    readonly observer?: CatalogObserver;
}

interface DatabaseBinding {
    readonly name: string;
    readonly lease: DatabaseCatalogLease;
    readonly subscription: { dispose(): void };
    revision: string;
    suppressChanges: number;
    changeDeferred: boolean;
}

/**
 * Adapts the extension-wide MetadataStore to the host-neutral Lezer metadata contract.
 *
 * The provider owns no SQL. MetadataStore retains connection sharing, cache policy, database-key
 * correctness, and refresh scheduling. This layer only combines immutable server/database views,
 * maps their readiness honestly, and records the requests Lezer caused for its debug dashboard.
 */
export class SharedMetadataProvider implements MetadataProvider, Disposable {
    public readonly id = "shared-catalog";
    private readonly _listeners = new Set<() => void>();
    private readonly _observer: CatalogObserver;
    private readonly _databases = new Map<string, DatabaseBinding>();
    private readonly _databaseAcquisitions = new Map<string, Promise<DatabaseBinding>>();
    private readonly _databaseHandles = new Map<string, string>();
    private readonly _objectWarmups = new Set<string>();
    private readonly _hydrations = new Map<string, Promise<unknown>>();
    private readonly _pending = new Set<Promise<unknown>>();
    private readonly _initialization: Promise<void>;
    private _server: ServerCatalogLease | undefined;
    private _serverSubscription: { dispose(): void } | undefined;
    private _serverAcquisition: Promise<ServerCatalogLease> | undefined;
    private _view: MetadataView | undefined;
    private _generation = 0;
    private _disposed = false;

    public constructor(private readonly _options: SharedMetadataProviderOptions) {
        this._observer = _options.observer ?? new CatalogObserver();
        this._initialization = Promise.all([
            this.trackFetch(
                { section: "databases", priority: "background", reason: "connection opened" },
                "active connection",
                () => this.ensureServer(false),
            ),
            this.trackFetch(
                { section: "objects", priority: "background", reason: "connection opened" },
                "active connection",
                () => this.ensureDatabaseMetadata(_options.environment.database, "objects", true),
            ),
        ]).then(() => undefined);
        void this._initialization.catch(() => undefined);
    }

    public pin(): MetadataView {
        if (this._view) return this._view;
        const databases = new Map<string, SharedDatabaseSnapshot>();
        for (const binding of this._databases.values()) {
            databases.set(normalize(binding.name), {
                name: binding.name,
                snapshot: binding.lease.current(),
                status: binding.lease.status(),
                auxiliary: pinAuxiliary(binding.lease.auxiliary, databaseAuxiliaryKeys),
            });
        }
        this._view = new SharedCatalogMetadataView(
            this._generation,
            this._server
                ? {
                      catalog: this._server.pin(),
                      auxiliary: pinAuxiliary(this._server.auxiliary, serverAuxiliaryKeys),
                  }
                : undefined,
            databases,
            this._options.environment,
        );
        return this._view;
    }

    public catalogStats(): CatalogStatsSnapshot {
        return this._observer.snapshot();
    }

    public noteResidentUse(request: MetadataHydrationRequest): void {
        this._observer.recordResident(this.fetchContext(request, "resident shared snapshot"));
    }

    public requestHydration(request: MetadataHydrationRequest): void {
        if (!isSharedSection(request.section)) return;
        const view = this.pin();
        const database =
            request.database ?? request.object?.database ?? view.environment.currentDatabase;
        const state = hydrationRequestState(view, request);
        if (state === "ready" || state === "partial" || state === "stale") {
            this.noteResidentUse(request);
            return;
        }
        const section = request.section;
        const operation =
            section === "databases"
                ? () => this.ensureServer(true)
                : isSecuritySection(section)
                  ? () => this.ensureSecurityMetadata(database, section, false)
                  : database
                    ? () => this.ensureDatabaseMetadata(database, section, false)
                    : () => Promise.resolve(undefined);
        const hydrationKey = `${normalize(database ?? "server")}\u0000${
            section === "schemas" || section === "objects" ? "identity" : section
        }`;
        if (this._hydrations.has(hydrationKey)) return;
        const hydration = this.trackFetch(
            request,
            request.database ? "three-part name" : "active connection",
            operation,
        );
        this._hydrations.set(hydrationKey, hydration);
        this.schedule(
            hydration.finally(() => {
                if (this._hydrations.get(hydrationKey) === hydration) {
                    this._hydrations.delete(hydrationKey);
                }
            }),
        );
    }

    public async waitForHydration(signal?: AbortSignal): Promise<void> {
        const pending = Promise.all([this._initialization, ...this._pending]).then(() => undefined);
        return signal ? detachOnAbort(pending, signal) : pending;
    }

    public refreshSections(
        sections: readonly MetadataSection[],
        signal?: AbortSignal,
    ): Promise<MetadataRefreshResult> {
        return this.refreshCore(sections, "DDL executed in editor", signal, "ddlExecuted");
    }

    public refresh(signal?: AbortSignal): Promise<MetadataRefreshResult> {
        return this.refreshCore(
            ["databases", "schemas", "objects", "columns", "parameters", "constraints"],
            "manual refresh",
            signal,
            "manualRefresh",
        );
    }

    public onDidChange(listener: () => void): Disposable {
        this._listeners.add(listener);
        return { dispose: () => this._listeners.delete(listener) };
    }

    public dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this._serverSubscription?.dispose();
        this._server?.dispose();
        for (const binding of this._databases.values()) {
            binding.subscription.dispose();
            binding.lease.dispose();
        }
        this._databases.clear();
        this._listeners.clear();
        this._view = undefined;
    }

    private async refreshCore(
        sections: readonly MetadataSection[],
        trigger: string,
        signal: AbortSignal | undefined,
        cause: "ddlExecuted" | "manualRefresh",
    ): Promise<MetadataRefreshResult> {
        if (signal?.aborted) throw signal.reason;
        const started = performance.now();
        const before = this._generation;
        const requested = new Set(sections.filter(isSharedSection));
        const operations: Promise<unknown>[] = [];
        if (requested.has("databases")) {
            operations.push(
                this.trackFetch(
                    { section: "databases", priority: "background", reason: trigger },
                    "server catalog refresh",
                    () => this.ensureServer(true),
                ),
            );
        }
        if ([...requested].some((section) => section !== "databases")) {
            const database = this.pin().environment.currentDatabase;
            if (database) {
                operations.push(
                    this.trackFetch(
                        {
                            section: representativeSection(requested),
                            database,
                            priority: "background",
                            reason: trigger,
                        },
                        "database catalog refresh",
                        () => this.refreshDatabaseMetadata(database, requested),
                    ),
                );
            }
        }
        const work = Promise.all(operations).then(() => undefined);
        await (signal ? detachOnAbort(work, signal) : work);
        const elapsedMs = performance.now() - started;
        this._observer.recordInvalidation({
            at: Date.now(),
            cause,
            rebuildMs: elapsedMs,
            note: `Shared catalog reload: ${[...requested].join(", ")}.`,
        });
        return {
            generation: this._generation,
            published: this._generation !== before,
            elapsedMs,
        };
    }

    private async refreshDatabaseMetadata(
        database: string,
        sections: ReadonlySet<MetadataSection>,
    ): Promise<void> {
        const requested = [...sections].filter((section) => section !== "databases");
        const binding = await this.ensureDatabase(database, false);
        const operations: Promise<unknown>[] = [];
        if (
            requested.some((section) =>
                ["schemas", "objects", "columns", "parameters", "constraints"].includes(section),
            )
        ) {
            // MetadataService refreshes the core H0-H7 ladder as one operation. Calling it once
            // per logical language-service section multiplies database-switch and manual-refresh
            // latency while producing the same final snapshot.
            operations.push(binding.lease.refresh());
        }
        const auxiliaryKeys = new Set(requested.flatMap(databaseAuxiliarySections));
        await this.batchDatabaseChanges(binding, () =>
            Promise.all([
                ...operations,
                ...[...auxiliaryKeys].map((key) => binding.lease.auxiliary.refreshSection(key)),
            ]),
        );
        assertAuxiliaryReady(binding.lease.auxiliary, [...auxiliaryKeys]);

        const serverSecurity = requested.filter(isSecuritySection);
        if (serverSecurity.length > 0) {
            const server = await this.ensureServer(false);
            const keys = serverSecurity.map((section) => `language/${section}`);
            await Promise.all(keys.map((key) => server.auxiliary.refreshSection(key)));
            assertAuxiliaryReady(server.auxiliary, keys);
        }
    }

    private ensureServer(refresh: boolean): Promise<ServerCatalogLease> {
        if (this._server) {
            return refresh
                ? this._server.refresh().then(() => this._server!)
                : Promise.resolve(this._server);
        }
        if (!this._serverAcquisition) {
            this._serverAcquisition = this._options.acquireServer().then((lease) => {
                if (this._disposed) {
                    lease.dispose();
                    throw new Error("Shared metadata provider disposed during acquisition.");
                }
                this._server = lease;
                this._serverSubscription = lease.onDidChange(() => this.changed());
                this.changed();
                return lease;
            });
        }
        return this._serverAcquisition.then(async (lease) => {
            if (refresh) await lease.refresh();
            return lease;
        });
    }

    private ensureDatabase(database: string, refresh: boolean): Promise<DatabaseBinding> {
        const key = normalize(database);
        const existing = this._databases.get(key);
        if (existing) {
            return refresh
                ? existing.lease.refresh().then(() => existing)
                : Promise.resolve(existing);
        }
        let pending = this._databaseAcquisitions.get(key);
        if (!pending) {
            pending = this._options.acquireDatabase(database).then((lease) => {
                if (this._disposed) {
                    lease.dispose();
                    throw new Error("Shared metadata provider disposed during acquisition.");
                }
                let leaseSubscription: { dispose(): void } | undefined;
                const binding: DatabaseBinding = {
                    name: lease.key.database || database,
                    lease,
                    subscription: { dispose: () => leaseSubscription?.dispose() },
                    revision: databaseRevision(lease),
                    suppressChanges: 0,
                    changeDeferred: false,
                };
                leaseSubscription = lease.onDidChange(() => this.databaseChanged(binding));
                this._databases.set(key, binding);
                this.changed();
                return binding;
            });
            this._databaseAcquisitions.set(key, pending);
            void pending
                .finally(() => this._databaseAcquisitions.delete(key))
                .catch(() => undefined);
        }
        return pending.then(async (binding) => {
            if (refresh) await binding.lease.refresh();
            return binding;
        });
    }

    private async ensureDatabaseMetadata(
        database: string,
        section: MetadataSection,
        refresh: boolean,
    ): Promise<void> {
        const needsCore = ["schemas", "objects", "columns", "parameters", "constraints"].includes(
            section,
        );
        const existing = this._databases.get(normalize(database));
        const alreadyAcquired = existing !== undefined;
        if (section === "schemas" || section === "objects") {
            const binding = await this.ensureDatabase(database, false);
            const key = "language/identity";
            const identityState = binding.lease.auxiliary.status(key).readiness;
            if (identityState !== "ready") {
                await this.batchDatabaseChanges(binding, () =>
                    refresh
                        ? binding.lease.auxiliary.refreshSection(key)
                        : binding.lease.auxiliary.ensureSection(key),
                );
            }
            assertAuxiliaryReady(binding.lease.auxiliary, [key]);
            this.warmObjectDetails(binding, database);
            return;
        }
        const binding = await this.ensureDatabase(
            database,
            needsCore &&
                (refresh || !alreadyAcquired || existing?.lease.status().readiness !== "ready"),
        );
        const keys = databaseAuxiliarySections(section);
        await this.batchDatabaseChanges(binding, () =>
            Promise.all(
                keys.map((key) =>
                    refresh
                        ? binding.lease.auxiliary.refreshSection(key)
                        : binding.lease.auxiliary.ensureSection(key),
                ),
            ),
        );
        assertAuxiliaryReady(binding.lease.auxiliary, keys);
    }

    private warmObjectDetails(binding: DatabaseBinding, database: string): void {
        const databaseKey = normalize(database);
        if (this._objectWarmups.has(databaseKey)) return;
        this._objectWarmups.add(databaseKey);
        const keys = ["systemObjects", "language/userTypes", "language/objectFacts"];
        void this.trackFetch(
            {
                section: "objects",
                database,
                priority: "background",
                reason: "catalog warmup",
            },
            "richer object facts",
            () =>
                this.batchDatabaseChanges(binding, async () => {
                    await Promise.all(
                        keys.map((key) => binding.lease.auxiliary.ensureSection(key)),
                    );
                    assertAuxiliaryReady(binding.lease.auxiliary, keys);
                }),
        ).catch(() => this._objectWarmups.delete(databaseKey));
    }

    private async batchDatabaseChanges<T>(
        binding: DatabaseBinding,
        operation: () => Promise<T>,
    ): Promise<T> {
        binding.suppressChanges++;
        try {
            return await operation();
        } finally {
            binding.suppressChanges--;
            if (binding.suppressChanges === 0 && binding.changeDeferred) {
                binding.changeDeferred = false;
                this.changed();
            }
        }
    }

    private databaseChanged(binding: DatabaseBinding): void {
        const revision = databaseRevision(binding.lease);
        if (revision === binding.revision) return;
        binding.revision = revision;
        if (binding.suppressChanges > 0) {
            binding.changeDeferred = true;
            return;
        }
        this.changed();
    }

    private async ensureSecurityMetadata(
        database: string | undefined,
        section: "principals" | "securables",
        refresh: boolean,
    ): Promise<void> {
        const operations: Promise<void>[] = [];
        if (database) {
            operations.push(this.ensureDatabaseMetadata(database, section, refresh));
        }
        const server = await this.ensureServer(false);
        const key = `language/${section}`;
        operations.push(
            refresh ? server.auxiliary.refreshSection(key) : server.auxiliary.ensureSection(key),
        );
        await Promise.all(operations);
        assertAuxiliaryReady(server.auxiliary, [key]);
    }

    private trackFetch<T>(
        request: MetadataHydrationRequest,
        reason: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const span = this._observer.beginFetch(this.fetchContext(request, reason));
        return operation().then(
            (value) => {
                span.settle("loaded", { rowCount: this.rowCount(request) });
                return value;
            },
            (error: unknown) => {
                span.settle("failed", { error: { message: errorMessage(error) } });
                throw error;
            },
        );
    }

    private fetchContext(request: MetadataHydrationRequest, reason: string): CatalogFetchContext {
        const view = this.pin();
        const database =
            request.section === "databases"
                ? undefined
                : (request.database ??
                  request.object?.database ??
                  view.environment.currentDatabase);
        const object = request.object ? view.object(request.object) : undefined;
        return {
            section: request.section,
            databaseHandle: database ? this.databaseHandle(database) : "shared:server",
            ...(database ? { databaseName: database } : {}),
            ...(object ? { objectName: `${object.schema}.${object.name}` } : {}),
            trigger: request.reason ?? request.priority,
            reason,
            isCurrent: view.nameComparison.equals(database, view.environment.currentDatabase),
        };
    }

    private rowCount(request: MetadataHydrationRequest): number | undefined {
        if (request.section === "databases") return this._server?.status().databaseCount;
        const database =
            request.database ?? request.object?.database ?? this._options.environment.database;
        const stats = this._databases.get(normalize(database))?.lease.status().stats;
        switch (request.section) {
            case "schemas":
                return stats?.schemas;
            case "objects":
                return stats?.objects;
            case "columns":
                return stats?.columns;
            case "constraints":
                return stats?.foreignKeys;
            default:
                return undefined;
        }
    }

    private databaseHandle(database: string): string {
        const key = normalize(database);
        let handle = this._databaseHandles.get(key);
        if (!handle) {
            handle = `shared-db-${this._databaseHandles.size + 1}`;
            this._databaseHandles.set(key, handle);
        }
        return handle;
    }

    private schedule<T>(promise: Promise<T>): void {
        this._pending.add(promise);
        void promise.finally(() => this._pending.delete(promise)).catch(() => undefined);
    }

    private changed(incrementGeneration = true): void {
        if (this._disposed) return;
        if (incrementGeneration) this._generation++;
        this._view = undefined;
        for (const listener of [...this._listeners]) listener();
    }
}

interface SharedDatabaseSnapshot {
    readonly name: string;
    readonly snapshot?: CatalogSnapshot;
    readonly status: MetadataStatus;
    readonly auxiliary: ReadonlyMap<string, PinnedAuxiliarySection>;
}

interface PinnedAuxiliarySection {
    readonly readiness: AuxSectionReadiness;
    readonly items?: readonly AuxCatalogItem[];
}

interface SharedServerSnapshot {
    readonly catalog: ReturnType<ServerCatalogLease["pin"]>;
    readonly auxiliary: ReadonlyMap<string, PinnedAuxiliarySection>;
}

class SharedCatalogMetadataView implements MetadataView {
    public readonly providerId = "shared-catalog";
    public readonly environment: SqlEnvironment;
    public readonly completeness: MetadataCompleteness;
    public readonly publishedAt: number;
    public readonly nameComparison: MetadataNameComparison;
    private readonly _allObjects = new Map<string, readonly ObjectMetadata[]>();
    private readonly _objectsByName = new Map<
        string,
        ReadonlyMap<string, readonly ObjectMetadata[]>
    >();
    private readonly _objectsByRef = new Map<string, ReadonlyMap<string, ObjectMetadata>>();
    private readonly _objectFacts = new Map<
        string,
        ReadonlyMap<number, AuxCatalogItem["attributes"]>
    >();
    private readonly _columnStates = new Map<
        string,
        MetadataLoadState<readonly ColumnMetadata[]>
    >();

    public constructor(
        public readonly generation: number,
        private readonly _server: SharedServerSnapshot | undefined,
        private readonly _databases: ReadonlyMap<string, SharedDatabaseSnapshot>,
        environment: SharedMetadataEnvironment,
    ) {
        const current = this.database(environment.database);
        this.environment = Object.freeze({
            currentDatabase: current?.name || environment.database || undefined,
            defaultSchema: current?.snapshot?.defaultSchema ?? "dbo",
            caseSensitive: current?.snapshot?.caseSensitive ?? true,
            engineEdition: current?.snapshot?.engineEdition ?? environment.engineEdition,
            serverVersion: environment.serverVersion,
            compatibilityLevel: environment.compatibilityLevel,
            serverName: environment.serverName,
        });
        this.nameComparison = createMetadataNameComparison(this.environment.caseSensitive);
        this.completeness = completeness(current, _server);
        this.publishedAt = Math.max(
            0,
            ...[..._databases.values()].map((entry) =>
                entry.snapshot ? Date.parse(entry.snapshot.capturedAtUtc) : 0,
            ),
        );
    }

    public resolveObject(parts: readonly string[]): ObjectResolution {
        const database = this.databaseForParts(parts);
        if (!database) return unknownResolution(undefined);
        const name = parts[parts.length - 1];
        const explicitSchema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
        let candidates = [
            ...(this.objectNameIndex(database).get(this.nameComparison.key(name)) ?? []),
        ].filter(
            (object) =>
                !explicitSchema || this.nameComparison.equals(object.schema, explicitSchema),
        );
        if (!explicitSchema) {
            const inDefaultSchema = candidates.filter((object) =>
                this.nameComparison.equals(object.schema, this.environment.defaultSchema),
            );
            if (inDefaultSchema.length > 0) candidates = inDefaultSchema;
        }
        if (candidates.length === 1) return { kind: "resolved", object: candidates[0] };
        if (candidates.length > 1) return { kind: "ambiguous", candidates };
        const state = this.databaseCatalogCompleteness(database.name).objects;
        return state === "ready" || state === "partial" || state === "stale"
            ? { kind: "notFound" }
            : unknownResolution(database.status.readiness);
    }

    public object(ref: ObjectRef): ObjectMetadata | undefined {
        const database = this.database(ref.database ?? this.environment.currentDatabase);
        if (!database) return undefined;
        return this.objectRefIndex(database).get(ref.id);
    }

    public columnState(ref: ObjectRef): MetadataLoadState<readonly ColumnMetadata[]> {
        const database = this.database(ref.database ?? this.environment.currentDatabase);
        const cacheKey = `${normalize(database?.name ?? "")}\u0000${ref.id}`;
        const cached = this._columnStates.get(cacheKey);
        if (cached) return cached;
        const state = this.computeColumnState(ref, database);
        this._columnStates.set(cacheKey, state);
        return state;
    }

    private computeColumnState(
        ref: ObjectRef,
        database: SharedDatabaseSnapshot | undefined,
    ): MetadataLoadState<readonly ColumnMetadata[]> {
        const objectId = numericId(ref);
        const snapshot = database?.snapshot;
        const coreObject = objectId === undefined ? undefined : snapshot?.getObject(objectId);
        if (database && objectId !== undefined && !coreObject) {
            const value = auxiliaryItems(database, "language/systemColumns")
                .filter((column) => column.objectId === objectId)
                .map(mapAuxiliaryColumn);
            return auxiliaryLoadState(database, "language/systemColumns", value);
        }
        const value =
            objectId === undefined || !snapshot
                ? []
                : snapshot.getColumns(objectId).map((column) => {
                      const primaryKeyOrdinal = snapshot
                          .getPrimaryKeyColumns(objectId)
                          .findIndex((name) => this.nameComparison.equals(name, column.name));
                      const description = snapshot.getDescription(objectId, column.name);
                      return {
                          name: column.name,
                          typeDisplay: column.typeDisplay,
                          nullable: column.nullable,
                          identity: column.isIdentity,
                          computed: column.isComputed,
                          ...(primaryKeyOrdinal >= 0
                              ? { primaryKeyOrdinal: primaryKeyOrdinal + 1 }
                              : {}),
                          ...(description
                              ? {
                                    extendedProperties: [
                                        { name: "MS_Description", value: description },
                                    ],
                                }
                              : {}),
                      } satisfies ColumnMetadata;
                  });
        if (!database) return sectionLoadState("unknown", value);
        const hidden = auxiliaryItems(database, "language/hiddenColumns")
            .filter((column) => column.objectId === objectId)
            .map(mapAuxiliaryColumn);
        const combined = [...value, ...hidden];
        const state = combineStates([
            sectionState(database.snapshot, "columns"),
            auxiliaryState(database, "language/hiddenColumns"),
        ]);
        return sectionLoadState(state, combined);
    }

    public parameterState(ref: ObjectRef): MetadataLoadState<readonly ParameterMetadata[]> {
        const database = this.database(ref.database ?? this.environment.currentDatabase);
        const objectId = numericId(ref);
        const coreObject =
            objectId === undefined ? undefined : database?.snapshot?.getObject(objectId);
        if (database && objectId !== undefined && !coreObject) {
            const value = auxiliaryItems(database, "language/systemParameters")
                .filter((parameter) => parameter.objectId === objectId)
                .map((parameter) => ({
                    ordinal: parameter.facts?.ordinal ?? 0,
                    name: parameter.name,
                    typeDisplay: formatAuxiliaryType(parameter.attributes),
                    output: boolAttribute(parameter.attributes, "output") || undefined,
                }));
            return auxiliaryLoadState(database, "language/systemParameters", value);
        }
        const value =
            objectId === undefined || !database?.snapshot
                ? []
                : database.snapshot.getParameters(objectId).map((parameter) => ({
                      ordinal: parameter.ordinal,
                      name: parameter.name,
                      typeDisplay: parameter.typeDisplay,
                      output: parameter.isOutput,
                  }));
        return sectionLoadState(sectionState(database?.snapshot, "parameters"), value);
    }

    public indexState(_ref: ObjectRef): MetadataLoadState<readonly IndexMetadata[]> {
        const database = this.database(_ref.database ?? this.environment.currentDatabase);
        const objectId = numericId(_ref);
        if (!database || objectId === undefined) return { kind: "notLoaded" };
        const indexes = new Map<string, IndexMetadata & { columns: IndexColumnMetadata[] }>();
        for (const row of auxiliaryItems(database, "language/indexes").filter(
            (item) => item.objectId === objectId,
        )) {
            const statistics = boolAttribute(row.attributes, "statistics");
            const key = `${statistics ? "s" : "i"}:${row.facts?.indexId ?? row.name}`;
            let index = indexes.get(key);
            if (!index) {
                index = {
                    name: row.name,
                    kind: mapIndexKind(row.facts?.sqlType),
                    unique: boolAttribute(row.attributes, "unique") || undefined,
                    clustered: boolAttribute(row.attributes, "clustered") || undefined,
                    statistics: statistics || undefined,
                    columns: [],
                };
                indexes.set(key, index);
            }
            const columnName = stringAttribute(row.attributes, "columnName");
            if (columnName) {
                index.columns.push({
                    name: columnName,
                    included: boolAttribute(row.attributes, "included") || undefined,
                    descending: boolAttribute(row.attributes, "descending") || undefined,
                });
            }
        }
        return auxiliaryLoadState(database, "language/indexes", [...indexes.values()]);
    }

    public triggerState(_ref: ObjectRef): MetadataLoadState<readonly TriggerMetadata[]> {
        const database = this.database(_ref.database ?? this.environment.currentDatabase);
        const objectId = numericId(_ref);
        if (!database || objectId === undefined) return { kind: "notLoaded" };
        const value = auxiliaryItems(database, "language/triggers")
            .filter((item) => item.objectId === objectId)
            .map((item) => ({
                name: item.name,
                insteadOf: boolAttribute(item.attributes, "insteadOf") || undefined,
                disabled: boolAttribute(item.attributes, "disabled") || undefined,
                insert: boolAttribute(item.attributes, "insert") || undefined,
                update: boolAttribute(item.attributes, "update") || undefined,
                delete: boolAttribute(item.attributes, "delete") || undefined,
            }));
        return auxiliaryLoadState(database, "language/triggers", value);
    }

    public foreignKeyState(ref: ObjectRef): MetadataLoadState<readonly ForeignKeyMetadata[]> {
        const database = this.database(ref.database ?? this.environment.currentDatabase);
        const objectId = numericId(ref);
        const value =
            objectId === undefined || !database?.snapshot
                ? []
                : database.snapshot.getForeignKeyDetailsFrom(objectId).map((foreignKey) => ({
                      name: foreignKey.name,
                      referencedObject: {
                          id: String(foreignKey.toObjectId),
                          database: database.name,
                      },
                      updateAction: mapForeignKeyAction(foreignKey.onUpdate),
                      deleteAction: mapForeignKeyAction(foreignKey.onDelete),
                      columns: foreignKey.columns.map((pair) => ({
                          parentColumn: pair.fromColumn,
                          referencedColumn: pair.toColumn,
                      })),
                  }));
        return sectionLoadState(sectionState(database?.snapshot, "foreignKeys"), value);
    }

    public clrTypeState(_ref: ObjectRef): MetadataLoadState<ClrTypeMetadata> {
        const database = this.database(_ref.database ?? this.environment.currentDatabase);
        const typeId = typeObjectId(_ref);
        if (!database || typeId === undefined) return { kind: "notLoaded" };
        const type = auxiliaryItems(database, "language/userTypes").find(
            (item) => item.objectId === typeId,
        );
        const className = stringAttribute(type?.attributes, "className");
        const assemblyName = stringAttribute(type?.attributes, "assemblyName");
        const section = database.auxiliary.get("language/userTypes");
        if (section?.readiness === "loading") return { kind: "loading" };
        if (section?.readiness === "failed") return { kind: "failed" };
        if (!section || section.readiness === "absent") return { kind: "notLoaded" };
        if (!type || !className || !assemblyName) return { kind: "notLoaded" };
        // SQL Server exposes the CLR class binding but not an authoritative member list for user
        // assemblies. An empty non-system list is honest: consumers must not infer absence.
        return { kind: "loaded", value: { className, assemblyName, members: [] } };
    }

    public searchObjects(query: ObjectSearchQuery): readonly ObjectMetadata[] {
        const database = this.database(query.database ?? this.environment.currentDatabase);
        if (!database) return [];
        const limit = query.limit ?? 100;
        return this.allObjects(database)
            .filter(
                (object) =>
                    (!query.schema || this.nameComparison.equals(object.schema, query.schema)) &&
                    (!query.kinds || query.kinds.includes(object.kind)) &&
                    (!query.prefix || this.nameComparison.startsWith(object.name, query.prefix)),
            )
            .slice(0, limit)
            .map((object) => object);
    }

    public searchPrincipals(query: PrincipalSearchQuery): readonly PrincipalMetadata[] {
        const database = query.database ? this.database(query.database) : undefined;
        const source = [
            ...(database
                ? auxiliaryItems(database, "language/principals").map((item) =>
                      mapPrincipal(item, database.name),
                  )
                : []),
            ...auxiliaryItems(this._server, "language/principals").map((item) =>
                mapPrincipal(item),
            ),
        ];
        return source
            .filter((value): value is PrincipalMetadata => value !== undefined)
            .filter(
                (principal) =>
                    (!query.prefix ||
                        this.nameComparison.startsWith(principal.name, query.prefix)) &&
                    (!query.kinds || query.kinds.includes(principal.kind)),
            )
            .slice(0, query.limit ?? 100);
    }

    public searchSecurables(query: SecurableSearchQuery): readonly SecurableMetadata[] {
        const database = query.database ? this.database(query.database) : undefined;
        const source = database
            ? auxiliaryItems(database, "language/securables")
            : auxiliaryItems(this._server, "language/securables");
        return source
            .flatMap((item) => {
                if (!isSecurableKind(item.kind)) return [];
                return [
                    {
                        id: `${database?.name ?? "server"}:${item.kind}:${item.objectId ?? item.name}`,
                        name: item.name,
                        kind: item.kind,
                        ...(database ? { database: database.name } : {}),
                    } satisfies SecurableMetadata,
                ];
            })
            .filter(
                (securable) =>
                    (!query.prefix ||
                        this.nameComparison.startsWith(securable.name, query.prefix)) &&
                    (!query.kinds || query.kinds.includes(securable.kind)),
            )
            .slice(0, query.limit ?? 100);
    }

    public collations(): readonly string[] | undefined {
        const database = this.database(this.environment.currentDatabase);
        const section = database?.auxiliary.get("language/collations");
        return section?.readiness === "ready"
            ? (section.items?.map((item) => item.name) ?? [])
            : undefined;
    }

    public databaseCatalogCompleteness(database: string): DatabaseCatalogCompleteness {
        const entry = this.database(database);
        const identity = auxiliaryState(entry, "language/identity");
        return {
            schemas:
                identity === "ready"
                    ? "ready"
                    : sectionState(entry?.snapshot, "schemas", entry?.status.readiness),
            objects:
                identity === "ready"
                    ? "ready"
                    : combineStates([
                          sectionState(entry?.snapshot, "objects", entry?.status.readiness),
                          auxiliaryState(entry, "systemObjects"),
                          auxiliaryState(entry, "language/userTypes"),
                          auxiliaryState(entry, "language/objectFacts"),
                      ]),
        };
    }

    public schemas(database?: string): readonly SchemaMetadata[] | undefined {
        const entry = this.database(database ?? this.environment.currentDatabase);
        if (!entry) return undefined;
        const state = this.databaseCatalogCompleteness(entry.name).schemas;
        if (unavailable(state)) return undefined;
        const core =
            entry.snapshot?.listSchemas().map((schema) => ({
                database: entry.name,
                name: schema.name,
            })) ?? [];
        const identity = auxiliaryItems(entry, "language/identity")
            .filter((item) => stringAttribute(item.attributes, "entry") === "schema")
            .map((item) => ({ database: entry.name, name: item.name }));
        return dedupeByName([...core, ...identity], this.nameComparison);
    }

    public databases(): readonly DatabaseMetadata[] | undefined {
        return this._server?.catalog
            ?.listDatabases()
            ?.filter((database) => database.accessState !== "inaccessible")
            .map((database) => ({ name: database.name }));
    }

    private database(name: string | undefined): SharedDatabaseSnapshot | undefined {
        if (!name) return undefined;
        const direct = this._databases.get(normalize(name));
        if (direct) return direct;
        return [...this._databases.values()].find((entry) =>
            this.nameComparison.equals(entry.name, name),
        );
    }

    private databaseForParts(parts: readonly string[]): SharedDatabaseSnapshot | undefined {
        if (parts.length >= 3) {
            return this.database(parts[parts.length - 3]);
        }
        return this.database(this.environment.currentDatabase);
    }

    private mapObject(database: SharedDatabaseSnapshot, info: ObjectInfo): ObjectMetadata {
        const description = database.snapshot?.getDescription(info.objectId);
        const facts = this.objectFactIndex(database).get(info.objectId);
        return {
            ref: { id: String(info.objectId), database: database.name },
            database: database.name,
            schema: info.schema,
            name: info.name,
            kind: info.kind,
            ...(booleanAttribute(facts, "schemaBound") !== undefined
                ? { schemaBound: booleanAttribute(facts, "schemaBound") }
                : {}),
            ...(booleanAttribute(facts, "checkOption") !== undefined
                ? { checkOption: booleanAttribute(facts, "checkOption") }
                : {}),
            ...(booleanAttribute(facts, "extendedProcedure") !== undefined
                ? { extendedProcedure: booleanAttribute(facts, "extendedProcedure") }
                : {}),
            ...(stringAttribute(facts, "returnType")
                ? { returnType: stringAttribute(facts, "returnType") }
                : {}),
            ...(description
                ? { extendedProperties: [{ name: "MS_Description", value: description }] }
                : {}),
        };
    }

    private allObjects(database: SharedDatabaseSnapshot): readonly ObjectMetadata[] {
        const key = normalize(database.name);
        const cached = this._allObjects.get(key);
        if (cached) return cached;
        const core =
            database.snapshot?.listObjects().map((object) => this.mapObject(database, object)) ??
            [];
        const objects = [...core, ...this.auxiliaryObjects(database)];
        const result = [...new Map(objects.map((object) => [object.ref.id, object])).values()];
        this._allObjects.set(key, result);
        return result;
    }

    private objectNameIndex(
        database: SharedDatabaseSnapshot,
    ): ReadonlyMap<string, readonly ObjectMetadata[]> {
        const databaseKey = normalize(database.name);
        const cached = this._objectsByName.get(databaseKey);
        if (cached) return cached;
        const index = new Map<string, ObjectMetadata[]>();
        for (const object of this.allObjects(database)) {
            const nameKey = this.nameComparison.key(object.name);
            const matches = index.get(nameKey) ?? [];
            matches.push(object);
            index.set(nameKey, matches);
        }
        this._objectsByName.set(databaseKey, index);
        return index;
    }

    private objectRefIndex(database: SharedDatabaseSnapshot): ReadonlyMap<string, ObjectMetadata> {
        const databaseKey = normalize(database.name);
        const cached = this._objectsByRef.get(databaseKey);
        if (cached) return cached;
        const index = new Map(this.allObjects(database).map((object) => [object.ref.id, object]));
        this._objectsByRef.set(databaseKey, index);
        return index;
    }

    private objectFactIndex(
        database: SharedDatabaseSnapshot,
    ): ReadonlyMap<number, AuxCatalogItem["attributes"]> {
        const databaseKey = normalize(database.name);
        const cached = this._objectFacts.get(databaseKey);
        if (cached) return cached;
        const index = new Map<number, AuxCatalogItem["attributes"]>();
        for (const item of auxiliaryItems(database, "language/objectFacts")) {
            if (item.objectId !== undefined) index.set(item.objectId, item.attributes);
        }
        this._objectFacts.set(databaseKey, index);
        return index;
    }

    private auxiliaryObjects(database: SharedDatabaseSnapshot): readonly ObjectMetadata[] {
        const system = auxiliaryItems(database, "systemObjects").flatMap((item) => {
            if (!item.objectId || !item.schema || !isObjectKind(item.kind)) return [];
            return [
                {
                    ref: { id: String(item.objectId), database: database.name },
                    database: database.name,
                    schema: item.schema,
                    name: item.name,
                    kind: item.kind,
                    system: true,
                    ...(booleanAttribute(item.attributes, "schemaBound") !== undefined
                        ? { schemaBound: booleanAttribute(item.attributes, "schemaBound") }
                        : {}),
                    ...(booleanAttribute(item.attributes, "checkOption") !== undefined
                        ? { checkOption: booleanAttribute(item.attributes, "checkOption") }
                        : {}),
                    ...(booleanAttribute(item.attributes, "extendedProcedure") !== undefined
                        ? {
                              extendedProcedure: booleanAttribute(
                                  item.attributes,
                                  "extendedProcedure",
                              ),
                          }
                        : {}),
                    ...(stringAttribute(item.attributes, "returnType")
                        ? { returnType: stringAttribute(item.attributes, "returnType") }
                        : {}),
                } satisfies ObjectMetadata,
            ];
        });
        const types = auxiliaryItems(database, "language/userTypes").flatMap((item) => {
            const category = stringAttribute(item.attributes, "typeCategory");
            if (!item.objectId || !item.schema || !isTypeCategory(category)) return [];
            return [
                {
                    ref: { id: `type:${item.objectId}`, database: database.name },
                    database: database.name,
                    schema: item.schema,
                    name: item.name,
                    kind: "type",
                    typeCategory: category,
                } satisfies ObjectMetadata,
            ];
        });
        const identity: ObjectMetadata[] = [];
        for (const item of auxiliaryItems(database, "language/identity")) {
            const entry = stringAttribute(item.attributes, "entry");
            if (entry === "schema" || !item.objectId || !item.schema) continue;
            if (entry === "type") {
                const category = stringAttribute(item.attributes, "typeCategory");
                if (isTypeCategory(category)) {
                    identity.push({
                        ref: { id: `type:${item.objectId}`, database: database.name },
                        database: database.name,
                        schema: item.schema,
                        name: item.name,
                        kind: "type",
                        typeCategory: category,
                    });
                }
                continue;
            }
            if (isObjectKind(item.kind)) {
                identity.push({
                    ref: { id: String(item.objectId), database: database.name },
                    database: database.name,
                    schema: item.schema,
                    name: item.name,
                    kind: item.kind,
                    system: item.isSystem || undefined,
                });
            }
        }
        return [...system, ...types, ...identity];
    }
}

function completeness(
    database: SharedDatabaseSnapshot | undefined,
    server: SharedServerSnapshot | undefined,
): MetadataCompleteness {
    const snapshot = database?.snapshot;
    const status = database?.status;
    return Object.freeze({
        databases: mapOverallState(server?.catalog.readiness),
        schemas: sectionState(snapshot, "schemas", status?.readiness),
        objects: combineStates([
            sectionState(snapshot, "objects", status?.readiness),
            auxiliaryState(database, "systemObjects"),
            auxiliaryState(database, "language/userTypes"),
            auxiliaryState(database, "language/objectFacts"),
        ]),
        columns: combineStates([
            sectionState(snapshot, "columns", status?.readiness),
            auxiliaryState(database, "language/hiddenColumns"),
        ]),
        parameters: sectionState(snapshot, "parameters", status?.readiness),
        indexes: auxiliaryState(database, "language/indexes"),
        triggers: auxiliaryState(database, "language/triggers"),
        constraints: sectionState(snapshot, "foreignKeys", status?.readiness),
        clrTypes: auxiliaryState(database, "language/userTypes"),
        securables: combineStates([
            auxiliaryState(database, "language/securables"),
            auxiliaryState(server, "language/securables"),
        ]),
        collations: auxiliaryState(database, "language/collations"),
        principals: combineStates([
            auxiliaryState(database, "language/principals"),
            auxiliaryState(server, "language/principals"),
        ]),
        definitions: "unknown",
    });
}

function sectionState(
    snapshot: CatalogSnapshot | undefined,
    section: CatalogSection,
    overall?: MetadataStatus["readiness"],
): MetadataSectionState {
    if (snapshot) return mapSectionState(snapshot.readiness[section]);
    return mapOverallState(overall);
}

function mapSectionState(state: SectionState | undefined): MetadataSectionState {
    switch (state) {
        case "ready":
        case "loading":
        case "failed":
        case "stale":
            return state;
        case "lite":
            return "partial";
        case "absent":
        default:
            return "unknown";
    }
}

function mapOverallState(
    state: "absent" | "loading" | "ready" | "failed" | "stale" | undefined,
): MetadataSectionState {
    switch (state) {
        case "loading":
        case "ready":
        case "failed":
        case "stale":
            return state;
        case "absent":
        default:
            return "unknown";
    }
}

function sectionLoadState<T>(
    state: MetadataSectionState,
    value: readonly T[],
): MetadataLoadState<readonly T[]> {
    if (state === "ready" || state === "partial" || state === "stale") {
        return { kind: "loaded", value };
    }
    if (state === "loading") return { kind: "loading" };
    if (state === "failed") return { kind: "failed" };
    return { kind: "notLoaded" };
}

function unknownResolution(state: MetadataStatus["readiness"] | undefined): ObjectResolution {
    return {
        kind: "unknown",
        reason:
            state === "stale"
                ? "metadataStale"
                : state === "loading" || state === "absent" || state === undefined
                  ? "metadataPending"
                  : "metadataUnavailable",
    };
}

function numericId(ref: ObjectRef): number | undefined {
    const value = Number(ref.id);
    return Number.isSafeInteger(value) ? value : undefined;
}

function unavailable(state: MetadataSectionState): boolean {
    return state === "unknown" || state === "failed";
}

function mapForeignKeyAction(
    action: FkReferentialAction | undefined,
): ForeignKeyAction | undefined {
    switch (action) {
        case "NO_ACTION":
            return "noAction";
        case "CASCADE":
            return "cascade";
        case "SET_NULL":
            return "setNull";
        case "SET_DEFAULT":
            return "setDefault";
        case undefined:
            return undefined;
    }
}

function isSharedSection(section: MetadataSection): boolean {
    return section !== "definitions";
}

function isSecuritySection(section: MetadataSection): section is "principals" | "securables" {
    return section === "principals" || section === "securables";
}

function representativeSection(sections: ReadonlySet<MetadataSection>): MetadataSection {
    for (const section of ["objects", "columns", "parameters", "constraints", "schemas"] as const) {
        if (sections.has(section)) return section;
    }
    return "objects";
}

function normalize(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Only completed catalog publications affect language semantics. MetadataService publishes
 * intermediate H0-H7 progress and AuxiliaryCatalog publishes a loading transition; rebinding for
 * those states creates churn without exposing any additional usable metadata.
 */
function databaseRevision(lease: DatabaseCatalogLease): string {
    const core = lease.status();
    const coreRevision =
        core.readiness === "ready" || core.readiness === "stale" || core.readiness === "failed"
            ? `${core.readiness}:${core.generation}`
            : "pending";
    const auxiliaryRevisions = databaseAuxiliaryKeys.map((key) => {
        const section = lease.auxiliary.status(key);
        return section.readiness === "ready" || section.readiness === "failed"
            ? `${key}:${section.readiness}:${section.generation}`
            : `${key}:pending`;
    });
    return [coreRevision, ...auxiliaryRevisions].join("|");
}

function databaseAuxiliarySections(section: MetadataSection): readonly string[] {
    switch (section) {
        case "schemas":
            return ["language/identity"];
        case "objects":
            return [
                "language/identity",
                "systemObjects",
                "language/userTypes",
                "language/objectFacts",
            ];
        case "columns":
            return ["language/systemColumns", "language/hiddenColumns"];
        case "parameters":
            return ["language/systemParameters"];
        case "indexes":
            return ["language/indexes"];
        case "triggers":
            return ["language/triggers"];
        case "clrTypes":
            return ["language/userTypes"];
        case "principals":
            return ["language/principals"];
        case "securables":
            return ["language/securables"];
        case "collations":
            return ["language/collations"];
        default:
            return [];
    }
}

function hydrationRequestState(
    view: MetadataView,
    request: MetadataHydrationRequest,
): MetadataSectionState {
    const database = request.database ?? request.object?.database;
    if ((request.section === "schemas" || request.section === "objects") && database) {
        return view.databaseCatalogCompleteness(database)[request.section];
    }
    if (request.object) {
        switch (request.section) {
            case "columns":
                return loadState(view.columnState(request.object));
            case "parameters":
                return loadState(view.parameterState(request.object));
            case "indexes":
                return loadState(view.indexState(request.object));
            case "triggers":
                return loadState(view.triggerState(request.object));
            case "constraints":
                return loadState(view.foreignKeyState(request.object));
            case "clrTypes":
                return loadState(view.clrTypeState(request.object));
        }
    }
    return view.completeness[request.section];
}

function loadState(state: MetadataLoadState<unknown>): MetadataSectionState {
    switch (state.kind) {
        case "loaded":
            return "ready";
        case "loading":
            return "loading";
        case "failed":
            return "failed";
        case "notLoaded":
            return "unknown";
    }
}

function assertAuxiliaryReady(catalog: AuxiliaryCatalog, keys: readonly string[]): void {
    const failed = keys.find((key) => catalog.status(key).readiness === "failed");
    if (failed) throw new Error(`Shared metadata section '${failed}' failed to load.`);
}

function pinAuxiliary(
    catalog: AuxiliaryCatalog,
    keys: readonly string[],
): ReadonlyMap<string, PinnedAuxiliarySection> {
    return new Map(
        keys.map((key) => {
            const status = catalog.status(key);
            const items = catalog.items(key);
            return [
                key,
                Object.freeze({
                    readiness: status.readiness,
                    ...(items ? { items: Object.freeze([...items]) } : {}),
                }),
            ];
        }),
    );
}

function auxiliaryItems(
    source: { readonly auxiliary: ReadonlyMap<string, PinnedAuxiliarySection> } | undefined,
    key: string,
): readonly AuxCatalogItem[] {
    return source?.auxiliary.get(key)?.items ?? [];
}

function auxiliaryState(
    source: { readonly auxiliary: ReadonlyMap<string, PinnedAuxiliarySection> } | undefined,
    key: string,
): MetadataSectionState {
    switch (source?.auxiliary.get(key)?.readiness) {
        case "ready":
            return "ready";
        case "loading":
            return "loading";
        case "failed":
            return "failed";
        case "absent":
        case undefined:
            return "unknown";
    }
}

function auxiliaryLoadState<T>(
    database: SharedDatabaseSnapshot,
    key: string,
    value: readonly T[],
): MetadataLoadState<readonly T[]> {
    switch (database.auxiliary.get(key)?.readiness) {
        case "ready":
            return { kind: "loaded", value };
        case "loading":
            return { kind: "loading" };
        case "failed":
            return { kind: "failed" };
        case "absent":
        case undefined:
            return { kind: "notLoaded" };
    }
}

function combineStates(states: readonly MetadataSectionState[]): MetadataSectionState {
    if (states.some((state) => state === "failed")) return "failed";
    if (states.some((state) => state === "loading")) return "loading";
    if (states.some((state) => state === "unknown")) return "unknown";
    if (states.some((state) => state === "stale")) return "stale";
    if (states.some((state) => state === "partial")) return "partial";
    return "ready";
}

function stringAttribute(
    attributes: AuxCatalogItem["attributes"] | undefined,
    key: string,
): string | undefined {
    const value = attributes?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function boolAttribute(attributes: AuxCatalogItem["attributes"] | undefined, key: string): boolean {
    return attributes?.[key] === true || attributes?.[key] === 1;
}

function booleanAttribute(
    attributes: AuxCatalogItem["attributes"] | undefined,
    key: string,
): boolean | undefined {
    const value = attributes?.[key];
    return typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : undefined;
}

function formatAuxiliaryType(attributes: AuxCatalogItem["attributes"] | undefined): string {
    const name = stringAttribute(attributes, "typeName") ?? "unknown";
    const maxLength = Number(attributes?.maxLength);
    const precision = Number(attributes?.precision);
    const scale = Number(attributes?.scale);
    if (["varchar", "char", "varbinary", "binary"].includes(name)) {
        return `${name}(${maxLength === -1 ? "max" : maxLength})`;
    }
    if (["nvarchar", "nchar"].includes(name)) {
        return `${name}(${maxLength === -1 ? "max" : maxLength / 2})`;
    }
    if (["decimal", "numeric"].includes(name)) return `${name}(${precision},${scale})`;
    return name;
}

function mapAuxiliaryColumn(column: AuxCatalogItem): ColumnMetadata {
    return {
        name: column.name,
        typeDisplay: formatAuxiliaryType(column.attributes),
        nullable: booleanAttribute(column.attributes, "nullable"),
        identity: boolAttribute(column.attributes, "identity") || undefined,
        computed: boolAttribute(column.attributes, "computed") || undefined,
        hidden: boolAttribute(column.attributes, "hidden") || undefined,
    };
}

function mapIndexKind(value: number | undefined): "relational" | "xml" | "spatial" {
    if (value === 3) return "xml";
    if (value === 4) return "spatial";
    return "relational";
}

function isObjectKind(value: string | undefined): value is ObjectKind {
    return ["table", "view", "procedure", "scalarFunction", "tableFunction", "synonym"].includes(
        value ?? "",
    );
}

function isTypeCategory(value: string | undefined): value is "alias" | "clr" | "table" {
    return value === "alias" || value === "clr" || value === "table";
}

function typeObjectId(ref: ObjectRef): number | undefined {
    const match = /^type:(\d+)$/u.exec(ref.id);
    return match ? Number(match[1]) : undefined;
}

function mapPrincipal(item: AuxCatalogItem, database?: string): PrincipalMetadata | undefined {
    const code = item.kind?.trim();
    const kind = database
        ? code === "R"
            ? "databaseRole"
            : code === "A"
              ? "applicationRole"
              : "user"
        : code === "R"
          ? "serverRole"
          : "login";
    return {
        id: `${database ?? "server"}:${item.objectId ?? item.name}`,
        ...(database ? { database } : {}),
        name: item.name,
        kind,
        system: item.isSystem || undefined,
    };
}

function isSecurableKind(value: string | undefined): value is SecurableMetadata["kind"] {
    return value === "credential" || value === "certificate" || value === "asymmetricKey";
}

function dedupeByName<T extends { readonly name: string }>(
    values: readonly T[],
    comparison: MetadataNameComparison,
): readonly T[] {
    const result = new Map<string, T>();
    for (const value of values) result.set(comparison.key(value.name), value);
    return [...result.values()];
}

function detachOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise<T>((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
