/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pinned query results tab (C2D-3, plan §10): a read-only WebviewPanel over
 * a retained snapshot. Originally a custom editor over a virtual
 * file-system scheme — converted to a plain WebviewPanel (dogfood
 * 2026-07-10) because VS Code renders a breadcrumbs row for file-like
 * custom-editor resources, and for a single-segment virtual file that row
 * just repeats the tab title. A WebviewPanel has no breadcrumbs, and the
 * custom-document machinery bought nothing here: pinned data is memory-only
 * and never survives a window reload (tabs now close on reload instead of
 * restoring as expired husks).
 *
 * Lifecycle: opening acquires the snapshot lease; panel dispose releases it
 * (a pinned-purpose snapshot then disposes, releasing the retained store).
 * A missing/expired snapshot opens an "expired" page — clear message, no
 * row access, never a throw.
 */

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import {
    PINNED_RESULTS_SCHEME,
    PINNED_RESULTS_VIEW_TYPE,
} from "../sharedInterfaces/queryResultsSnapshot";
import { getQueryResultAccessService } from "./queryResultAccessService";
import { getQueryResultContextService } from "./queryResultContextService";
import { QueryResultSnapshotLease } from "./queryResultTypes";
import { PinnedResultsController } from "./pinnedResultsController";

export class PinnedQueryResultsDocument {
    constructor(
        readonly uri: vscode.Uri,
        readonly snapshotId: string | undefined,
        private readonly lease: QueryResultSnapshotLease | undefined,
    ) {}

    get expired(): boolean {
        return this.lease === undefined;
    }

    dispose(): void {
        if (this.snapshotId) {
            getQueryResultContextService().clearForSnapshot(this.snapshotId);
        }
        this.lease?.dispose();
    }
}

/**
 * Pinned-tab soft cap (C2D-D-09): retainContextWhenHidden multiplies
 * renderer memory per pinned tab. Warn once per session past the cap;
 * getState/rehydrate lands only if dogfood memory data demands it.
 */
const PINNED_TAB_SOFT_CAP = 8;
let warnedPinnedTabPressure = false;

function warnOnPinnedTabPressure(): void {
    if (warnedPinnedTabPressure) {
        return;
    }
    const pinnedLeases =
        getQueryResultAccessService().status().leasesByOwnerKind["pinnedDocument"] ?? 0;
    if (pinnedLeases >= PINNED_TAB_SOFT_CAP) {
        warnedPinnedTabPressure = true;
        void vscode.window.showWarningMessage(
            `${pinnedLeases + 1} pinned result tabs are open. Each keeps its data and view in memory — close ones you no longer need.`,
        );
    }
}

let pinnedContext: vscode.ExtensionContext | undefined;

/** Capture the extension context the panel opener needs (was an editor registration). */
export function registerPinnedResultsEditor(context: vscode.ExtensionContext): void {
    pinnedContext = context;
    context.subscriptions.push({
        dispose: () => {
            pinnedContext = undefined;
        },
    });
}

/** Open a pinned results panel for a snapshot. Returns true on open. */
export async function openPinnedResultsDocument(snapshotId: string): Promise<boolean> {
    const context = pinnedContext;
    if (!context) {
        return false;
    }
    const stamp = new Date();
    const hh = String(stamp.getHours()).padStart(2, "0");
    const mm = String(stamp.getMinutes()).padStart(2, "0");
    const ss = String(stamp.getSeconds()).padStart(2, "0");
    // Unique, value-free tab title: time + a slice of the opaque snapshot id.
    const title = `Pinned Results ${hh}.${mm}.${ss} ${snapshotId.slice(6, 10)}`;
    // The URI survives as the lease-owner / context-service identity only —
    // nothing resolves it as a file anymore.
    const uri = vscode.Uri.from({
        scheme: PINNED_RESULTS_SCHEME,
        path: `/${title}`,
        query: `sid=${snapshotId}`,
    });
    try {
        Perf.marker("mssql.queryResults.pin.open.begin", "begin");
        warnOnPinnedTabPressure();
        const lease = getQueryResultAccessService().acquireSnapshot(snapshotId, {
            kind: "pinnedDocument",
            documentUri: uri.toString(),
            label: "Pinned results document",
        });
        const document = new PinnedQueryResultsDocument(uri, snapshotId, lease);
        const panel = vscode.window.createWebviewPanel(
            PINNED_RESULTS_VIEW_TYPE,
            title,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
            { enableScripts: true, retainContextWhenHidden: true },
        );
        const controller = new PinnedResultsController(context, panel, document);
        panel.onDidDispose(() => {
            controller.dispose();
            document.dispose();
            Perf.marker("mssql.queryResults.pin.close", "instant", {
                expired: document.expired,
            });
        });
        Perf.marker("mssql.queryResults.pin.open.end", "end", {
            expired: document.expired,
            resultSetCount: controller.resultSetCount,
        });
        return true;
    } catch {
        return false;
    }
}
