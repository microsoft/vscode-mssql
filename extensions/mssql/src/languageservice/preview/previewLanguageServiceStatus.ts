/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceStats } from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import { PreviewLanguageService as PreviewLoc } from "../../constants/locConstants";
import { showStatsCommand } from "./previewLanguageServiceConstants";
import type { PreviewDocumentState } from "./previewLanguageServiceState";

export class PreviewStatusCodeLensProvider implements vscode.CodeLensProvider {
    public constructor(
        private readonly _enabled: () => boolean,
        private readonly _state: (uri: vscode.Uri) => PreviewDocumentState | undefined,
        public readonly onDidChangeCodeLenses: vscode.Event<void>,
    ) {}

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!this._enabled()) return [];
        const state = this._state(document.uri);
        const stats = state?.runtime.getStats(document.uri.toString());
        return [
            new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
                title: statusIcon(state, stats),
                tooltip: statusTooltip(state, stats),
                command: showStatsCommand,
                arguments: [document.uri],
            }),
        ];
    }
}

export class PreviewStatsDocumentProvider implements vscode.TextDocumentContentProvider {
    public constructor(
        private readonly _content: (uri: vscode.Uri) => string,
        public readonly onDidChange: vscode.Event<vscode.Uri>,
    ) {}

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this._content(uri);
    }
}

/** Collapse a VS Code document update into one equivalent UTF-16 edit for incremental parsing. */

export function isPreviewStatsCodeLensEnabled(
    languageServiceEnabled: boolean,
    statsCodeLensEnabled: boolean,
): boolean {
    return languageServiceEnabled && statsCodeLensEnabled;
}

function statusIcon(
    state: PreviewDocumentState | undefined,
    stats: LanguageServiceStats | undefined,
): string {
    switch (statusHealth(state, stats)) {
        case "healthy":
            return "$(check)";
        case "broken":
            return "$(error)";
        default:
            return "$(loading~spin)";
    }
}

/**
 * Codicon markup only resolves in a lens title, so the same strings render as a literal
 * `$(pulse)` in a tooltip and have to be stripped.
 */
function statusTooltip(
    state: PreviewDocumentState | undefined,
    stats: LanguageServiceStats | undefined,
): string {
    return `${withoutCodicons(statusTitle(state, stats))}
${PreviewLoc.openDetailedStatus}`;
}

function withoutCodicons(text: string): string {
    return text.replace(/\$\([^)]*\)/g, "").trim();
}

/**
 * A section that reports `failed` is a real breakage, not a slow load. Reading only `objects`
 * missed that distinction and rendered a failed catalog as merely pending.
 */
function statusHealth(
    state: PreviewDocumentState | undefined,
    stats: LanguageServiceStats | undefined,
): "healthy" | "working" | "broken" {
    if (!state || !stats) return "working";
    if (state.lastRefreshError || state.metadata.id === "null") return "broken";
    const completeness = stats.metadata.completeness;
    if (Object.values(completeness).some((section) => section === "failed")) return "broken";
    if (state.refreshing) return "working";
    return completeness.objects === "ready" ? "healthy" : "working";
}

export function statusTitle(
    state: PreviewDocumentState | undefined,
    stats: LanguageServiceStats | undefined,
): string {
    if (!state || !stats) return PreviewLoc.initializing;
    const metadata = state.lastRefreshError
        ? PreviewLoc.metadataFailed
        : state.refreshing
          ? PreviewLoc.metadataLoading
          : state.metadata.id === "null"
            ? PreviewLoc.metadataOffline
            : Object.values(stats.metadata.completeness).some((section) => section === "failed")
              ? PreviewLoc.metadataFailed
              : stats.metadata.completeness.objects === "ready"
                ? PreviewLoc.metadataReady
                : PreviewLoc.metadataPending;
    return PreviewLoc.status(
        stats.syntax.elapsedMs.toFixed(1),
        stats.semantics.elapsedMs.toFixed(1),
        metadata,
    );
}

/**
 * Classifies successful submitted SQL for cheap catalog invalidation. Strings, quoted identifiers,
 * and comments are masked so examples or dynamic SQL do not trigger an authoritative reload.
 */
