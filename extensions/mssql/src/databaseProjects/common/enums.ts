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

import type * as vscodeMssql from "vscode-mssql";

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
 * SQL project format used by SQL Tools Service.
 * Must stay in sync with ProjectType in vscode-mssql.d.ts.
 */
export const ProjectType = {
    SdkStyle: 0 as vscodeMssql.ProjectType,
    LegacyStyle: 1 as vscodeMssql.ProjectType,
} as const;
export type ProjectType = vscodeMssql.ProjectType;

/**
 * System databases supported by SQL project references.
 * Must stay in sync with SystemDatabase in vscode-mssql.d.ts.
 */
export const SystemDatabase = {
    Master: 0 as vscodeMssql.SystemDatabase,
    MSDB: 1 as vscodeMssql.SystemDatabase,
} as const;
export type SystemDatabase = vscodeMssql.SystemDatabase;

/**
 * Supported system database reference formats.
 * Must stay in sync with SystemDbReferenceType in vscode-mssql.d.ts.
 */
export const SystemDbReferenceType = {
    ArtifactReference: 0 as vscodeMssql.SystemDbReferenceType,
    PackageReference: 1 as vscodeMssql.SystemDbReferenceType,
} as const;
export type SystemDbReferenceType = vscodeMssql.SystemDbReferenceType;

/**
 * SQL Server engine editions returned by SQL Tools Service.
 * Must stay in sync with DatabaseEngineEdition in vscode-mssql.d.ts.
 */
export enum DatabaseEngineEdition {
    Unknown = 0,
    Personal = 1,
    Standard = 2,
    Enterprise = 3,
    Express = 4,
    SqlDatabase = 5,
    SqlDataWarehouse = 6,
    SqlStretchDatabase = 7,
    SqlManagedInstance = 8,
    SqlOnDemand = 11,
    SqlDbFabric = 12,
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
    AzureMFAAndUser = "AzureMFAAndUser",
    DSTSAuth = "dstsAuth",
    None = "None",
}
