/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { createServiceIdentifier } from "../../base";
import { IExtensionContextService } from "../context/extensionContextService";

export const IExtensionResourceService = createServiceIdentifier<IExtensionResourceService>(
    "extensionResourceService",
);

export interface IExtensionResourceService {
    readonly _serviceBrand: undefined;

    asAbsolutePath(relativePath: string): string;
    joinExtensionUri(...pathSegments: string[]): vscode.Uri;
}

export class ExtensionResourceService implements IExtensionResourceService {
    declare readonly _serviceBrand: undefined;

    constructor(
        @IExtensionContextService private readonly _contextService: IExtensionContextService,
    ) {}

    asAbsolutePath(relativePath: string): string {
        return this._contextService.context.asAbsolutePath(relativePath);
    }

    joinExtensionUri(...pathSegments: string[]): vscode.Uri {
        return vscode.Uri.joinPath(this._contextService.context.extensionUri, ...pathSegments);
    }
}
