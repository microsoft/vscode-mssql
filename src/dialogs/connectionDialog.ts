/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { DialogService } from "./dialogService";
import { Dialog, ModelView } from "./interfaces";
import * as vscode from 'vscode';

export class ConnectionDialog {

    private _dialogService: DialogService;

    constructor(context: vscode.ExtensionContext) {
        this._dialogService = new DialogService(context);
    }

    public open(): void {
        let dialog: Dialog = {
            title: 'Connection Dialog',
            isWide: undefined,
            content: undefined,
            okButton: undefined,
            cancelButton: undefined,
            customButtons: undefined,
            message: undefined,
            dialogName: undefined,
            modelView: undefined,
            valid: undefined,
            onValidityChanged: undefined,
            registerCloseValidator(validator: () => boolean | Thenable<boolean>): void {},
            registerContent(handler: (view: ModelView) => Thenable<void>): void {}
        };
        this._dialogService.openDialog(dialog);
    }

    public close(): void {
    }
}
