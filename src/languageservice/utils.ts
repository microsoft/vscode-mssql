/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DidChangeLanguageFlavorParams,
    LanguageFlavorChangedNotification,
} from "../models/contracts/languageService";
import { keywords } from "./nonTSqlKeywords";
import SqlToolsServiceClient from "./serviceclient";

export function getNonTSqlKeywords(): Set<string> {
    return keywords;
}

export enum LanguageServiceOptions {
    SwitchDisabled = 0,
    SwitchEnabled = 1,
    SwitchUnset = 2,
}

export function hasNonTSqlKeywords(
    text: string,
    nonTSqlKeywords: Set<string>,
): boolean {
    /// Remove single-line comments
    text = text.replace(/--.*$/gm, "");

    // Remove multi-line comments
    text = text.replace(/\/\*[\s\S]*?\*\//g, "");

    // Remove content within string literals
    text = text.replace(/'.*?'/g, "");

    // Remove square-bracketed identifiers (e.g., [...])
    text = text.replace(/\[.*?\]/g, "");

    let words = [];
    for (const word of text.toUpperCase().split(" ")) {
        if (nonTSqlKeywords.has(word.trim())) {
            words.push(word);
        }
    }
    const con = words.length > 0;
    return con;
}

export function changeLanguageServiceForFile(
    client: SqlToolsServiceClient,
    uri: string,
    flavor: string,
): void {
    client.sendNotification(LanguageFlavorChangedNotification.type, {
        uri: uri,
        language: "sql",
        flavor: flavor,
    } as DidChangeLanguageFlavorParams);
}
