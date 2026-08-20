/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    metadataSectionsInvalidatedByExecutedSql as classifyExecutedSqlMetadataEffects,
    type MetadataSection,
} from "@vscode-mssql/tsql-language-service";
import * as vscode from "vscode";
import { PreviewLanguageService as PreviewLoc } from "../../constants/locConstants";
import type { QueryExecutionCatalogEvent } from "../../models/sqlOutputContentProvider";
import type { PreviewDocumentState } from "./previewLanguageServiceState";

export interface PreviewMetadataRefreshCoordinatorOptions {
    readonly isEnabled: () => boolean;
    readonly resolveSqlDocument: (uri: vscode.Uri | undefined) => vscode.TextDocument | undefined;
    readonly stateForUri: (uri: string) => PreviewDocumentState | undefined;
    readonly statusChanged: (state: PreviewDocumentState) => void;
}

/** Owns manual and query-execution metadata refresh without owning document analysis. */
export class PreviewMetadataRefreshCoordinator {
    public constructor(private readonly _options: PreviewMetadataRefreshCoordinatorOptions) {}

    public async refreshMetadata(uri: vscode.Uri | undefined, notify: boolean): Promise<void> {
        if (!this._options.isEnabled()) {
            if (notify) void vscode.window.showInformationMessage(PreviewLoc.enableSettingFirst);
            return;
        }
        const document = this._options.resolveSqlDocument(uri);
        if (!document) {
            if (notify) void vscode.window.showInformationMessage(PreviewLoc.openEditorToRefresh);
            return;
        }
        const state = this._options.stateForUri(document.uri.toString());
        if (!state || state.metadata.id === "null") {
            if (notify) void vscode.window.showInformationMessage(PreviewLoc.connectBeforeRefresh);
            return;
        }
        await this.refreshState(state, notify);
    }

    public handleQueryExecutionCatalogChanged(event: QueryExecutionCatalogEvent): void {
        if (!this._options.isEnabled() || event.hasError || event.isRefresh || !event.query) return;
        const sections = metadataSectionsInvalidatedByExecutedSql(event.query);
        if (sections.length === 0) return;
        const state = this._options.stateForUri(event.uri);
        if (!state || state.disposed || !state.metadata.refreshSections) return;
        void this.refreshSectionsAfterExecution(state, sections);
    }

    public async refreshState(state: PreviewDocumentState, notify: boolean): Promise<void> {
        if (state.refreshing) return;
        state.refreshing = true;
        state.lastRefreshError = undefined;
        this._options.statusChanged(state);
        try {
            const result = await state.metadata.refresh();
            state.lastRefreshMs = result.elapsedMs;
            if (notify) {
                void vscode.window.showInformationMessage(
                    PreviewLoc.metadataRefreshed(result.elapsedMs.toFixed(1)),
                );
            }
        } catch (error) {
            state.lastRefreshError = errorMessage(error);
            if (notify) {
                void vscode.window.showErrorMessage(
                    PreviewLoc.metadataRefreshFailed(state.lastRefreshError),
                );
            }
        } finally {
            state.refreshing = false;
            this._options.statusChanged(state);
        }
    }

    private async refreshSectionsAfterExecution(
        state: PreviewDocumentState,
        sections: readonly MetadataSection[],
    ): Promise<void> {
        const ownsRefreshIndicator = !state.refreshing;
        if (ownsRefreshIndicator) {
            state.refreshing = true;
            state.lastRefreshError = undefined;
            this._options.statusChanged(state);
        }
        try {
            const result = await state.metadata.refreshSections!(sections);
            if (!state.disposed) state.lastRefreshMs = result.elapsedMs;
        } catch (error) {
            if (!state.disposed) state.lastRefreshError = errorMessage(error);
        } finally {
            if (ownsRefreshIndicator && !state.disposed) {
                state.refreshing = false;
                this._options.statusChanged(state);
            }
        }
    }
}

/** Parser-owned invalidation classification used by both extension events and tests. */
export function metadataSectionsInvalidatedByExecutedSql(sql: string): readonly MetadataSection[] {
    return classifyExecutedSqlMetadataEffects(sql);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
