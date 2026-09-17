/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtractTarget } from "../common/enums";
import { IUserDatabaseReferenceSettings } from "../models/IDatabaseReferenceSettings";
import { removeSqlCmdVariableFormatting } from "../common/utils";
import { SqlProjects } from "../../constants/locConstants";

/**
 * Function to map folder structure string to enum
 * @param inputTarget folder structure in string
 * @returns folder structure in enum format
 */
export function mapExtractTargetEnum(inputTarget: string): ExtractTarget {
    if (inputTarget) {
        switch (inputTarget) {
            case SqlProjects.file:
                return ExtractTarget.file;
            case SqlProjects.flat:
                return ExtractTarget.flat;
            case SqlProjects.objectType:
                return ExtractTarget.objectType;
            case SqlProjects.schema:
                return ExtractTarget.schema;
            case SqlProjects.schemaObjectType:
                return ExtractTarget.schemaObjectType;
            default:
                throw new Error(SqlProjects.invalidInput(inputTarget));
        }
    } else {
        throw new Error(SqlProjects.extractTargetRequired);
    }
}

export interface DbServerValues {
    dbName?: string;
    dbVariable?: string;
    serverName?: string;
    serverVariable?: string;
}

export function populateResultWithVars(
    referenceSettings: IUserDatabaseReferenceSettings,
    dbServerValues: DbServerValues,
) {
    if (dbServerValues.dbVariable) {
        referenceSettings.databaseName = ensureSetOrDefined(dbServerValues.dbName);
        referenceSettings.databaseVariable = ensureSetOrDefined(
            removeSqlCmdVariableFormatting(dbServerValues.dbVariable),
        );
        referenceSettings.serverName = ensureSetOrDefined(dbServerValues.serverName);
        referenceSettings.serverVariable = ensureSetOrDefined(
            removeSqlCmdVariableFormatting(dbServerValues.serverVariable),
        );
    } else {
        referenceSettings.databaseVariableLiteralValue = ensureSetOrDefined(dbServerValues.dbName);
    }
}

/**
 * Returns undefined for settings that are an empty string, meaning they are unset
 * @param setting
 */
export function ensureSetOrDefined(setting?: string): string | undefined {
    if (!setting || setting.trim().length === 0) {
        return undefined;
    }
    return setting;
}
