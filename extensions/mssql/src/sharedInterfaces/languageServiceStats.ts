/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageServiceStats } from "@vscode-mssql/tsql-language-service";
import { RequestType } from "vscode-jsonrpc";

/**
 * What the preview language service statistics panel shows.
 *
 * Scoped to one document on purpose. The runtime, the metadata provider, and the fetch log are all
 * created per document by the host, so a panel covering several would be merging caches that are
 * genuinely separate -- and would imply a sharing that does not exist. One document, one panel, one
 * honest account of what that file loaded.
 */
export interface LanguageServiceStatsWebviewState {
    /** The file this panel describes, for display only. */
    readonly documentName: string;
    /** The database the document is connected to, or undefined when it is not connected. */
    readonly databaseName?: string;
    /** True while the preview language service is enabled for this document. */
    readonly enabled: boolean;
    /**
     * The measurements, or undefined before the document has been analysed once.
     *
     * Undefined means "not measured yet" and must render as such. A panel that showed zeros here
     * would report a quiet session as a fast one.
     */
    readonly stats?: LanguageServiceStats;
    /** Set when the last export wrote a file, so the panel can confirm where it went. */
    readonly lastExportPath?: string;
}

/** Copies the statistics to a file the user picks. */
export interface ExportStatsParams {
    /**
     * Keeps database names, object names, and SQL text in the exported file.
     *
     * Off by default: the export exists to be attached to a bug report, and the person attaching it
     * is often not the person who owns the schema it names.
     */
    readonly includeIdentifiers: boolean;
}

export namespace ExportStatsRequest {
    export const type = new RequestType<ExportStatsParams, void, void>("exportStats");
}

export namespace RefreshStatsRequest {
    export const type = new RequestType<void, void, void>("refreshStats");
}
