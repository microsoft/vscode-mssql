/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio text synchronization (doc 04 §8) — host-side state machine.
 *
 * The backing TextDocument owns persistence/undo; Monaco owns interactive
 * editing. This module is the pure convergence logic: version bookkeeping,
 * edit application in offset space, echo suppression, hash verification, and
 * the resync safety valve ("never diverges" is a spell, not a test — the
 * valve exists and its firing count is a dogfood gate at zero).
 *
 * Pure by design: no vscode imports, fully unit-testable. The document model
 * adapts VS Code TextDocument events into these calls.
 */

import { QsSyncEdits, QsSyncRemote, QsTextEdit } from "../sharedInterfaces/queryStudio";

/**
 * Stable text hash shared by host and webview (FNV-1a 32-bit over UTF-16
 * code units, hex). Cheap enough per keystroke group; both sides must use
 * THIS implementation — the webview bundle imports it from here.
 */
export function textHash(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
}

/** Apply offset-space edits (sorted descending so offsets stay valid). */
export function applyEdits(text: string, edits: QsTextEdit[]): string {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    let result = text;
    for (const edit of sorted) {
        if (edit.start < 0 || edit.end < edit.start || edit.end > result.length) {
            throw new Error(
                `edit out of bounds: [${edit.start},${edit.end}) on length ${result.length}`,
            );
        }
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return result;
}

export interface SyncApplyOutcome {
    applied: boolean;
    hostVersion: number;
    newText?: string;
    /** True ⇒ caller must issue a full resync to the webview. */
    resyncNeeded: boolean;
    reason?: string;
}

export interface HostChangeOutcome {
    /** Remote message to forward, or undefined when fully suppressed echo. */
    remote?: QsSyncRemote;
    /** Echo group consumed by this change (diagnostic). */
    echoConsumed?: string;
}

interface PendingEcho {
    editGroupId: string;
    expectedHash: string;
}

/**
 * Host-side sync engine for ONE document model. The host TextDocument is the
 * source of truth; `hostVersion` increments on every applied change from any
 * origin (webview edits, user edits in a classic editor, format-on-save…).
 */
export class TextSyncEngine {
    private version = 1;
    private text: string;
    private pendingEchoes: PendingEcho[] = [];
    private resyncCounter = 0;

    constructor(initialText: string) {
        this.text = initialText;
    }

    get hostVersion(): number {
        return this.version;
    }

    get currentText(): string {
        return this.text;
    }

    get currentHash(): string {
        return textHash(this.text);
    }

    get resyncCount(): number {
        return this.resyncCounter;
    }

    /**
     * Webview edit group arrives. Applied only against the exact base
     * version; a stale base means a host change interleaved — the webview
     * will receive it as a remote/resync, so the group is rejected (Monaco
     * re-sends against the new base after reconciliation).
     */
    applyWebviewEdits(edits: QsSyncEdits): SyncApplyOutcome {
        if (edits.baseHostVersion !== this.version) {
            return {
                applied: false,
                hostVersion: this.version,
                resyncNeeded: false,
                reason: `stale base ${edits.baseHostVersion} (host at ${this.version})`,
            };
        }
        let newText: string;
        try {
            newText = applyEdits(this.text, edits.edits);
        } catch (error) {
            this.resyncCounter++;
            return {
                applied: false,
                hostVersion: this.version,
                resyncNeeded: true,
                reason: error instanceof Error ? error.message : String(error),
            };
        }
        if (textHash(newText) !== edits.textHashAfter) {
            // Divergence: both sides applied "the same" edit differently.
            this.resyncCounter++;
            return {
                applied: false,
                hostVersion: this.version,
                resyncNeeded: true,
                reason: "hash mismatch after webview edit group",
            };
        }
        this.text = newText;
        this.version++;
        // The TextDocument change this application triggers must not bounce
        // back to Monaco: register the expected echo.
        this.pendingEchoes.push({
            editGroupId: edits.editGroupId,
            expectedHash: edits.textHashAfter,
        });
        if (this.pendingEchoes.length > 64) {
            this.pendingEchoes.shift();
        }
        return {
            applied: true,
            hostVersion: this.version,
            newText,
            resyncNeeded: false,
        };
    }

    /**
     * Host TextDocument changed (any origin). Returns the remote message for
     * the webview — flagged as the echo of a webview group when it matches a
     * pending echo (the webview then skips re-applying).
     */
    onHostTextChanged(
        newText: string,
        edits: QsTextEdit[],
        reason: QsSyncRemote["reason"],
    ): HostChangeOutcome {
        const fromVersion = this.version;
        // If this change is the echo of a webview group, hostVersion was
        // already bumped in applyWebviewEdits and text is already current.
        const newHash = textHash(newText);
        const echoIndex = this.pendingEchoes.findIndex((e) => e.expectedHash === newHash);
        if (echoIndex >= 0 && newText === this.text) {
            const echo = this.pendingEchoes.splice(echoIndex, 1)[0];
            return {
                remote: {
                    fromHostVersion: fromVersion,
                    toHostVersion: this.version,
                    edits: [],
                    textHash: newHash,
                    reason: "echo",
                    echoOfEditGroupId: echo.editGroupId,
                },
                echoConsumed: echo.editGroupId,
            };
        }
        this.text = newText;
        this.version++;
        return {
            remote: {
                fromHostVersion: fromVersion,
                toHostVersion: this.version,
                edits,
                textHash: newHash,
                reason,
            },
        };
    }

    /** Full resync payload (init or safety valve). */
    resync(reason: string): {
        text: string;
        hostVersion: number;
        textHash: string;
        reason: string;
    } {
        this.pendingEchoes = [];
        return {
            text: this.text,
            hostVersion: this.version,
            textHash: this.currentHash,
            reason,
        };
    }

    /** Webview reports its hash; mismatch fires the valve. */
    verifyWebviewHash(webviewHash: string): boolean {
        if (webviewHash === this.currentHash) {
            return true;
        }
        this.resyncCounter++;
        return false;
    }
}

/**
 * Coalescing policy helper (doc 04 §8.2): group deltas within one Monaco
 * change event; flush on ≤16ms microtask bursts; flush immediately before
 * execute/completion/save/focus loss. The webview owns the timing; this
 * shared constant keeps both sides honest.
 */
export const SYNC_COALESCE_MS = 16;
