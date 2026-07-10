/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pinned query results custom document (C2D-3, plan §10): a readonly custom
 * editor over a virtual `mssql-query-results-snapshot:` URI whose query
 * carries the snapshot id. No scratch file — a minimal readonly
 * FileSystemProvider backs the scheme so VS Code can stat/restore tabs.
 *
 * Lifecycle: openCustomDocument acquires the document's snapshot lease;
 * document dispose releases it (a pinned-purpose snapshot then disposes,
 * releasing the retained store). A missing/expired snapshot opens an
 * "expired" document — clear message, no row access, never a throw.
 */

import * as vscode from "vscode";
import { Perf } from "../perf/perfTelemetry";
import {
    PINNED_RESULTS_SCHEME,
    PINNED_RESULTS_VIEW_TYPE,
    pinnedResultsUriParts,
} from "../sharedInterfaces/queryResultsSnapshot";
import { getQueryResultAccessService } from "./queryResultAccessService";
import { getQueryResultContextService } from "./queryResultContextService";
import { QueryResultSnapshotLease } from "./queryResultTypes";
import { PinnedResultsController } from "./pinnedResultsController";

/** Readonly zero-byte backing for the virtual scheme (spike fallback §1.2.2). */
class PinnedResultsFileSystemProvider implements vscode.FileSystemProvider {
    private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile = this.emitter.event;

    watch(): vscode.Disposable {
        return { dispose: () => undefined };
    }
    stat(): vscode.FileStat {
        return {
            type: vscode.FileType.File,
            ctime: 0,
            mtime: 0,
            size: 0,
            permissions: vscode.FilePermission.Readonly,
        };
    }
    readDirectory(): [string, vscode.FileType][] {
        return [];
    }
    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions("Pinned results are read-only.");
    }
    readFile(): Uint8Array {
        return new Uint8Array();
    }
    writeFile(): void {
        throw vscode.FileSystemError.NoPermissions("Pinned results are read-only.");
    }
    delete(): void {
        throw vscode.FileSystemError.NoPermissions("Pinned results are read-only.");
    }
    rename(): void {
        throw vscode.FileSystemError.NoPermissions("Pinned results are read-only.");
    }
}

export class PinnedQueryResultsDocument implements vscode.CustomDocument {
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

class PinnedQueryResultsDocumentProvider
    implements vscode.CustomReadonlyEditorProvider<PinnedQueryResultsDocument>
{
    constructor(private readonly context: vscode.ExtensionContext) {}

    openCustomDocument(uri: vscode.Uri): PinnedQueryResultsDocument {
        const snapshotId = pinnedResultsUriParts(uri)?.snapshotId;
        const lease = snapshotId
            ? getQueryResultAccessService().acquireSnapshot(snapshotId, {
                  kind: "pinnedDocument",
                  documentUri: uri.toString(),
                  label: "Pinned results document",
              })
            : undefined;
        return new PinnedQueryResultsDocument(uri, snapshotId, lease);
    }

    resolveCustomEditor(document: PinnedQueryResultsDocument, panel: vscode.WebviewPanel): void {
        Perf.marker("mssql.queryResults.pin.open.begin", "begin");
        const controller = new PinnedResultsController(this.context, panel, document);
        panel.onDidDispose(() => {
            controller.dispose();
            Perf.marker("mssql.queryResults.pin.close", "instant", {
                expired: document.expired,
            });
        });
        Perf.marker("mssql.queryResults.pin.open.end", "end", {
            expired: document.expired,
            resultSetCount: controller.resultSetCount,
        });
    }
}

export function registerPinnedResultsEditor(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.registerFileSystemProvider(
            PINNED_RESULTS_SCHEME,
            new PinnedResultsFileSystemProvider(),
            { isCaseSensitive: true, isReadonly: true },
        ),
        vscode.window.registerCustomEditorProvider(
            PINNED_RESULTS_VIEW_TYPE,
            new PinnedQueryResultsDocumentProvider(context),
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: true,
            },
        ),
    );
}

/** Open (or focus) a pinned document for a snapshot. Returns true on open. */
export async function openPinnedResultsDocument(snapshotId: string): Promise<boolean> {
    const stamp = new Date();
    const hh = String(stamp.getHours()).padStart(2, "0");
    const mm = String(stamp.getMinutes()).padStart(2, "0");
    const ss = String(stamp.getSeconds()).padStart(2, "0");
    // Unique, value-free tab title: time + a slice of the opaque snapshot id.
    const title = `Pinned Results ${hh}.${mm}.${ss} ${snapshotId.slice(6, 10)}`;
    const uri = vscode.Uri.from({
        scheme: PINNED_RESULTS_SCHEME,
        path: `/${title}.mssqlresults`,
        query: `sid=${snapshotId}`,
    });
    try {
        await vscode.commands.executeCommand(
            "vscode.openWith",
            uri,
            PINNED_RESULTS_VIEW_TYPE,
            vscode.ViewColumn.Beside,
        );
        return true;
    } catch {
        return false;
    }
}
