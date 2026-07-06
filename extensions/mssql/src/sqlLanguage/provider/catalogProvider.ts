/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * CatalogLanguageMetadataProvider (design 05 §4, §6.1): the ONE sanctioned
 * adapter between the pure language engine and MetadataService. Maps the
 * immutable, generation-stamped CatalogSnapshot into IPinnedMetadataView —
 * pinning is simply holding the snapshot reference (full-replace refresh).
 * Environment facts are unified here: defaultSchema/caseSensitivity from the
 * catalog (H0), server version/capabilities from the session, database list
 * from the host seam (executionHost.listDatabases, cached by the facade).
 */

import { MetadataService } from "../../services/metadata/metadataService";
import {
    CatalogSnapshot,
    SectionState as CatalogSectionState,
} from "../../services/metadata/catalogModel";
import {
    DefinitionResult,
    IPinnedMetadataView,
    ISqlLanguageMetadataProvider,
    LangColumn,
    LangDatabase,
    LangFkEdge,
    LangObjectInfo,
    LangObjectRef,
    LangParam,
    LangResolution,
    LanguageReadiness,
    ObjectSearchQuery,
    SectionState,
    SqlLanguageEnvironment,
} from "./types";

export type MetadataCatalogHandle = ReturnType<MetadataService["acquire"]>;

/** Host accessors the Query Studio facade supplies (all synchronous). */
export interface CatalogProviderHost {
    handle(): MetadataCatalogHandle | undefined;
    serverVersion(): string | undefined;
    currentDatabase(): string | undefined;
    /** Cached database list; the facade refreshes it out of band. */
    databases(): readonly string[] | undefined;
    /** Subscribe to metadata status changes; returns unsubscribe. */
    subscribeStatus(listener: () => void): () => void;
}

function mapSection(state: CatalogSectionState | undefined): SectionState {
    switch (state) {
        case "ready":
            return "ready";
        case "loading":
            return "loading";
        case "failed":
            return "failed";
        case "stale":
            return "stale";
        case "lite":
            return "partial";
        case "absent":
        default:
            return "unknown";
    }
}

function parseVersion(version: string | undefined): { major: number; build: number } | undefined {
    if (version === undefined) {
        return undefined;
    }
    const match = /^(\d+)\.\d+\.(\d+)/.exec(version);
    if (match === null) {
        return undefined;
    }
    return { major: Number(match[1]), build: Number(match[2]) };
}

export class CatalogLanguageMetadataProvider implements ISqlLanguageMetadataProvider {
    constructor(private readonly host: CatalogProviderHost) {}

    get generation(): number {
        return this.host.handle()?.status().generation ?? 0;
    }

    env(): SqlLanguageEnvironment {
        const snapshot = this.host.handle()?.current();
        const version = parseVersion(this.host.serverVersion());
        // CREATE OR ALTER: SQL Server 2016 SP1+ programmability feature
        // (design 05 §1.2: gate by server capability, not compat level).
        const createOrAlter =
            version !== undefined &&
            (version.major >= 14 || (version.major === 13 && version.build >= 4001));
        const dropIfExists = version !== undefined && version.major >= 13;
        return {
            currentDatabase: this.host.currentDatabase(),
            defaultSchema: snapshot?.defaultSchema ?? "dbo",
            caseSensitive: snapshot?.caseSensitive ?? false,
            engineEdition: snapshot?.engineEdition,
            serverVersion: this.host.serverVersion(),
            capabilities: { createOrAlterProgrammability: createOrAlter, dropIfExists },
        };
    }

    readiness(): LanguageReadiness {
        const handle = this.host.handle();
        const snapshot = handle?.current();
        if (handle === undefined || snapshot === undefined) {
            return {
                objects: "unknown",
                columns: "unknown",
                parameters: "unknown",
                foreignKeys: "unknown",
                definitions: "unknown",
                mode: "offline",
            };
        }
        const status = handle.status();
        return {
            objects: mapSection(snapshot.readiness.objects),
            columns: mapSection(snapshot.readiness.columns),
            parameters: mapSection(snapshot.readiness.parameters),
            foreignKeys: mapSection(snapshot.readiness.foreignKeys),
            // Module definitions are not hydrated yet (B12 adds lazy reads).
            definitions: "unknown",
            mode: status.mode,
        };
    }

    pin(): IPinnedMetadataView {
        const snapshot = this.host.handle()?.current();
        if (snapshot === undefined) {
            return new OfflinePinnedView(this.env(), this.readiness());
        }
        return new SnapshotPinnedView(snapshot, this.env(), this.readiness());
    }

    databases(): readonly LangDatabase[] | undefined {
        return this.host.databases()?.map((name) => ({ name }));
    }

    onDidChange(listener: () => void): () => void {
        return this.host.subscribeStatus(listener);
    }
}

class OfflinePinnedView implements IPinnedMetadataView {
    readonly generation = 0;
    constructor(
        readonly env: SqlLanguageEnvironment,
        readonly readiness: LanguageReadiness,
    ) {}
    resolveObject(): LangResolution {
        return { kind: "unavailable", section: "objects" };
    }
    getObject(): undefined {
        return undefined;
    }
    getColumns(): undefined {
        return undefined;
    }
    getParameters(): undefined {
        return undefined;
    }
    fkFrom(): readonly [] {
        return [];
    }
    fkTo(): readonly [] {
        return [];
    }
    searchObjects(): readonly LangObjectInfo[] {
        return [];
    }
    listSchemas(): readonly [] {
        return [];
    }
}

