/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { languageId, mssqlProviderName } from "../constants/constants";
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
 * T-SQL diagnostics for SQLCMD commands and variables.
 * @param client SQL Tools Service client
 * @param uri URI of the file
 * @param isSqlCmd whether the file is in SQLCMD mode
 */
export function changeSqlCmdModeForFile(
    client: SqlToolsServiceClient,
    uri: string,
    isSqlCmd: boolean,
): void {
    client.sendNotification(LanguageFlavorChangedNotification.type, {
        uri: uri,
        language: isSqlCmd ? "sqlcmd" : languageId,
        flavor: mssqlProviderName,
    } as DidChangeLanguageFlavorParams);
}
