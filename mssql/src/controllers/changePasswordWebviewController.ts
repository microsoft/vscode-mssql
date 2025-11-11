/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IConnectionInfo } from "vscode-mssql";
import {
    CancelChangePasswordWebviewNotification,
    ChangePasswordWebviewRequest,
    ChangePasswordWebviewState,
} from "../sharedInterfaces/changePassword";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import VscodeWrapper from "./vscodeWrapper";
import * as LocConstants from "../constants/locConstants";
import { ChangePasswordService as ChangePasswordService } from "../services/changePasswordService";

export class ChangePasswordWebviewController extends ReactWebviewPanelController<
    ChangePasswordWebviewState,
    void,
    string
> {
    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        private credentials: IConnectionInfo,
        private changePasswordService: ChangePasswordService,
    ) {
        super(
            context,
            vscodeWrapper,
            "changePassword",
            "changePassword",
            {
                server: credentials.server,
                userName: credentials.user,
            },
            {
                title: LocConstants.Connection.ChangePassword,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "changePassword_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "changePassword_light.svg",
                    ),
                },
                preserveFocus: true,
            },
        );

        this.registerRpcHandlers();
    }

    private registerRpcHandlers(): void {
        this.onRequest(ChangePasswordWebviewRequest.type, async (newPassword: string) => {
            let passwordChangeResponse;
            try {
                passwordChangeResponse = await this.changePasswordService.changePassword(
                    this.credentials,
                    newPassword,
                );
            } catch (error) {
                passwordChangeResponse = { error: error.message };
            }
            if (passwordChangeResponse.result) {
                this.dialogResult.resolve(newPassword);
                this.panel.dispose();
            }
            return passwordChangeResponse;
        });

        this.onNotification(CancelChangePasswordWebviewNotification.type, () => {
            this.dialogResult.resolve(undefined);
            this.panel.dispose();
        });
    }
}
