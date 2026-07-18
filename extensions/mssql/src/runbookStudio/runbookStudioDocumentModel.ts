/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared per-URI document model (Query Studio pattern, doc: execution plan
 * §5.1): owns the parsed artifact projection of the backing TextDocument,
 * the run history for this document, and change fan-out to controllers.
 * The TextDocument remains the single source of truth for artifact content —
 * edits flow through WorkspaceEdit so VS Code dirty/undo/save semantics hold.
 */

import * as path from "path";
import * as vscode from "vscode";
import { RunbookStudio as LocRunbookStudio } from "../constants/locConstants";
import {
    RbsError,
    RunbookArtifactFile,
    RunbookRunHistoryEntry,
    RunbookRunSnapshot,
} from "../sharedInterfaces/runbookStudio";
import {
    canonicalizeRunbookArtifact,
    isArtifactParseFailure,
    parseRunbookArtifact,
} from "./runbookArtifact";

const MAX_HISTORY_ENTRIES = 50;

export class RunbookStudioDocumentModel implements vscode.Disposable {
    /** Panels currently attached to this model (custom editor can dupe tabs). */
    public panelCount = 0;

    private _backingDocument: vscode.TextDocument;
    private _artifact: RunbookArtifactFile | undefined;
    private _artifactError: RbsError | undefined;
    private _activeRun: RunbookRunSnapshot | undefined;
    /** Explicit user selection of a (usually prior) run to present. */
    private _selectedRun: RunbookRunSnapshot | undefined;
    private _history: RunbookRunHistoryEntry[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<void>();
    public readonly onDidChange = this._onDidChange.event;
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        backingDocument: vscode.TextDocument,
        private readonly onFullyClosed: (model: RunbookStudioDocumentModel) => void,
    ) {
        this._backingDocument = backingDocument;
        this.reparse();
        this._disposables.push(
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() === this.uriKey) {
                    this.reparse();
                    this._onDidChange.fire();
                }
            }),
        );
    }

    public get backingDocument(): vscode.TextDocument {
        return this._backingDocument;
    }

    public get uriKey(): string {
        return this._backingDocument.uri.toString();
    }

    public get documentKind(): "saved" | "untitled" {
        return this._backingDocument.isUntitled ? "untitled" : "saved";
    }

    public get fileName(): string {
        return this._backingDocument.isUntitled
            ? this._backingDocument.uri.path
            : path.basename(this._backingDocument.uri.fsPath);
    }

    public get artifact(): RunbookArtifactFile | undefined {
        return this._artifact;
    }

    public get artifactError(): RbsError | undefined {
        return this._artifactError;
    }

    public get activeRun(): RunbookRunSnapshot | undefined {
        return this._activeRun;
    }

    /** The run the webview should present: the user's explicit selection
     *  when one is set, else the active/most recent run. */
    public get displayRun(): RunbookRunSnapshot | undefined {
        return this._selectedRun ?? this._activeRun;
    }

    public get history(): RunbookRunHistoryEntry[] {
        return this._history;
    }

    /** Re-resolve after Save As / revert (doc 04 §7.2 rebind-safe rule). */
    public rebind(document: vscode.TextDocument): void {
        this._backingDocument = document;
        this.reparse();
        this._onDidChange.fire();
    }

    /** Replace the artifact content through a WorkspaceEdit (dirty/undo-safe). */
    public async applyArtifactEdit(next: RunbookArtifactFile): Promise<boolean> {
        const text = canonicalizeRunbookArtifact(next);
        const edit = new vscode.WorkspaceEdit();
        const document = this._backingDocument;
        edit.replace(
            document.uri,
            new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length),
            ),
            text,
        );
        return vscode.workspace.applyEdit(edit);
    }

    /** Host-authoritative run state fan-in (ledger owns durability). */
    public setActiveRun(snapshot: RunbookRunSnapshot | undefined): void {
        // A DIFFERENT run taking the stage (run start, or rehydration on
        // open) clears any explicit prior-run selection — the newest run
        // is the default presentation. Live updates to the same run keep
        // the user's selection intact.
        if (snapshot && snapshot.runId !== this._activeRun?.runId) {
            this._selectedRun = undefined;
        }
        this._activeRun = snapshot;
        if (snapshot) {
            const entry: RunbookRunHistoryEntry = {
                runId: snapshot.runId,
                startedEpochMs: snapshot.startedEpochMs ?? Date.now(),
                state: snapshot.state,
                planRevision: snapshot.planRevision,
                ...(snapshot.verdict ? { verdict: snapshot.verdict } : {}),
            };
            const index = this._history.findIndex((h) => h.runId === snapshot.runId);
            if (index >= 0) {
                this._history[index] = entry;
            } else {
                this._history.unshift(entry);
                if (this._history.length > MAX_HISTORY_ENTRIES) {
                    this._history.length = MAX_HISTORY_ENTRIES;
                }
            }
        }
        this._onDidChange.fire();
    }

    public seedHistory(entries: RunbookRunHistoryEntry[]): void {
        this._history = entries.slice(0, MAX_HISTORY_ENTRIES);
        this._onDidChange.fire();
    }

    /** Present a specific run (History picker). Selecting the active run
     *  (or undefined) returns to live-follow of the newest run. */
    public selectRun(snapshot: RunbookRunSnapshot | undefined): void {
        this._selectedRun =
            snapshot && snapshot.runId !== this._activeRun?.runId ? snapshot : undefined;
        this._onDidChange.fire();
    }

    /** Called by the provider when the last panel closes. */
    public notifyPanelClosed(): void {
        this.panelCount = Math.max(0, this.panelCount - 1);
        if (this.panelCount === 0) {
            this.onFullyClosed(this);
            this.dispose();
        }
    }

    public dispose(): void {
        this._disposables.forEach((d) => d.dispose());
        this._onDidChange.dispose();
    }

    private reparse(): void {
        const result = parseRunbookArtifact(this._backingDocument.getText());
        if (!isArtifactParseFailure(result)) {
            this._artifact = result.artifact;
            this._artifactError = undefined;
        } else {
            this._artifact = undefined;
            this._artifactError = {
                code: result.code,
                message:
                    result.code === "RunbookStudio.IncompatibleVersion"
                        ? LocRunbookStudio.incompatibleArtifact(result.detail)
                        : LocRunbookStudio.invalidArtifact(result.detail),
            };
        }
    }
}
