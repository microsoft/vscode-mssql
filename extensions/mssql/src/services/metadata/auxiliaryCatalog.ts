/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Auxiliary catalog sections (OE_V1_PARITY_PLAN §2.2): the lazy, per-section
 * complement to the main hydration phases — server-scoped security/server
 * objects (B23) and later database-scoped security/broker/storage (B24).
 * Each section is ONE cheap catalog query, fetched on FIRST folder expand
 * (never at connect), single-flight, cached per generation, refreshable
 * individually. Failure is per-section and never an empty item list.
 *
 * PRIVACY: item names are object-name-classified — they render in the tree
 * but NEVER ride diagnostics; spans carry section KEYS (code constants) and
 * counts only.
 */

import { diag, diagnosticErrorClass } from "../../diagnostics/diagnosticsCore";
import { MetadataSessionSource, runMetadataQuery } from "./metadataService";

export interface AuxCatalogItem {
    readonly name: string;
    /** Schema-qualified items (sequences, user-defined types, system objects). */
    readonly schema?: string;
    /** Object kind for kind-filtered folders ("table", "view", "procedure", …). */
    readonly kind?: string;
    /** Icon/status modifier ("disabled", "fixedRole", …). */
    readonly subType?: string;
    readonly isSystem: boolean;
    readonly objectId?: number;
    /** Section-specific numeric facts (tableFacets: temporalType, historyTableId, …). */
    readonly facts?: Readonly<Record<string, number>>;
}

export interface AuxSectionSpec {
    /** Stable key — matches the hierarchy-registry folder id ("security/logins"). */
    readonly key: string;
    readonly scope: "server" | "database";
    readonly sql: string;
    readonly map: (row: unknown[]) => AuxCatalogItem | undefined;
}

export type AuxSectionReadiness = "absent" | "loading" | "ready" | "failed";

export interface AuxSectionStatus {
    readonly readiness: AuxSectionReadiness;
    readonly generation: number;
    readonly itemCount?: number;
    readonly errorMessage?: string;
}

interface SectionState {
    readiness: AuxSectionReadiness;
    generation: number;
    items: AuxCatalogItem[] | undefined;
    errorMessage: string | undefined;
    inFlight: Promise<void> | undefined;
}

/**
 * Section engine over a metadata session source. One instance per catalog
 * scope (the server engine rides ServerMetadataService; database engines
 * arrive in B24).
 */
export class AuxiliaryCatalog {
    private readonly sections = new Map<string, SectionState>();
    private readonly specs = new Map<string, AuxSectionSpec>();
    private listeners = new Set<() => void>();

    constructor(
        private readonly sessions: MetadataSessionSource,
        specs: readonly AuxSectionSpec[],
        private readonly tag: string,
    ) {
        for (const spec of specs) {
            this.specs.set(spec.key, spec);
        }
    }

    sectionKeys(): readonly string[] {
        return [...this.specs.keys()];
    }

    onDidChange(listener: () => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    private notify(): void {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            } catch {
                /* listener isolation */
            }
        }
    }

    private stateOf(key: string): SectionState {
        let state = this.sections.get(key);
        if (!state) {
            state = {
                readiness: "absent",
                generation: 0,
                items: undefined,
                errorMessage: undefined,
                inFlight: undefined,
            };
            this.sections.set(key, state);
        }
        return state;
    }

    status(key: string): AuxSectionStatus {
        const state = this.stateOf(key);
        return {
            readiness: state.readiness,
            generation: state.generation,
            ...(state.items ? { itemCount: state.items.length } : {}),
            ...(state.errorMessage ? { errorMessage: state.errorMessage } : {}),
        };
    }

    /** undefined while absent/loading/failed — NOT an empty list. */
    items(key: string): readonly AuxCatalogItem[] | undefined {
        return this.stateOf(key).items;
    }

    /** Lazy hydrate: no-op when ready; coalesces concurrent expands. */
    ensureSection(key: string): Promise<void> {
        const state = this.stateOf(key);
        if (state.readiness === "ready") {
            return Promise.resolve();
        }
        return this.refreshSection(key);
    }

    refreshSection(key: string): Promise<void> {
        const spec = this.specs.get(key);
        if (!spec) {
            return Promise.reject(new Error(`Unknown auxiliary section '${key}'.`));
        }
        const state = this.stateOf(key);
        if (state.inFlight) {
            return state.inFlight;
        }
        const run = this.hydrateSection(spec, state).finally(() => {
            state.inFlight = undefined;
        });
        state.inFlight = run;
        return run;
    }

    private async hydrateSection(spec: AuxSectionSpec, state: SectionState): Promise<void> {
        state.readiness = "loading";
        this.notify();
        const span = diag.startSpan({
            feature: "metadata",
            kind: "span",
            type: "metadataStore.auxCatalog.hydrate",
            fields: {
                scope: { raw: spec.scope, cls: "diagnostic.metadata" },
                section: { raw: spec.key, cls: "diagnostic.metadata" },
            },
        });
        try {
            const session = await this.sessions.open();
            const rows = await runMetadataQuery(session, spec.sql, `${this.tag}:${spec.key}`);
            const items: AuxCatalogItem[] = [];
            for (const row of rows) {
                const item = spec.map(row);
                if (item) {
                    items.push(item);
                }
            }
            state.readiness = "ready";
            state.generation += 1;
            state.items = items;
            state.errorMessage = undefined;
            span.end("ok", { rowCount: { raw: items.length, cls: "diagnostic.metadata" } });
        } catch (error) {
            // Failed sections drop their items: stale-as-ready is a lie.
            state.readiness = "failed";
            state.items = undefined;
            state.errorMessage = diagnosticErrorClass(error);
            span.end("error", {
                errorClass: { raw: diagnosticErrorClass(error), cls: "diagnostic.metadata" },
            });
        }
        this.notify();
    }

    /** Per-section table for showStatus — keys and counts only. */
    statusDump(): Record<string, AuxSectionStatus> {
        const dump: Record<string, AuxSectionStatus> = {};
        for (const key of this.specs.keys()) {
            dump[key] = this.status(key);
        }
        return dump;
    }

    dispose(): void {
        this.listeners.clear();
        this.sections.clear();
    }
}

