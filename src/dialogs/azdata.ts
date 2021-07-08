import * as vscode from 'vscode';

export module azdata{
    export namespace window{
        export interface Dialog extends ModelViewPanel {
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

			/**
			 * Register a callback that will be called when the user tries to click done. Only
			 * one callback can be registered at once, so each registration call will clear
			 * the previous registration.
			 * @param validator The callback that gets executed when the user tries to click
			 * done. Return true to allow the dialog to close or false to block it from closing
			 */
			registerCloseValidator(validator: () => boolean | Thenable<boolean>): void;
		}

        export function createModelViewDialog(title:string):Dialog {

        }
    }
}