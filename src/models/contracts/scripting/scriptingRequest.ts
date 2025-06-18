/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-languageclient";

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

export interface IScriptingObject {
    /**
     * The database object type
     */
    type: string;

    /**
     * The schema of the database object
     */
    schema: string;

    /**
     * The database object name
     */
    name: string;

    /**
     * The parent object name which is needed for scripting subobjects like triggers or indexes
     */
    parentName?: string;

    /**
     * The parent object type name such as Table, View, etc.
     */
    parentTypeName?: string;
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

export interface ScriptingProgressNotificationParams {
    scirptingObject: IScriptingObject[];
    status: string;
    completedCount: number;
    totalCount: number;
    errorDetails: string;
    errorMessage: string;
}

export namespace ScriptingProgressNotification {
    export const type = new NotificationType<ScriptingProgressNotificationParams, void>(
        "scripting/scriptProgressNotification",
    );
}
