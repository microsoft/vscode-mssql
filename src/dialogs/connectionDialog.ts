/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as azdata from '../modelView/interfaces';

export class ConnectionDialog {

    // Control labels
    private readonly ServerTextBoxLabel: string = 'Server';
    private readonly DatabaseTextBoxLabel: string = 'Database';
    private readonly UserNameTextBoxLabel: string = 'User';
    private readonly PasswordTextBoxLabel: string = 'Password';

    // UI Components
    private dialog: azdata.window.Dialog;
    private serverTextBox: azdata.InputBoxComponent;
    private databaseTextBox: azdata.InputBoxComponent;
    private userNameTextBox: azdata.InputBoxComponent;
    private passwordTextBox: azdata.InputBoxComponent;

    constructor() {
        this.dialog = azdata.window.createModelViewDialog('Connection Dialog');
        this.dialog.registerContent(async (view) => {
            try {
                this.serverTextBox = view.modelBuilder.inputBox().component();
                this.databaseTextBox = view.modelBuilder.inputBox().component();
                this.userNameTextBox = view.modelBuilder.inputBox().component();
                this.passwordTextBox = view.modelBuilder.inputBox().component();
                let okButton = view.modelBuilder.button().component();

                let formModel = view.modelBuilder.formContainer()
                    .withFormItems([{
                        component: this.serverTextBox,
                        title: this.ServerTextBoxLabel
                    }, {
                        component: this.databaseTextBox,
                        title: this.DatabaseTextBoxLabel
                    }, {
                        component: this.userNameTextBox,
                        title: this.UserNameTextBoxLabel
                    }, {
                        component: this.passwordTextBox,
                        title: this.PasswordTextBoxLabel
                    }, {
                        component: okButton,
                        title: 'OK'
                    }
                    ]).component();

                    okButton.onDidClick(() => {
                        let server: string = this.serverTextBox.value;
                        let database: string = this.databaseTextBox.value;
                        let userName: string = this.userNameTextBox.value;
                        let password: string = this.passwordTextBox.value;

                        let serverValue = this.serverTextBox.getValue();

                        vscode.window.showInformationMessage('OK button clicked with values server=' + server + ', database='
                            + database + ', username=' + ', ' + userName + ', password' +  password);
                    });

                await view.initializeModel(formModel);
            } catch (ex) {
                vscode.window.showErrorMessage('Unknown error occurred: ' + ex.toString());
            }
        });
    }

    public open(): void {
        azdata.window.openDialog(this.dialog);
    }

    public close(): void {
    }
}
