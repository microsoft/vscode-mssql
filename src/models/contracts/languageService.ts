/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";

// ------------------------------- < IntelliSense Ready Event > ------------------------------------

/**
 * Event sent when the language service is finished updating after a connection
 */
export namespace IntelliSenseReadyNotification {
    export const type = new NotificationType<IntelliSenseReadyParams, void>(
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
    export const type = new NotificationType<RebuildIntelliSenseParams, void>(
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
    export const type = new NotificationType<StatusChangeParams, void>(
        "textDocument/statusChanged",
    );
}

/**
 * Status change event parameters
 */
export class StatusChangeParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;

    /**
     * The new status of the language service
     */
    public status: string;
}

// ------------------------------- </ Status Event > ----------------------------------

// ------------------------------- < Language Event > ------------------------------------

/**
 * Event sent when the language service detects a language change
 */
export namespace LanguageDetectedNotification {
    export const type = new NotificationType<LanguageDetectedParams, void>(
        "textDocument/languageDetected",
    );
}

/**
 * Language detection event parameters
 */
export class LanguageDetectedParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;

    /**
     * The detected language
     */
    public language: string;
}

// ------------------------------- </ Language Event > ----------------------------------

// ------------------------------- < Non-TSql Event > ------------------------------------

/**
 * Event sent when the language service detects a non-TSQL file
 */
export namespace NonTSqlNotification {
    export const type = new NotificationType<NonTSqlParams, void>("textDocument/nonTSql");
}

/**
 * Non-TSQL detected event parameters
 */
export class NonTSqlParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;

    /**
     * Language of the document
     */
    public language: string;
}

// ------------------------------- </ Non-TSql Event > ----------------------------------

// ------------------------------- < Completion Extension Request > ------------------------------------
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
    export const type = new RequestType<CompletionExtensionParams, boolean, void, void>(
        "completion/extLoad",
    );
}

// ------------------------------- </ Completion Extension Request > ----------------------------------

// ------------------------------- < Table Completion Request > ------------------------------------

/**
 * Parameters for requesting table completion
 */
export class TableCompletionParams {
    /**
     * URI identifying the text document
     */
    public ownerUri: string;

    /**
     * Search term for filtering tables
     */
    public searchTerm?: string;

    /**
     * Whether to include views in results
     */
    public includeViews?: boolean;

    /**
     * Maximum number of results to return
     */
    public maxResults?: number;
}

/**
 * Table completion item
 */
export class TableCompletionItem {
    /**
     * Name of the table
     */
    public name: string;

    /**
     * Schema name
     */
    public schema: string;

    /**
     * Fully qualified name (schema.table)
     */
    public fullyQualifiedName: string;

    /**
     * Type of object (Table or View)
     */
    public type: 'Table' | 'View';

    /**
     * Optional description
     */
    public description?: string;
}

/**
 * Table completion response
 */
export class TableCompletionResult {
    /**
     * List of table completion items
     */
    public items: TableCompletionItem[];

    /**
     * Whether results are complete or truncated
     */
    public isComplete: boolean;
}

export namespace TableCompletionRequest {
    export const type = new RequestType<TableCompletionParams, TableCompletionResult, void, void>(
        "textDocument/tableCompletion",
    );
}

// ------------------------------- </ Table Completion Request > ----------------------------------

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
    export const type = new NotificationType<DidChangeLanguageFlavorParams, void>(
        "connection/languageflavorchanged",
    );
}

// ------------------------------- </ Language Flavor Changed Event > ----------------------------------
