/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { PreviewFeature, previewService } from "../previews/previewService";

const legacyOwnedDocuments = new Set<string>();

/** True when the preview service, rather than SQL Tools Service, owns this editor document. */
export function betaSqlOwnsDocument(target: vscode.TextDocument | vscode.Uri): boolean {
    const uri = "uri" in target ? target.uri : target;
    return (
        previewService.isFeatureEnabled(PreviewFeature.BetaLanguageService) &&
        uri.scheme !== "vscode-notebook-cell" &&
        !legacyOwnedDocuments.has(uri.toString())
    );
}

/**
 * Checks an owner string only when it identifies an open editor document. Object Explorer uses
 * opaque owner keys (for example `server_database_user_profile`) that are deliberately not URIs.
 */
export function betaSqlOwnsDocumentUri(ownerUri: string): boolean {
    const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === ownerUri,
    );
    return document ? betaSqlOwnsDocument(document) : false;
}

/** SQLCMD documents deliberately remain on SQL Tools Service. */
export function setLegacySqlDocumentOwnership(uri: vscode.Uri | string, legacy: boolean): void {
    const key = typeof uri === "string" ? uri : uri.toString();
    if (legacy) {
        legacyOwnedDocuments.add(key);
    } else {
        legacyOwnedDocuments.delete(key);
    }
}

export function forgetSqlDocumentOwnership(uri: vscode.Uri | string): void {
    legacyOwnedDocuments.delete(typeof uri === "string" ? uri : uri.toString());
}