class SnapshotPinnedView implements IPinnedMetadataView {
    readonly generation: number;
    private pkNamesByObject: Map<number, ReadonlySet<string>> | undefined;

    constructor(
        private readonly snapshot: CatalogSnapshot,
        readonly env: SqlLanguageEnvironment,
        readonly readiness: LanguageReadiness,
    ) {
        this.generation = snapshot.generation;
    }

    resolveObject(parts: readonly string[]): LangResolution {
        const resolution = this.snapshot.resolveName([...parts]);
        switch (resolution.kind) {
            case "resolved":
                return {
                    kind: "resolved",
                    ref: { objectId: resolution.objectId },
                    confidence: resolution.confidence,
                };
            case "ambiguous":
                return {
                    kind: "ambiguous",
                    candidates: resolution.candidates.map((objectId) => ({ objectId })),
                };
            case "sectionUnavailable":
                return { kind: "unavailable", section: "objects" };
            case "notFound":
            default:
                return { kind: "notFound" };
        }
    }

    getObject(ref: LangObjectRef): LangObjectInfo | undefined {
        const info = this.snapshot.getObject(ref.objectId);
        if (info === undefined) {
            return undefined;
        }
        return { ref, schema: info.schema, name: info.name, kind: info.kind };
    }

    getColumns(ref: LangObjectRef): readonly LangColumn[] | undefined {
        const columns = this.snapshot.getColumns(ref.objectId);
        if (columns === undefined) {
            return undefined;
        }
        const pk = this.primaryKeyNames(ref.objectId);
        return columns.map((c) => ({
            name: c.name,
            typeDisplay: c.typeDisplay,
            nullable: c.nullable,
            isPrimaryKey: pk.has(c.name) || undefined,
            isIdentity: c.isIdentity || undefined,
            isComputed: c.isComputed || undefined,
        }));
    }

    private primaryKeyNames(objectId: number): ReadonlySet<string> {
        if (this.pkNamesByObject === undefined) {
            this.pkNamesByObject = new Map();
        }
        let names = this.pkNamesByObject.get(objectId);
        if (names === undefined) {
            names = new Set(this.snapshot.getPrimaryKeyColumns(objectId));
            this.pkNamesByObject.set(objectId, names);
        }
        return names;
    }

    getParameters(ref: LangObjectRef): readonly LangParam[] | undefined {
        const params = this.snapshot.getParameters(ref.objectId);
        if (params === undefined) {
            return undefined;
        }
        return params.map((p) => ({
            ordinal: p.ordinal,
            name: p.name,
            typeDisplay: p.typeDisplay,
            isOutput: p.isOutput,
        }));
    }

    fkFrom(ref: LangObjectRef): readonly LangFkEdge[] {
        return this.snapshot.getForeignKeyDetailsFrom(ref.objectId).map((fk) => ({
            name: fk.name,
            from: { objectId: fk.fromObjectId },
            to: { objectId: fk.toObjectId },
            columns: fk.columns,
        }));
    }

    fkTo(ref: LangObjectRef): readonly LangFkEdge[] {
        // Reverse-direction pairs are not stored per edge today; edges only.
        return this.snapshot.getForeignKeysTo(ref.objectId).map((fk) => ({
            name: fk.name,
            from: { objectId: fk.fromObjectId },
            to: { objectId: fk.toObjectId },
            columns: [],
        }));
    }

    searchObjects(query: ObjectSearchQuery): readonly LangObjectInfo[] {
        const limit = query.limit ?? 100;
        const source =
            query.prefix !== undefined && query.prefix.length > 0
                ? this.snapshot.search(query.prefix, Math.max(limit * 2, limit))
                : this.snapshot.listObjects(
                      query.schema,
                      query.kinds ? [...query.kinds] : undefined,
                  );
        const out: LangObjectInfo[] = [];
        for (const info of source) {
            if (query.schema !== undefined && info.schema !== query.schema) {
                continue;
            }
            if (query.kinds !== undefined && !query.kinds.includes(info.kind)) {
                continue;
            }
            out.push({
                ref: { objectId: info.objectId },
                schema: info.schema,
                name: info.name,
                kind: info.kind,
            });
            if (out.length >= limit) {
                break;
            }
        }
        return out;
    }

    listSchemas(): readonly { name: string }[] {
        return this.snapshot.listSchemas().map((s) => ({ name: s.name }));
    }

    /**
     * H7 descriptions — served ONLY when the section is fully ready (a failed
     * or absent section yields undefined, never a pretend-empty claim).
     */
    getDescription(ref: LangObjectRef, column?: string): string | undefined {
        if (this.snapshot.readiness.descriptions !== "ready") {
            return undefined;
        }
        return this.snapshot.getDescription(ref.objectId, column);
    }

    getDefinition(): Promise<DefinitionResult> {
        return Promise.resolve({ unavailableReason: "notLoaded" });
    }
}
