/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Schema Visualizer webview ↔ extension contract (SV-R4). Dedicated
 * interface — the legacy SchemaDesigner contract is NOT overloaded with
 * metadata-only states (addendum §19.1). Methods are named `sv/<op>` so
 * WebviewBaseController auto-spans give free per-request Debug Console
 * coverage; explicit mssql.schemaVisualizer.* product markers are emitted
 * separately (§13.3 — auto spans do not satisfy marker contracts).
 */

import { NotificationType, RequestType } from "vscode-jsonrpc";
import {
    SchemaVisualizerCatalogModel,
    VisualizerCapabilities,
} from "../schemaVisualizer/model/schemaVisualizerModel";
import { SchemaVisualizerEditOp } from "../schemaVisualizer/model/schemaVisualizerEdit";
import { SchemaDesigner } from "./schemaDesigner";

export namespace SchemaVisualizer {
    /**
     * Serializable freshness facts (§13.5 — never a synthesized single
     * warm/cold label). Defined HERE (not imported from the session) so the
     * webview program never drags the node-typed metadata stack in — only
     * pure model modules may cross this boundary.
     */
    export interface VisualizerFreshnessFacts {
        source: "memory" | "disk" | "live" | "offline" | "none";
        freshness: "live" | "validated" | "stale" | "refreshing" | "unavailable";
        validation: string;
    }

    export interface VisualizerModelResult {
        model: SchemaVisualizerCatalogModel;
        totalTables: number;
        renderedTables: number;
        /** Fingerprint over the FULL catalog — never the subset (§5.7). */
        fingerprint: string;
        fingerprintComplete: boolean;
        searchFirst: boolean;
        freshness: VisualizerFreshnessFacts;
    }

    export interface VisualizerTableSearchItem {
        objectId: number;
        schema: string;
        name: string;
        columnCount: number;
    }
    /** Initial webview state — payload rides sv/getModel, not state pushes. */
    export interface WebviewState {
        database: string;
        serverDisplayName: string;
        /** Internal measured policy value the page applies (§11.3). */
        renderThreshold: number;
        status: "initializing" | "ready" | "error";
        /** Typed outcome code when status === "error" (§15). */
        errorCode?: string;
    }

    export interface GetModelParams {
        /** Explicit table subset (search-first / neighborhood adds). */
        objectIds?: number[];
    }

    export type GetModelResult = VisualizerModelResult;

    export interface SearchTablesParams {
        query: string;
        limit?: number;
    }

    export interface SearchTablesResult {
        items: VisualizerTableSearchItem[];
    }

    export interface FkNeighborhoodParams {
        objectIds: number[];
    }

    export interface FkNeighborhoodResult {
        objectIds: number[];
    }

    /** Host → webview: catalog changed (§6.4). */
    export interface ModelChangedParams {
        fingerprintChanged: boolean;
        fingerprint: string;
        freshness: VisualizerFreshnessFacts;
    }

    /** Webview → host: first meaningful paint happened (ready semantics §11.5). */
    export interface RenderedParams {
        renderedTables: number;
        renderedEdges: number;
        totalTables: number;
        layoutMode: "auto" | "skipped" | "subset";
        subsetMode: "all" | "searchFirst" | "filtered";
    }

    export namespace GetModelRequest {
        export const type = new RequestType<GetModelParams, GetModelResult, void>("sv/getModel");
    }

    export namespace RefreshRequest {
        export const type = new RequestType<GetModelParams, GetModelResult, void>("sv/refresh");
    }

    export namespace SearchTablesRequest {
        export const type = new RequestType<SearchTablesParams, SearchTablesResult, void>(
            "sv/searchTables",
        );
    }

    export namespace FkNeighborhoodRequest {
        export const type = new RequestType<FkNeighborhoodParams, FkNeighborhoodResult, void>(
            "sv/fkNeighborhood",
        );
    }

    export namespace RenderedNotification {
        export const type = new NotificationType<RenderedParams>("sv/rendered");
    }

    export namespace ModelChangedNotification {
        export const type = new NotificationType<ModelChangedParams>("sv/modelChanged");
    }

    // -- publish handoff (SV-R8b) — serializable mirrors of the machine
    // types (the handoff module itself is node-typed and webview-unsafe).

    export interface PreviewToken {
        sessionId: string;
        editRevision: number;
        normalizedOperationsHash: string;
        catalogFingerprint: string;
        report: SchemaDesigner.GetReportResponse;
    }

    export interface PreviewChangesParams {
        operations: SchemaVisualizerEditOp[];
    }

    export type PreviewChangesResult =
        | { ok: true; token: PreviewToken }
        | { ok: false; code: string; message: string };

    export interface PublishParams {
        token: PreviewToken;
    }

    export type PublishResult =
        | { ok: true; refreshFailed?: boolean }
        | { ok: false; code: string; message: string };

    export namespace PreviewChangesRequest {
        export const type = new RequestType<PreviewChangesParams, PreviewChangesResult, void>(
            "sv/previewChanges",
        );
    }

    export namespace PublishRequest {
        export const type = new RequestType<PublishParams, PublishResult, void>("sv/publish");
    }

    export namespace CancelPreviewRequest {
        export const type = new RequestType<Record<string, never>, void, void>("sv/cancelPreview");
    }

    /** Webview → host: the local edit log changed (revision bump). */
    export namespace EditedNotification {
        export const type = new NotificationType<Record<string, never>>("sv/edited");
    }

    // Convenience re-exports for the webview side.
    export type Model = SchemaVisualizerCatalogModel;
    export type Capabilities = VisualizerCapabilities;
}
