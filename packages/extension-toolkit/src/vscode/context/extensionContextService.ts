/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from "vscode";
import { createServiceIdentifier } from "../../base";

export const IExtensionContextService =
    createServiceIdentifier<IExtensionContextService>("extensionContextService");

export interface IExtensionContextService {
    readonly _serviceBrand: undefined;
    readonly context: vscode.ExtensionContext;
}

export class ExtensionContextService implements IExtensionContextService {
    declare readonly _serviceBrand: undefined;

    constructor(readonly context: vscode.ExtensionContext) {}
}
