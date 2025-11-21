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
  export const type = new NotificationType<NonTSqlParams, void>(
    "textDocument/nonTSqlFileDetected",
  );
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
  export const type = new NotificationType<DidChangeLanguageFlavorParams, void>(
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
  export const type = new RequestType<
    CompletionExtensionParams,
    boolean,
    void,
    void
  >("completion/extLoad");
}
