'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import { RecentConnections } from '../models/recentConnections';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ConnectionProfile } from '../models/connectionProfile';
import { PropertyUpdater } from '../models/propertyUpdater';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem } from '../models/interfaces';

let async = require('async');

export class ConnectionUI {
    // Helper to let user choose a connection from a picklist
    // Return the ConnectionInfo for the user's choice
    public showConnections(): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            let recentConnections = new RecentConnections();
            recentConnections.getPickListItems()
            .then((picklist: IConnectionCredentialsQuickPickItem[]) => {
                if (picklist.length === 0) {
                    // No recent connections - prompt to open user settings or workspace settings to add a connection
                    self.openUserOrWorkspaceSettings();
                    return false;
                } else {
                    // We have recent connections - show them in a picklist
                    self.showConnectionsPickList(picklist)
                    .then(selection => {
                        if (!selection) {
                            return false;
                        }
                        resolve(selection);
                    });
                }
            });
        });
    }

    // Helper to prompt user to open VS Code user settings or workspace settings
    private openUserOrWorkspaceSettings(): void {
        let openGlobalSettingsItem: vscode.MessageItem = {
            'title': Constants.labelOpenGlobalSettings
        };

        let openWorkspaceSettingsItem: vscode.MessageItem = {
            'title': Constants.labelOpenWorkspaceSettings
        };

        vscode.window.showWarningMessage(Constants.extensionName
                                         + ': '
                                         + Constants.msgNoConnectionsInSettings, openGlobalSettingsItem, openWorkspaceSettingsItem)
        .then((selectedItem: vscode.MessageItem) => {
            if (selectedItem === openGlobalSettingsItem) {
                vscode.commands.executeCommand('workbench.action.openGlobalSettings');
            } else if (selectedItem === openWorkspaceSettingsItem) {
                vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
            }
        });
    }

    // Helper to let user choose a connection from a picklist
    private showConnectionsPickList(pickList: IConnectionCredentialsQuickPickItem[]): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            // init picklist options
            let opts: vscode.QuickPickOptions = {
                matchOnDescription: true,
                placeHolder: Constants.recentConnectionsPlaceholder
            };

            // show picklist
            vscode.window.showQuickPick(pickList, opts)
            .then(selection => {
                if (selection !== undefined) {
                    let connectFunc: Promise<IConnectionCredentials>;
                    if (selection.isNewConnectionQuickPickItem) {
                        // call the workflow to create a new connection
                        connectFunc = self.promptForRegisterConnection(true);
                    } else {
                        // user chose a connection from picklist. Prompt for mandatory info that's missing (e.g. username and/or password)
                        let connectionCreds = selection.connectionCreds;
                        connectFunc = self.promptForMissingInfo(connectionCreds);
                    }

                    connectFunc.then((resolvedConnectionCreds) => {
                        if (!resolvedConnectionCreds) {
                            return false;
                        }
                        resolve(resolvedConnectionCreds);
                    });

                }
            });
        });
    }

    private promptForRegisterConnection(isPasswordRequired: boolean): Promise<IConnectionProfile> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            let connectionCreds: ConnectionProfile = new ConnectionProfile();
            // called by async.js when all functions have finished executing
            let final = function(err): boolean {
                if (err) {
                    return false;
                } else {
                    resolve(connectionCreds); // final connectionCreds with all the missing inputs filled in
                }
            };

            // For each property that needs to be set, prompt for the required value and update the credentials
            // As this
            // See this for more info: http://caolan.github.io/async/docs.html#.each
            async.eachSeries(ConnectionProfile.getCreateProfileSteps(isPasswordRequired), function(propertyUpdater, callback): void {
                self.promptForValue(self, connectionCreds, propertyUpdater, callback);
            }, final);
        });
    }

    // Prompt user for missing details in the given IConnectionCredentials
    private promptForMissingInfo(connectionCreds: IConnectionCredentials): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            // called by async.js when all functions have finished executing
            let final = function(err): boolean {
                if (err) {
                    return false;
                } else {
                    resolve(connectionCreds); // final connectionCreds with all the missing inputs filled in
                }
            };

            // For each property that needs to be set, prompt for the required value and update the credentials
            // As this
            // See this for more info: http://caolan.github.io/async/docs.html#.each
            async.each(ConnectionCredentials.getUsernameAndPasswordCredentialUpdaters(true), function(propertyUpdater, callback): void {
                self.promptForValue(self, connectionCreds, propertyUpdater, callback);
            }, final);
        });
    }

    // Helper function that checks for any property on a credential object, and if missing prompts
    // the user to enter it. Handles cancelation by returning true for the err parameter
    // Note: callback is an error handler that cancels if a non-null or empty value is passed
    private promptForValue(
        self: ConnectionUI,
        connectionCreds: IConnectionCredentials,
        propertyUpdater: PropertyUpdater<IConnectionCredentials>,
        callback): void {

        if (propertyUpdater.isUpdateRequired(connectionCreds)) {
            // we don't have the value, prompt the user to enter it
            self.promptForInput(propertyUpdater.inputBoxOptions)
            .then((input) => {
                if (input) {
                    propertyUpdater.updatePropery(connectionCreds, input);
                    callback(undefined); // tell async.js to proceed to the next function
                } else {
                    // user cancelled - raise an error and abort the wizard
                    callback(true);
                }
            });
        } else {
            // we already have the required value - tell async.js to proceed to the next function
            callback(undefined);
        }
    }

    // Helper to prompt user for input
    // If the input is a mandatory input then keeps prompting the user until cancelled
    private promptForInput(options: vscode.InputBoxOptions, mandatoryInput = true): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let prompt = () => {
                vscode.window.showInputBox(options).then((input) => {
                    if (input === undefined) {
                        // The return value is undefined if the message was canceled.
                        // need to separate from empty string (which means it might be required)
                        return false;
                    }
                    if ((!input || !input.trim()) && mandatoryInput) {
                        // Prompt user to re-enter if this is a mandatory input
                        vscode.window.showWarningMessage(options.prompt + Constants.msgIsRequired, Constants.msgRetry).then((choice) => {
                            if (choice === Constants.msgRetry) {
                                prompt();
                            }
                        });
                        return false;
                    } else {
                        resolve(input);
                    }
                });
            };
            prompt();
        });
    }

    // Helper to prompt user to select a quick pick item
    // If the selection is mandatory then keeps prompting the user until cancelled
    // private promptForQuickPick(
    //     items: vscode.QuickPickItem[],
    //     options: vscode.QuickPickOptions = undefined,
    //     mandatoryInput = true): Promise<vscode.QuickPickItem> {
    //     return new Promise<vscode.QuickPickItem>((resolve, reject) => {
    //         let prompt = () => {
    //             vscode.window.showQuickPick(items, options).then((item) => {
    //                 if (item === undefined) {
    //                     // The return value is undefined if the message was canceled.
    //                     // need to separate from empty string (which means it might be required)
    //                     return false;
    //                 }
    //                 if ((!item) && mandatoryInput) {
    //                     // Prompt user to re-enter if this is a mandatory input
    //                     vscode.window.showWarningMessage(Constants.msgSelectionIsRequired, Constants.msgRetry).then((choice) => {
    //                         if (choice === Constants.msgRetry) {
    //                             prompt();
    //                         }
    //                     });
    //                     return false;
    //                 } else {
    //                     resolve(item);
    //                 }
    //             });
    //         };
    //         prompt();
    //     });
    // }
}