// -- server sections (B23) — STS SmoTreeNodesDefinition parity ---------------

const mapNameOnly = (row: unknown[]): AuxCatalogItem | undefined =>
    row[0] === null || row[0] === undefined ? undefined : { name: String(row[0]), isSystem: false };

const flag = (value: unknown): boolean => value === true || Number(value) === 1;

export const SERVER_AUX_SECTIONS: readonly AuxSectionSpec[] = [
    {
        key: "security/logins",
        scope: "server",
        // S=sql, U=windows, G=windows group, C=certificate, K=asymmetric key;
        // ##...## internal certificate principals excluded like SSMS.
        sql:
            "SELECT p.name, p.type, p.is_disabled FROM sys.server_principals AS p " +
            "WHERE p.type IN ('S','U','G','C','K') AND p.name NOT LIKE '##%' ORDER BY p.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      ...(flag(row[2]) ? { subType: "disabled" } : {}),
                  },
    },
    {
        key: "security/serverRoles",
        scope: "server",
        sql:
            "SELECT p.name, p.is_fixed_role FROM sys.server_principals AS p " +
            "WHERE p.type = 'R' ORDER BY p.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: flag(row[1]) },
    },
    {
        key: "security/credentials",
        scope: "server",
        sql: "SELECT c.name FROM sys.credentials AS c ORDER BY c.name;",
        map: mapNameOnly,
    },
    {
        key: "security/cryptographicProviders",
        scope: "server",
        sql: "SELECT p.name FROM sys.cryptographic_providers AS p ORDER BY p.name;",
        map: mapNameOnly,
    },
    {
        key: "security/serverAudits",
        scope: "server",
        sql: "SELECT a.name, a.is_state_enabled FROM sys.server_audits AS a ORDER BY a.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      ...(flag(row[1]) ? {} : { subType: "disabled" }),
                  },
    },
    {
        key: "security/serverAuditSpecifications",
        scope: "server",
        sql:
            "SELECT s.name, s.is_state_enabled FROM sys.server_audit_specifications AS s " +
            "ORDER BY s.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      ...(flag(row[1]) ? {} : { subType: "disabled" }),
                  },
    },
    {
        key: "serverObjects/endpoints",
        scope: "server",
        // endpoint_id < 65536 = system endpoints (TSQL default, DAC, mirroring…).
        sql: "SELECT e.name, e.endpoint_id, e.state_desc FROM sys.endpoints AS e ORDER BY e.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: Number(row[1]) < 65536,
                      ...(row[2] !== null && row[2] !== undefined && String(row[2]) !== "STARTED"
                          ? { subType: "disabled" }
                          : {}),
                  },
    },
    {
        key: "serverObjects/linkedServers",
        scope: "server",
        sql: "SELECT s.name FROM sys.servers AS s WHERE s.is_linked = 1 ORDER BY s.name;",
        map: mapNameOnly,
    },
    {
        key: "serverObjects/serverTriggers",
        scope: "server",
        sql: "SELECT t.name, t.is_disabled FROM sys.server_triggers AS t ORDER BY t.name;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : {
                      name: String(row[0]),
                      isSystem: false,
                      ...(flag(row[1]) ? { subType: "disabled" } : {}),
                  },
    },
    {
        key: "serverObjects/errorMessages",
        scope: "server",
        // User-defined messages only (worksheet #4: ids, not text — message
        // TEXT is user content and stays out of the tree label).
        sql:
            "SELECT DISTINCT m.message_id FROM sys.messages AS m " +
            "WHERE m.message_id > 50000 ORDER BY m.message_id;",
        map: (row) =>
            row[0] === null || row[0] === undefined
                ? undefined
                : { name: String(row[0]), isSystem: false },
    },
];
