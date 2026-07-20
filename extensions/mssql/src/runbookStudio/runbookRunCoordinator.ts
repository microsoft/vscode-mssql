/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The controller-facing run seam. Controllers never talk to the runtime,
 * ledger, or result store directly — they hand run operations to this
 * coordinator (implemented by RunbookStudioService; RBS2-3/4). Keeping the
 * seam explicit lets the document skeleton land and be tested against fakes
 * before any runtime exists.
 */

import {
    RbsError,
    RbsEvidenceExportFormat,
    RbsPlannerProgressEvent,
    RunbookRunSnapshot,
} from "../sharedInterfaces/runbookStudio";
import type { TransformPipeline } from "../sharedInterfaces/runbookPresentation";
import type { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";

export interface OutputPageResult {
    columns?: string[];
    rows?: Array<Array<string | number | boolean | null>>;
    totalRows?: number;
    truncated?: boolean;
    error?: RbsError;
}

export interface RunbookRunCoordinator {
    /** Optional library lifecycle probe used by authoring surfaces that must
     * warn before an approved runtime asset is reverted to draft. */
    getLibraryLifecycleState?(assetId: string): Promise<string | undefined>;

    startRun(
        model: RunbookStudioDocumentModel,
        parameterValues: Record<string, string | number | boolean | null>,
    ): Promise<{ runId?: string; error?: RbsError }>;

    cancelRun(
        model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<{ outcome: "cancelled" | "alreadyTerminal" | "failed" }>;

    respondToGate(
        model: RunbookStudioDocumentModel,
        runId: string,
        nodeId: string,
        approve: boolean,
    ): Promise<{ accepted: boolean; error?: RbsError }>;

    getRun(
        model: RunbookStudioDocumentModel,
        runId: string,
    ): Promise<RunbookRunSnapshot | undefined>;

    fetchOutputPage(
        model: RunbookStudioDocumentModel,
        page: {
            handleId: string;
            startRow: number;
            rowCount: number;
            pipeline?: TransformPipeline;
        },
    ): Promise<OutputPageResult>;

    /** Save a deterministic, secret-safe projection of one run's durable
     * evidence bundle. The save picker and payload remain host-owned. */
    exportEvidence(
        model: RunbookStudioDocumentModel,
        runId: string,
        format: RbsEvidenceExportFormat,
    ): Promise<{ exported: boolean; cancelled?: boolean; error?: RbsError }>;

    /** Diagnostics trace for a run this window started (Debug Console link). */
    traceIdOf(runId: string): string | undefined;

    /** Intent -> compiled plan written into the document (WorkspaceEdit).
     *  onProgress receives typed planner console events while a slow
     *  compiler (the runtime planner) works — display-only, never
     *  persisted; reasoning deltas are already coalesced at the source. */
    compileIntent(
        model: RunbookStudioDocumentModel,
        intent: string,
        onProgress?: (event: RbsPlannerProgressEvent) => void,
    ): Promise<{ ok: boolean; error?: RbsError }>;

    /** Abort an in-flight plan generation; false when none was active. */
    cancelCompile(): boolean;

    /** Saved connections as opaque {id, label} handles (parameter sheet). */
    listConnectionProfiles(): Promise<Array<{ id: string; label: string }>>;
}
