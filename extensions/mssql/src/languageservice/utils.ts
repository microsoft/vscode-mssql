/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { languageId, mssqlProviderName, SqlCmdMode } from "../constants/constants";
import {
    DidChangeLanguageFlavorParams,
    LanguageFlavorChangedNotification,
} from "../models/contracts/languageService";
import StatusView from "../views/statusView";
import SqlToolsServiceClient from "./serviceclient";

export function changeLanguageServiceForFile(
    client: SqlToolsServiceClient,
    uri: string,
    flavor: string,
    statusView: StatusView,
): void {
    client.sendNotification(LanguageFlavorChangedNotification.type, {
        uri: uri,
        language: languageId,
        flavor: flavor,
    } as DidChangeLanguageFlavorParams);
    statusView.languageFlavorChanged(uri, flavor);
}

/**
 * Tells the language service whether to treat the file as a SQLCMD script, which suppresses
 * T-SQL diagnostics for SQLCMD commands and variables. Files in SQLCMD mode On or Auto are
 * treated as SQLCMD scripts, so SQLCMD syntax isn't reported as invalid in either mode.
 * @param client SQL Tools Service client
 * @param uri URI of the file
 * @param sqlCmdMode SQLCMD mode of the file
 */
export function changeSqlCmdModeForFile(
    client: SqlToolsServiceClient,
    uri: string,
    sqlCmdMode: SqlCmdMode,
): void {
    client.sendNotification(LanguageFlavorChangedNotification.type, {
        uri: uri,
        language: usesSqlCmdLanguage(sqlCmdMode) ? "sqlcmd" : languageId,
        flavor: mssqlProviderName,
    } as DidChangeLanguageFlavorParams);
}

/**
 * Gets whether the language service should treat a file with the given SQLCMD mode as a SQLCMD
 * script.
 * @param sqlCmdMode SQLCMD mode of the file
 */
export function usesSqlCmdLanguage(sqlCmdMode: SqlCmdMode): boolean {
    return sqlCmdMode === SqlCmdMode.On || sqlCmdMode === SqlCmdMode.Auto;
}
