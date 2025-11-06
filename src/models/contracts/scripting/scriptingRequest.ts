/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";
import { IScriptingObject } from "vscode-mssql";

export interface IConnectionInfo {
    options: { [name: string]: any };
}

export enum ScriptOperation {
    Select = 0,
    Create = 1,
    Insert = 2,
    Update = 3,
    Delete = 4,
    Execute = 5,
    Alter = 6,
}

export interface IScriptOptions {
    /**
     * Generate ANSI padding statements
     */
    scriptANSIPadding?: boolean;

    /**
     * Append the generated script to a file
     */
    appendToFile?: boolean;

    /**
     * Continue to script if an error occurs. Otherwise, stop.
     */
    continueScriptingOnError?: boolean;

    /**
     * Convert user-defined data types to base types.
     */
    convertUDDTToBaseType?: boolean;

    /**
     * Generate script for dependent objects for each object scripted.
     */
    generateScriptForDependentObjects?: boolean;

    /**
     * Include descriptive headers for each object generated.
     */
    includeDescriptiveHeaders?: boolean;

    /**
     * Check that an object with the given name exists before dropping or altering or that an object with the given name does not exist before creating.
     */
    includeIfNotExists?: boolean;

    /**
     * Script options to set vardecimal storage format.
     */
    includeVarDecimal?: boolean;

    /**
     * Include system generated constraint names to enforce declarative referential integrity.
     */
    scriptDRIIncludeSystemNames?: boolean;

    /**
     * Include statements in the script that are not supported on the specified SQL Server database engine type.
     */
    includeUnsupportedStatements?: boolean;

    /**
     * Prefix object names with the object schema.
     */
    schemaQualify?: boolean;

    /**
     * Script options to set bindings option.
     */
    bindings?: boolean;

    /**
     * Script the objects that use collation.
     */
    collation?: boolean;

    /**
     * Script the default values.
     */
    default?: boolean;

    /**
     * Script Object CREATE/DROP statements.
     */
    scriptCreateDrop: string;

    /**
     * Script the Extended Properties for each object scripted.
     */
    scriptExtendedProperties?: boolean;

    /**
     * Script only features compatible with the specified version of SQL Server.
     */
    scriptCompatibilityOption: string;

    /**
     * Script only features compatible with the specified SQL Server database engine type.
     */
    targetDatabaseEngineType: string;

    /**
     * Script only features compatible with the specified SQL Server database engine edition.
     */
    targetDatabaseEngineEdition: string;

    /**
     * Script all logins available on the server. Passwords will not be scripted.
     */
    scriptLogins?: boolean;

    /**
     * Generate object-level permissions.
     */
    scriptObjectLevelPermissions?: boolean;

    /**
     * Script owner for the objects.
     */
    scriptOwner?: boolean;

    /**
     * Script statistics, and optionally include histograms, for each selected table or view.
     */
    scriptStatistics: string;

    /**
     * Generate USE DATABASE statement.
     */
    scripUseDatabase?: boolean;

    /**
     * Generate script that contains schema only or schema and azdata.
     */
    typeOfDataToScript: string;

    /**
     * Scripts the change tracking information.
     */
    scriptChangeTracking?: boolean;

    /**
     * Script the check constraints for each table or view scripted.
     */
    scriptCheckConstraints?: boolean;

    /**
     * Scripts the data compression information.
     */
    scriptDataCompressionOptions?: boolean;

    /**
     * Script the foreign keys for each table scripted.
     */
    scriptForeignKeys?: boolean;

    /**
     * Script the full-text indexes for each table or indexed view scripted.
     */
    scriptFullTextIndexes?: boolean;

    /**
     * Script the indexes (including XML and clustered indexes) for each table or indexed view scripted.
     */
    scriptIndexes?: boolean;

    /**
     * Script the primary keys for each table or view scripted
     */
    scriptPrimaryKeys?: boolean;

    /**
     * Script the triggers for each table or view scripted
     */
    scriptTriggers?: boolean;

    /**
     * Script the unique keys for each table or view scripted.
     */
    uniqueKeys?: boolean;
}

