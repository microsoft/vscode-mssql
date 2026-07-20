/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import { TelemetryActions } from "../../sharedInterfaces/telemetry";

// ------------------------------- < SQL Tools Service Telemetry Event > --------------------------

export interface SqlToolsServiceTelemetryParams {
    params: {
        eventName: TelemetryActions;
        properties?: Record<string, string>;
        measures?: Record<string, number>;
    };
}

/**
 * Event sent when SQL Tools Service emits a telemetry event.
 */
export namespace SqlToolsServiceTelemetryNotification {
    export const type = new NotificationType<SqlToolsServiceTelemetryParams>("telemetry/sqlevent");
}

// ------------------------------- </ SQL Tools Service Telemetry Event > -------------------------

// ------------------------------- < IntelliSense Ready Event > ------------------------------------

/**
 * Event sent when the language service is finished updating after a connection
 */
export namespace IntelliSenseReadyNotification {
    export const type = new NotificationType<IntelliSenseReadyParams>(
        "textDocument/intelliSenseReady",
    );
}

/**
 * Update event parameters
 */
export class IntelliSenseReadyParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;
}

/**
 * Notification sent when the an IntelliSense cache invalidation is requested
 */
export namespace RebuildIntelliSenseNotification {
    export const type = new NotificationType<RebuildIntelliSenseParams>(
        "textDocument/rebuildIntelliSense",
    );
}

/**
 * Rebuild IntelliSense notification parameters
 */
export class RebuildIntelliSenseParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;
}

// ------------------------------- </ IntelliSense Ready Event > ----------------------------------

// ------------------------------- < Status Event > ------------------------------------

/**
 * Event sent when the language service send a status change event
 */
export namespace StatusChangedNotification {
    export const type = new NotificationType<StatusChangeParams>("textDocument/statusChanged");
}

/**
 * Update event parameters
 */
export class StatusChangeParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;

    /**
     * The new status of the document
     */
    public status: string;
}

// ------------------------------- </ Status Sent Event > ----------------------------------

// ------------------------------- < Non T-Sql Event > ------------------------------------

export class NonTSqlParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;
    /**
     * Indicates whether the file was flagged due to containing
     * non-TSQL keywords or hitting the error limit.
     */
    public containsNonTSqlKeywords: boolean;
}

/**
 *
 */
export namespace NonTSqlNotification {
    export const type = new NotificationType<NonTSqlParams>("textDocument/nonTSqlFileDetected");
}

// ------------------------------- </ Non T-Sql Event > ----------------------------------

// ------------------------------- < Language Flavor Changed Event > ------------------------------------
/**
 * Language flavor change event parameters
 */
export class DidChangeLanguageFlavorParams {
    /**
     * URI identifying the text document
     */
    public uri: string;
    /**
     * text document's language
     */
    public language: string;
    /**
     * Sub-flavor for the langauge, e.g. 'MSSQL' for a SQL Server connection or 'Other' for any other SQL flavor
     */
    public flavor: string;
}

/**
 * Notification sent when the language flavor is changed
 */
export namespace LanguageFlavorChangedNotification {
    export const type = new NotificationType<DidChangeLanguageFlavorParams>(
        "connection/languageflavorchanged",
    );
}

// ------------------------------- < Load Completion Extension Request > ------------------------------------
/**
 * Completion extension load parameters
 */
export class CompletionExtensionParams {
    /// <summary>
    /// Absolute path for the assembly containing the completion extension
    /// </summary>
    public assemblyPath: string;
    /// <summary>
    /// The type name for the completion extension
    /// </summary>
    public typeName: string;
    /// <summary>
    /// Property bag for initializing the completion extension
    /// </summary>
    public properties: {};
}

export namespace CompletionExtLoadRequest {
    export const type = new RequestType<CompletionExtensionParams, boolean, void>(
        "completion/extLoad",
    );
}

// ------------------------------- < SQL Symbol Rename > ------------------------------------

export interface SqlSymbolRenameParams {
    textDocument: { uri: string };
    position: { line: number; character: number };
    newName: string;
    /** Current content of the project's .refactorlog file, or null/empty if none exists yet. */
    existingRefactorLogContent: string | null;
}

export interface SqlSymbolRenameTextEdit {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    newText: string;
}

export interface SqlSymbolRenameResponse {
    changes: { [uri: string]: SqlSymbolRenameTextEdit[] } | null;
    /**
     * Full content of the .refactorlog file with the new rename operation appended, ready to write.
     * Null when the renamed symbol does not require a refactorlog entry.
     */
    refactorLogContent: string | null;
    newName: string;
    /**
     * When non-null, a message to surface to the user.
     * If isWarning is true, show a confirmation dialog; otherwise show a blocking error.
     */
    message?: string | null;
    /** True when message is a confirmation warning; false (default) when it is a hard rejection. */
    isWarning?: boolean;
}

export namespace SqlSymbolRenameRequest {
    export const type = new RequestType<SqlSymbolRenameParams, SqlSymbolRenameResponse, void>(
        "sql/rename",
    );
}

// ------------------------------- </ SQL Symbol Rename > ----------------------------------

// ------------------------------- < SQL Move To Schema > ------------------------------------

export interface SqlMoveToSchemaParams {
    textDocument: { uri: string };
    position: { line: number; character: number };
    /** The target schema the object is moved to, as picked by the user. */
    targetSchema: string;
    /** Current content of the project's .refactorlog file, or null/empty if none exists yet. */
    existingRefactorLogContent: string | null;
}

export interface SqlMoveToSchemaResponse {
    changes: { [uri: string]: SqlSymbolRenameTextEdit[] } | null;
    /**
     * Full content of the .refactorlog file with the new move-schema operation appended, ready to
     * write. Null when the moved object does not require a refactorlog entry.
     */
    refactorLogContent: string | null;
    targetSchema: string;
    /**
     * When non-null, a message to surface to the user.
     * If isWarning is true, show a confirmation dialog; otherwise show a blocking error.
     */
    message?: string | null;
    /** True when message is a confirmation warning; false (default) when it is a hard rejection. */
    isWarning?: boolean;
}

export namespace SqlMoveToSchemaRequest {
    export const type = new RequestType<SqlMoveToSchemaParams, SqlMoveToSchemaResponse, void>(
        "sql/moveToSchema",
    );
}

// ------------------------------- </ SQL Move To Schema > ----------------------------------

// ------------------------------- < List Project Schemas > ------------------------------------

export interface ListProjectSchemasParams {
    textDocument: { uri: string };
}

export interface ListProjectSchemasResponse {
    /** The distinct schema names defined in the project, sorted case-insensitively. */
    schemas: string[];
}

export namespace ListProjectSchemasRequest {
    export const type = new RequestType<ListProjectSchemasParams, ListProjectSchemasResponse, void>(
        "sql/listSchemas",
    );
}

// ------------------------------- </ List Project Schemas > ----------------------------------
