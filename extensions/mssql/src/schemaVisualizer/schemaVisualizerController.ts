/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer webview controller (SV-R4): a THIN shell over
 * SchemaVisualizerSession — RPC plumbing, product markers, and diag spans
 * only. All read rules (leases-only, one-snapshot pins, fingerprint drift,
 * search-first threshold) live in the vscode-free session core where the
 * no-v1 tripwire suite drives them.
 *
 * Markers (registered SV-R0, contracts-first):
 * - mssql.schemaVisualizer.open.begin/.end — extension-host model
 *   preparation (the host/model phase of the legacy A/B, §14.2).
 * - mssql.schemaVisualizer.refresh.begin/.end, .driftDetected — fingerprint
 *   drift only, never bare generation bumps (§6.1).
 * Webview-phase marks (modelReady/layout/ready) are emitted by the page
 * over the standard calibrated webview-mark plane.
 */

import * as vscode from "vscode";
import { diag } from "../diagnostics/diagnosticsCore";
import { Perf } from "../perf/perfTelemetry";
import { WebviewPanelController } from "../controllers/webviewPanelController";
import { SchemaVisualizer } from "../sharedInterfaces/schemaVisualizer";
import { MetadataStore } from "../services/metadata/metadataStore";
import { PreparedConnection } from "../services/metadata/profileAuthAdapter";
import {
    SchemaVisualizerSession,
    SchemaVisualizerUnavailableError,
    VisualizerModelResult,
} from "./schemaVisualizerSession";

export interface SchemaVisualizerControllerDeps {
    store: MetadataStore;
    prepared: PreparedConnection;
    database: string;
    displayName: string;
}

/** Counts-only marker attrs (§13.4 — never identifiers). */
function modelAttrs(result: VisualizerModelResult): Record<string, string | number | boolean> {
    let columnCount = 0;
    for (const table of result.model.tables) {
        columnCount += table.columns.length;
    }
    return {
        tableCount: result.totalTables,
        columnCount,
        fkCount: result.model.foreignKeys.length,
        generation: result.model.source.generation,
        freshness: result.freshness.freshness,
        source: result.freshness.source,
        validation: result.freshness.validation,
    };
}

export class SchemaVisualizerWebviewController extends WebviewPanelController<
    SchemaVisualizer.WebviewState,
    Record<string, never>
> {
    private readonly session: SchemaVisualizerSession;
    private readonly changeSubscription: { dispose(): void };

    constructor(context: vscode.ExtensionContext, deps: SchemaVisualizerControllerDeps) {
        super(
            context,
            "schemaVisualizer",
            "schemaVisualizer",
            {
                database: deps.database,
                serverDisplayName: deps.displayName,
                renderThreshold: 500,
                status: "initializing",
            },
            {
                title: `${deps.database} (Schema Visualizer)`,
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "designSchema_light.svg",
                    ),
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "designSchema_dark.svg",
                    ),
                },
                showRestorePromptAfterClose: false,
            },
        );
        this.session = new SchemaVisualizerSession(deps.store, {
            prepared: deps.prepared,
            database: deps.database,
        });
        this.changeSubscription = this.session.onDidChange((event) => {
            if (event.fingerprintChanged) {
                Perf.marker("mssql.schemaVisualizer.driftDetected", "instant", { dirty: false });
                diag.emit({
                    feature: "schemaVisualizer",
                    kind: "event",
                    type: "schemaVisualizer.drift",
                    fields: { fingerprint: { raw: event.fingerprint, cls: "diagnostic.metadata" } },
                });
            }
            void this.sendNotification(SchemaVisualizer.ModelChangedNotification.type, {
                fingerprintChanged: event.fingerprintChanged,
                fingerprint: event.fingerprint,
                freshness: this.session.freshnessFacts(),
            });
        });
        this.registerRpcHandlers();
    }

    /**
     * Open with a bounded startup grace: right after window load the SQL
     * Data Plane (STS spawn + sts2 initialize) may still be starting and a
     * first hydration can fail transiently. Retry with backoff inside the
     * open window instead of surfacing a hard error for a race the user
     * did not cause. Bounded — a genuinely down data plane still errors.
     */
    private async getModelWithStartupGrace(
        filter: { objectIds?: number[] } | undefined,
    ): Promise<VisualizerModelResult> {
        const deadline = Date.now() + 30_000;
        let attempt = 0;
        for (;;) {
            try {
                return attempt === 0
                    ? await this.session.getModel(filter)
                    : await this.session.refresh(filter);
            } catch (error) {
                if (
                    !(error instanceof SchemaVisualizerUnavailableError) ||
                    Date.now() >= deadline
                ) {
                    throw error;
                }
                diag.emit({
                    feature: "schemaVisualizer",
                    kind: "event",
                    type: "schemaVisualizer.open.retry",
                    fields: {
                        attempt: { raw: String(attempt), cls: "diagnostic.metadata" },
                        freshness: {
                            raw: JSON.stringify(this.session.freshnessFacts()),
                            cls: "diagnostic.metadata",
                        },
                    },
                });
                await new Promise((resolve) =>
                    setTimeout(resolve, Math.min(500 * 2 ** attempt, 5_000)),
                );
                attempt++;
            }
        }
    }

    private registerRpcHandlers(): void {
        this.onRequest(SchemaVisualizer.GetModelRequest.type, async (params) => {
            Perf.marker("mssql.schemaVisualizer.open.begin", "begin");
            const span = diag.startSpan({
                feature: "schemaVisualizer",
                kind: "span",
                type: "schemaVisualizer.getModel",
            });
            try {
                const result = await this.getModelWithStartupGrace(
                    params.objectIds !== undefined ? { objectIds: params.objectIds } : undefined,
                );
                this.updateState({ ...this.state, status: "ready" });
                Perf.marker("mssql.schemaVisualizer.open.end", "end", modelAttrs(result));
                span.end("ok");
                return result;
            } catch (error) {
                const code =
                    error instanceof SchemaVisualizerUnavailableError
                        ? "metadataUnavailable"
                        : "openFailed";
                this.updateState({ ...this.state, status: "error", errorCode: code });
                Perf.marker("mssql.schemaVisualizer.open.end", "end", {
                    error: true,
                    reason: code,
                });
                span.fail(error);
                throw error;
            }
        });
        this.onRequest(SchemaVisualizer.RefreshRequest.type, async (params) => {
            Perf.marker("mssql.schemaVisualizer.refresh.begin", "begin");
            try {
                const result = await this.session.refresh(
                    params.objectIds !== undefined ? { objectIds: params.objectIds } : undefined,
                );
                Perf.marker("mssql.schemaVisualizer.refresh.end", "end", {
                    outcome: "ok",
                    fingerprintChanged: false,
                });
                return result;
            } catch (error) {
                Perf.marker("mssql.schemaVisualizer.refresh.end", "end", { outcome: "failed" });
                throw error;
            }
        });
        this.onRequest(SchemaVisualizer.SearchTablesRequest.type, async (params) => ({
            items: await this.session.searchTables(params.query, params.limit),
        }));
        this.onRequest(SchemaVisualizer.FkNeighborhoodRequest.type, async (params) => ({
            objectIds: await this.session.fkNeighborhood(params.objectIds),
        }));
    }

    public override dispose(): void {
        this.changeSubscription.dispose();
        this.session.dispose();
        super.dispose();
    }
}
