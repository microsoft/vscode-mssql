/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { DialogService } from "./dialogService";
import * as vscode from 'vscode';
import * as azdata from './interfaces';

export class ConnectionDialog {

    private _dialogService: DialogService;

    constructor(context: vscode.ExtensionContext) {
        this._dialogService = new DialogService(context);
    }

    public open(): void {
        let dialog = azdata.window.createModelViewDialog('Connection Dialog', 'Connection Dialog', 'wide');
        dialog.registerContent(async (view) => {
            try {

                let testButton1 = view.modelBuilder.button().component();

                let formModel = view.modelBuilder.formContainer()
                    .withFormItems([{
                        component: testButton1,
                        title: 'Test Button'
                    },
                    ]).component();

                await view.initializeModel(formModel);
            } catch (ex) {
                //reject(ex);
            }
        });

        this._dialogService.openDialog(dialog);
    }

    public close(): void {
    }
}