export interface IScriptingParams {
    /**
     * File path used when writing out the script.
     */
    filePath: string;

    /**
     * Whether scripting to a single file or file per object.
     */
    scriptDestination: string;

    /**
     * Connection string of the target database the scripting operation will run against.
     */
    connectionString: string;

    /**
     * A list of scripting objects to script
     */
    scriptingObjects: IScriptingObject[];

    /**
     * A list of scripting object which specify the include criteria of objects to script.
     */
    includeObjectCriteria: IScriptingObject[];

    /**
     * A list of scripting object which specify the exclude criteria of objects to not script.
     */
    excludeObjectCriteria: IScriptingObject[];

    /**
     * A list of schema name of objects to script.
     */
    includeSchemas: string[];

    /**
     * A list of schema name of objects to not script.
     */
    excludeSchemas: string[];

    /**
     * A list of type name of objects to script.
     */
    includeTypes: string[];

    /**
     * A list of type name of objects to not script.
     */
    excludeTypes: string[];

    /**
     * Scripting options for the ScriptingParams
     */
    scriptOptions: IScriptOptions;

    /**
     * Connection details for the ScriptingParams
     */
    connectionDetails: IConnectionInfo;

    /**
     * Owner URI of the connection
     */
    ownerURI: string;

    /**
     * Whether the scripting operation is for
     * select script statements
     */
    selectScript: boolean;

    /**
     * Operation associated with the script request
     */
    operation: ScriptOperation;

    /**
     * Return script in events. This makes the script operation return an immediate operationId and
     * send the script back in ScriptingCompleteNotification.
     */
    returnScriptAsEvent: boolean;
}

export interface IScriptingResult {
    operationId: string;
    script: string;
}

// ------------------------------- < Scripting Request > ----------------------------------------------

export namespace ScriptingRequest {
    /**
     * Returns children of a given node as a NodeInfo array.
     */
    export const type = new RequestType<IScriptingParams, IScriptingResult, void, void>(
        "scripting/script",
    );
}

/**
 * Base parameters for scripting event notifications
 */
export interface ScriptingEventParams {
    operationId: string;
    sequenceNumber: number;
}

/**
 * Parameters for scripting progress notification
 */
export interface ScriptingProgressNotificationParams extends ScriptingEventParams {
    /**
     * List of scripting objects processed so far
     */
    scirptingObject: IScriptingObject[];
    /**
     * Current status of the scripting operation
     */
    status: string;
    /**
     * Number of objects completed out of total objects to script
     */
    completedCount: number;
    /**
     * Total number of objects to script
     */
    totalCount: number;
    /**
     * Error details if any occurred during scripting
     */
    errorDetails: string;
    /**
     * Error message if any occurred during scripting
     */
    errorMessage: string;
}

export namespace ScriptingProgressNotification {
    /**
     * Notification sent to indicate progress of a scripting operation
     */
    export const type = new NotificationType<ScriptingProgressNotificationParams, void>(
        "scripting/scriptProgressNotification",
    );
}

/**
 * Parameters for scripting complete notification
 */
export interface ScriptingCompleteParams extends ScriptingEventParams {
    /**
     * Error details if any occurred during scripting
     */
    errorDetails: string;
    /**
     * Error message if any occurred during scripting
     */
    errorMessage: string;
    /**
     * Indicates if there were errors during the scripting operation
     */
    hasErrors: boolean;
    /**
     * Indicates if the scripting operation was canceled
     */
    canceled: boolean;
    /**
     * Final message for the scripting operation
     */
    message: string;
    /**
     * The generated script from the operation. Only included if returnScriptAsEvent was true in the request
     */
    script: string;
}

export namespace ScriptingCompleteNotification {
    /**
     * Notification sent to indicate completion of a scripting operation
     */
    export const type = new NotificationType<ScriptingCompleteParams, void>(
        "scripting/scriptComplete",
    );
}

export namespace ScriptingCancelRequest {
    /**
     * Request to cancel an ongoing scripting operation
     */
    export const type = new RequestType<{ operationId: string }, void, void, void>(
        "scripting/scriptCancel",
    );
}
