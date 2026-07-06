/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Inline-completion schema-context SERVICE, rebased onto the MetadataService
 * catalog (replaces the completions branch's query/simpleexecute fetch):
 *
 *   document → resolver → catalog snapshot → RawSchemaContextPayload →
 *   normalize (per generation+budget, cached) → relevance selection (per call)
 *
 * Resolvers, in order:
 *   1. Query Studio documents — reuse the DocumentSessionBinding's metadata
 *      handle (already hydrated over its dedicated background session).
 *   2. Classic .sql documents — map the document's classic connection to a
 *      data-plane metadata acquisition (gated on mssql.sqlDataPlane.enabled;
 *      passwords resolved through the connection store at open time only).
 *
 * Deviation from the original service: there is no fetch-wait — a catalog
 * still hydrating yields no schema context for that request (the provider
 * already reports fallbackWithoutMetadata honestly) and later requests pick
 * up the hydrated catalog. The classic resolver goes through the SHARED
 * MetadataStore (CACHE-4, addendum §7.6): a persistent-cache hit answers a
 * cold restart instantly with a background refresh; otherwise
 * ensureFresh(aiContext) joins the first hydration, still bounded by the
 * prior 120s ceiling.
 */

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { logger2 } from "../models/logger2";
import { CatalogSnapshot } from "../services/metadata/catalogModel";
import { MetadataPolicies } from "../services/metadata/cache/metadataFreshness";
import { DatabaseCatalogLease } from "../services/metadata/metadataStore";
import { MetadataStoreService } from "../services/metadata/metadataStoreService";
import {
    prepareConnection,
    StoredConnectionProfile,
} from "../services/metadata/profileAuthAdapter";
import { SqlDataPlaneService } from "../services/sqlDataPlane/sqlDataPlaneService";
import { InlineCompletionDebugSchemaContextOverrides } from "../sharedInterfaces/inlineCompletionDebug";
import { findQueryStudioModel } from "../queryStudio/queryStudioEditorProvider";
import {
    buildRawSchemaContextPayload,
    CatalogPayloadConnectionFacts,
} from "./catalogSchemaContextPayload";
import {
    buildSchemaContextFromRawPayload,
    extractSchemaContextRelevanceTerms,
    getSqlInlineCompletionSchemaContextRuntimeSettings,
    selectSchemaContextForPrompt,
    SqlInlineCompletionSchemaContext,
} from "./completionSchemaContextCore";

const maxNormalizedCacheEntries = 32;
const firstHydrationWaitMs = 120_000;
const maxClassicAcquisitions = 8;

export interface CompletionCatalogAccess {
    snapshot: CatalogSnapshot;
    generation: number;
    facts: CatalogPayloadConnectionFacts;
    /** Stable identity for the normalized-context cache. */
    fingerprint: string;
}

export interface CompletionMetadataResolver {
    resolve(document: vscode.TextDocument): Promise<CompletionCatalogAccess | undefined>;
    dispose?(): void;
}

/** Resolver 1: Query Studio documents via their session binding's handle. */
export class QueryStudioCompletionMetadataResolver implements CompletionMetadataResolver {
    async resolve(document: vscode.TextDocument): Promise<CompletionCatalogAccess | undefined> {
        const model = findQueryStudioModel(document.uri);
        const binding = model?.sessionBinding;
        const handle = binding?.metadataHandleForConsumers;
        const snapshot = handle?.current();
        if (!binding || !handle || !snapshot) {
            return undefined;
        }
        const state = binding.connectionState;
        return {
            snapshot,
            generation: snapshot.generation,
            facts: {
                server: state.serverDisplayName,
                database: state.database,
            },
            fingerprint: `qs|${state.serverDisplayName ?? "?"}|${state.database ?? "?"}|${state.loginName ?? "?"}`,
        };
    }
}

/** Narrow classic-connection seams (stubbed in tests). */
export interface ClassicConnectionFacts {
    server?: string;
    database?: string;
    user?: string;
    authenticationType?: string;
    encrypt?: string | boolean;
    trustServerCertificate?: boolean;
}

export interface ClassicConnectionSource {
    getConnectionFacts(ownerUri: string): ClassicConnectionFacts | undefined;
    lookupPassword(facts: ClassicConnectionFacts): Promise<string | undefined>;
}

interface ClassicAcquisition {
    lease: DatabaseCatalogLease;
}

/** Resolver 2: classic editor documents via the SHARED MetadataStore. */
export class ClassicCompletionMetadataResolver implements CompletionMetadataResolver {
    private readonly logger = logger2.withPrefix("SqlInlineSchemaContext");
    private readonly acquisitions = new Map<string, ClassicAcquisition>();

    constructor(private readonly connections: ClassicConnectionSource) {}

    async resolve(document: vscode.TextDocument): Promise<CompletionCatalogAccess | undefined> {
        const dataPlane = SqlDataPlaneService.get();
        if (!dataPlane.enabled) {
            return undefined;
        }
        const facts = this.connections.getConnectionFacts(document.uri.toString());
        if (!facts?.server) {
            return undefined;
        }
        const authKind = (facts.authenticationType ?? "").toLowerCase().includes("integrated")
            ? ("integrated" as const)
            : ("sql" as const);
        // In-memory LRU key only — the store derives the non-reversible
        // fingerprints from the same facts via prepareConnection.
        const fingerprint = `classic|${facts.server}|${facts.database ?? ""}|${facts.user ?? ""}|${authKind}`;

        let acquisition = this.acquisitions.get(fingerprint);
        if (!acquisition) {
            acquisition = await this.acquire(fingerprint, facts, authKind);
            if (!acquisition) {
                return undefined;
            }
        } else {
            // LRU touch
            this.acquisitions.delete(fingerprint);
            this.acquisitions.set(fingerprint, acquisition);
        }

        // §7.6: a disk-cache hit answers instantly (stale + background
        // refresh); a cold catalog joins hydration bounded by the prior
        // 120s ceiling. Freshness rides result metadata — prompt bytes
        // stay generation-pinned via the snapshot itself.
        const result = await acquisition.lease.ensureFresh({
            ...MetadataPolicies.aiContext,
            timeoutMs: firstHydrationWaitMs,
        });
        const snapshot = result.snapshot;
        if (!snapshot) {
            return undefined;
        }
        return {
            snapshot,
            generation: snapshot.generation,
            facts: { server: facts.server, database: facts.database },
            fingerprint,
        };
    }

    private async acquire(
        fingerprint: string,
        facts: ClassicConnectionFacts,
        authKind: "sql" | "integrated",
    ): Promise<ClassicAcquisition | undefined> {
        try {
            const stored: StoredConnectionProfile = {
                server: facts.server!,
                ...(facts.database ? { database: facts.database } : {}),
                ...(facts.user ? { user: facts.user } : {}),
                authenticationType:
                    facts.authenticationType ??
                    (authKind === "integrated" ? "Integrated" : "SqlLogin"),
                ...(facts.encrypt !== undefined ? { encrypt: facts.encrypt } : {}),
                ...(facts.trustServerCertificate !== undefined
                    ? { trustServerCertificate: facts.trustServerCertificate }
                    : {}),
            };
            const prepared = prepareConnection(stored, {
                // Password exists only inside this provider call chain.
                lookupPassword: async () => (await this.connections.lookupPassword(facts)) ?? "",
            });
            const lease = await MetadataStoreService.get()
                .store()
                .acquireDatabase(prepared, facts.database ?? "");
            const acquisition: ClassicAcquisition = { lease };
            this.acquisitions.set(fingerprint, acquisition);
            while (this.acquisitions.size > maxClassicAcquisitions) {
                const oldestKey = this.acquisitions.keys().next().value;
                if (oldestKey === undefined) {
                    break;
                }
                this.acquisitions.get(oldestKey)!.lease.dispose();
                this.acquisitions.delete(oldestKey);
            }
            return acquisition;
        } catch (error) {
            this.logger.debug(
                `Classic metadata acquisition failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            return undefined;
        }
    }

    dispose(): void {
        for (const acquisition of this.acquisitions.values()) {
            acquisition.lease.dispose();
        }
        this.acquisitions.clear();
    }
}

export class CompletionSchemaContextService implements vscode.Disposable {
    private readonly logger = logger2.withPrefix("SqlInlineSchemaContext");
    private readonly disposables: vscode.Disposable[] = [];
    /** fingerprint|generation|fetchCacheKey → normalized full context. */
    private readonly normalized = new Map<string, SqlInlineCompletionSchemaContext | undefined>();

    constructor(private readonly resolvers: CompletionMetadataResolver[]) {
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    event.affectsConfiguration(
                        Constants.configCopilotInlineCompletionsSchemaContext,
                    )
                ) {
                    this.clearCache();
                }
            }),
        );
        try {
            this.disposables.push(
                vscode.commands.registerCommand(
                    Constants.cmdCopilotInlineCompletionRefreshSchemaContext,
                    () => {
                        this.clearCache();
                    },
                ),
            );
        } catch {
            // The refresh command belongs to the activated extension's
            // instance; secondary instances (tests) skip registration.
        }
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        for (const resolver of this.resolvers) {
            resolver.dispose?.();
        }
        this.normalized.clear();
    }

    public clearCache(): void {
        this.normalized.clear();
    }

    public async getSchemaContext(
        document: vscode.TextDocument,
        relevanceText?: string,
        modelMaxInputTokens?: number,
        debugSchemaContextOverrides?: InlineCompletionDebugSchemaContextOverrides | null,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        let access: CompletionCatalogAccess | undefined;
        for (const resolver of this.resolvers) {
            access = await resolver.resolve(document);
            if (access) {
                break;
            }
        }
        if (!access) {
            return undefined;
        }

        const settings = getSqlInlineCompletionSchemaContextRuntimeSettings(
            modelMaxInputTokens,
            debugSchemaContextOverrides,
        );
        const relevanceTerms = extractSchemaContextRelevanceTerms(
            relevanceText ?? document.getText(),
            settings.budget,
        );

        const cacheKey = `${access.fingerprint}|${access.generation}|${settings.fetchCacheKey}`;
        let fullContext = this.normalized.get(cacheKey);
        if (fullContext === undefined && !this.normalized.has(cacheKey)) {
            const payload = buildRawSchemaContextPayload(
                access.snapshot,
                settings.budget,
                access.facts,
            );
            fullContext = buildSchemaContextFromRawPayload(payload, settings.budget);
            this.normalized.set(cacheKey, fullContext);
            while (this.normalized.size > maxNormalizedCacheEntries) {
                const oldestKey = this.normalized.keys().next().value;
                if (oldestKey === undefined) {
                    break;
                }
                this.normalized.delete(oldestKey);
            }
            this.logger.debug(
                `Normalized schema context from catalog generation ${access.generation} ` +
                    `(tables ${fullContext?.tables.length ?? 0}, views ${fullContext?.views.length ?? 0}, ` +
                    `routines ${fullContext?.routines?.length ?? 0})`,
            );
        }

        return selectSchemaContextForPrompt(fullContext, relevanceTerms, settings);
    }

    /** Replay path: resolve by owner uri via the open-documents table. */
    public async getSchemaContextForOwnerUri(
        ownerUri: string,
        relevanceText?: string,
        modelMaxInputTokens?: number,
        debugSchemaContextOverrides?: InlineCompletionDebugSchemaContextOverrides | null,
    ): Promise<SqlInlineCompletionSchemaContext | undefined> {
        const document = vscode.workspace.textDocuments.find(
            (candidate) => candidate.uri.toString() === ownerUri,
        );
        if (!document) {
            return undefined;
        }
        return this.getSchemaContext(
            document,
            relevanceText,
            modelMaxInputTokens,
            debugSchemaContextOverrides,
        );
    }
}
