/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Button, Dialog, DialogMessage, DialogTab, ModelView } from "./interfaces";
import * as vscode from 'vscode';
import { ModelViewImpl } from "./modelViewImpl";
import { ModelBuilderImpl } from "./modelBuilderImpl";

export class DialogImpl implements Dialog {
    /**
     * The title of the dialog
     */
    title: string;

    /**
     * Indicates the width of the dialog
     */
    isWide: boolean;

    /**
     * The content of the dialog. If multiple tabs are given they will be displayed with tabs
     * If a string is given, it should be the ID of the dialog's model view content
     */
    content: string | DialogTab[];

    /**
     * The ok button
     */
    okButton: Button;

    /**
     * The cancel button
     */
    cancelButton: Button;

    /**
     * Any additional buttons that should be displayed
     */
    customButtons: Button[];

    /**
     * Set the informational message shown in the dialog. Hidden when the message is
     * undefined or the text is empty or undefined. The default level is error.
     */
    message: DialogMessage;

    /**
     * Set the dialog name when opening
     * the dialog for telemetry
     */
    dialogName?: string;

    contentHandler: (view: ModelView) => Thenable<void>;

    /**
      * Returns the model view content if registered. Returns undefined if model review is not registered
      */
     readonly modelView: ModelView;

     /**
      * Whether the panel's content is valid
      */
     readonly valid: boolean;

     /**
      * Fired whenever the panel's valid property changes
      */
     readonly onValidityChanged: vscode.Event<boolean>;

    /**
     * Register a callback that will be called when the user tries to click done. Only
     * one callback can be registered at once, so each registration call will clear
     * the previous registration.
     * @param validator The callback that gets executed when the user tries to click
     * done. Return true to allow the dialog to close or false to block it from closing
     */
    registerCloseValidator(validator: () => boolean | Thenable<boolean>): void {
    }



    registerContent(handler: (view: ModelView) => Thenable<void>): void {
        this.contentHandler = handler;
    }
}
