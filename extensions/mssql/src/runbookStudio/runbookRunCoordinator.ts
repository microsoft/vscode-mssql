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

import { RbsError, RunbookRunSnapshot } from "../sharedInterfaces/runbookStudio";
import type { RunbookStudioDocumentModel } from "./runbookStudioDocumentModel";

export interface OutputPageResult {
    columns?: string[];
    rows?: Array<Array<string | number | boolean | null>>;
    totalRows?: number;
    error?: RbsError;
}

export interface RunbookRunCoordinator {
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
        page: { handleId: string; startRow: number; rowCount: number },
    ): Promise<OutputPageResult>;

    /** Diagnostics trace for a run this window started (Debug Console link). */
    traceIdOf(runId: string): string | undefined;

    /** Intent -> compiled plan written into the document (WorkspaceEdit). */
    compileIntent(
        model: RunbookStudioDocumentModel,
        intent: string,
    ): Promise<{ ok: boolean; error?: RbsError }>;

    /** Saved connections as opaque {id, label} handles (parameter sheet). */
    listConnectionProfiles(): Promise<Array<{ id: string; label: string }>>;
}
