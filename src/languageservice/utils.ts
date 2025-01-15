/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { languageId } from "../constants/constants";
import {
    DidChangeLanguageFlavorParams,
    LanguageFlavorChangedNotification,
} from "../models/contracts/languageService";
import StatusView from "../views/statusView";
import SqlToolsServiceClient from "./serviceclient";

export enum LanguageServiceOptions {
    SwitchDisabled = 0,
    SwitchEnabled = 1,
    SwitchUnset = 2,
}

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
