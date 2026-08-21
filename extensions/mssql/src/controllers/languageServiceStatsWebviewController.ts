/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { exportStats, type LanguageServiceStats } from "@vscode-mssql/tsql-language-service";
import { LanguageServiceStats as StatsLoc } from "../constants/locConstants";
import {
    CopyStatsRequest,
    ExportStatsParams,
    ExportStatsRequest,
    LanguageServiceStatsWebviewState,
    RefreshStatsRequest,
} from "../sharedInterfaces/languageServiceStats";
import { WebviewPanelController } from "./webviewPanelController";

/** Supplies the panel with the current measurements for one document. */
export interface LanguageServiceStatsSource {
    /** The measurements, or undefined when the document has not been analysed yet. */
    stats(documentUri: string): LanguageServiceStats | undefined;
    /** The database the document is connected to, when it is connected. */
    databaseName(documentUri: string): string | undefined;
    readonly enabled: boolean;
    /** Fires when the document's statistics change, so the panel follows without polling. */
    onDidChange(listener: (documentUri: string) => void): vscode.Disposable;
}

/**
 * The preview language service statistics panel, for one document.
 *
 * One panel per document rather than one panel listing every document, because the runtime and the
 * metadata cache behind these numbers are themselves per document. A combined view would have to
 * merge caches that are genuinely separate, and in doing so would suggest a sharing that does not
 * happen -- two files on the same database each load their own catalog.
 */
export class LanguageServiceStatsWebviewController extends WebviewPanelController<
    LanguageServiceStatsWebviewState,
    void,
    void
> {
    public constructor(
        context: vscode.ExtensionContext,
        private readonly _documentUri: string,
        documentName: string,
        private readonly _source: LanguageServiceStatsSource,
    ) {
        super(
            context,
            "languageServiceStats",
            "languageServiceStats",
            {
                documentName,
                enabled: _source.enabled,
                ...(_source.databaseName(_documentUri) === undefined
                    ? {}
                    : { databaseName: _source.databaseName(_documentUri)! }),
                ...(_source.stats(_documentUri) === undefined
                    ? {}
                    : { stats: _source.stats(_documentUri)! }),
            },
            {
                title: StatsLoc.panelTitle(documentName),
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true,
            },
        );

        this.registerRpcHandlers();
        this.registerDisposable(
            this._source.onDidChange((changed) => {
                if (changed === this._documentUri) this.publish();
            }),
        );
    }

    private registerRpcHandlers(): void {
        this.onRequest(RefreshStatsRequest.type, async () => {
            this.publish();
        });

        this.onRequest(ExportStatsRequest.type, async (params: ExportStatsParams) => {
            await this.export(params);
        });
        this.onRequest(CopyStatsRequest.type, async (params: ExportStatsParams) => {
            await this.copy(params);
        });
    }

    private publish(): void {
        const stats = this._source.stats(this._documentUri);
        const databaseName = this._source.databaseName(this._documentUri);
        this.state = {
            ...this.state,
            enabled: this._source.enabled,
            ...(databaseName === undefined ? {} : { databaseName }),
            ...(stats === undefined ? {} : { stats }),
        };
    }

    /**
     * Writes the statistics to a file the user picks.
     *
     * Redaction happens in the language service rather than here, so the panel and the exported file
     * are two renderings of one record instead of two collections that could describe different
     * sessions.
     */
    private async export(params: ExportStatsParams): Promise<void> {
        const stats = this._source.stats(this._documentUri);
        if (!stats) {
            void vscode.window.showInformationMessage(StatsLoc.nothingToExport);
            return;
        }
        const target = await vscode.window.showSaveDialog({
            filters: { JSON: ["json"] },
            saveLabel: StatsLoc.exportSaveLabel,
        });
        if (!target) return;
        const content = exportStats(stats, { includeIdentifiers: params.includeIdentifiers });
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, "utf8"));
        this.state = { ...this.state, lastExportPath: target.fsPath };
        void vscode.window.showInformationMessage(StatsLoc.exported(target.fsPath));
    }

    /**
     * Puts the same rendering the file export writes onto the clipboard.
     *
     * Most of these logs are pasted straight into a bug report or a chat, and routing that through
     * a save dialog and a temporary file was the slow way to do it.
     */
    private async copy(params: ExportStatsParams): Promise<void> {
        const stats = this._source.stats(this._documentUri);
        if (!stats) {
            void vscode.window.showInformationMessage(StatsLoc.nothingToExport);
            return;
        }
        await vscode.env.clipboard.writeText(
            exportStats(stats, { includeIdentifiers: params.includeIdentifiers }),
        );
        void vscode.window.showInformationMessage(StatsLoc.copied);
    }
}
