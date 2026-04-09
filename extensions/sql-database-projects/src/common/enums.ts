/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Centralized enum definitions for the sql-database-projects extension.
 *
 * IMPORTANT: These enums are duplicated here because the `const enum` definitions in
 * vscode-mssql.d.ts are not available at runtime (they get inlined during TypeScript
 * compilation). This file provides runtime-accessible enum values that match the
 * definitions in the .d.ts files.
 *
 * When adding or modifying enums here, ensure they stay in sync with:
 * - typings/vscode-mssql.d.ts
 *
 * TODO: Move all similar enums from other files to this centralized location.
 */

/**
 * Specifies the scenario for which to retrieve default deployment options.
 */
export const enum DeploymentScenario {
    /**
     * Deployment/Publish scenario - uses DacFx native defaults
     */
    Deployment = 0,
    /**
     * Schema Compare scenario - uses modified defaults optimized for schema comparison
     */
    SchemaCompare = 1,
}

/**
 * Specifies the mode in which a task should be executed.
 * Regular enum (not const) because the value is passed as a numeric argument to mssql/STS
 * methods at runtime and must exist as a real JS object.
 */
export enum TaskExecutionMode {
    execute = 0,
    script = 1,
    executeAndScript = 2,
}

/**
 * Specifies the target folder structure when extracting a project from a database.
 * Regular enum (not const) because the value is passed as a numeric argument to mssql/STS
 * methods at runtime and must exist as a real JS object.
 * Must be kept in sync with ExtractTarget in vscode-mssql.d.ts.
 */
export enum ExtractTarget {
    dacpac = 0,
    file = 1,
    flat = 2,
    objectType = 3,
    schema = 4,
    schemaObjectType = 5,
}

/**
 * Specifies the type of a schema compare endpoint.
 * Regular enum (not const) because the value is passed as a numeric argument to mssql/STS
 * methods at runtime and must exist as a real JS object.
 * Must be kept in sync with SchemaCompareEndpointType in vscode-mssql.d.ts.
 */
export enum SchemaCompareEndpointType {
    Database = 0,
    Dacpac = 1,
    Project = 2,
}

/**
 * Well-known Authentication types.
 * const enum because values are strings — TypeScript inlines them as string literals at
 * compile time, so no runtime JS object is needed. Not defined in vscode-mssql.d.ts;
 * authenticationType is typed as plain `string` there.
 */
export const enum AuthenticationType {
    SqlLogin = "SqlLogin",
    Integrated = "Integrated",
    AzureMFA = "AzureMFA",
    ActiveDirectoryDefault = "ActiveDirectoryDefault",
    AzureMFAAndUser = "AzureMFAAndUser",
    DSTSAuth = "dstsAuth",
    None = "None",
}
