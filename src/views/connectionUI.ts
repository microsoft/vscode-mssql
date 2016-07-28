'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import { RecentConnections } from '../models/recentConnections';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { IConnectionCredentials, IConnectionCredentialsQuickPickItem } from '../models/interfaces';

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
                        connectFunc = self.promptForRegisterConnection();
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

    private promptForRegisterConnection(): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            // called by async.js when all functions have finished executing
            let final = function(err, object, results): boolean {
                if (err) {
                    return false;
                } else {
                    resolve(results); // final connectionCreds with all the missing inputs filled in
                }
            };

            let connectionCreds: IConnectionCredentials = new ConnectionCredentials();

            // call each of these functions in a waterfall and pass parameters from one to the next
            // See this for more info: https://github.com/caolan/async#waterfall
            async.waterfall([
                async.apply(self.promptForServer, self, connectionCreds),
                self.promptForUsername,
                self.promptForPassword
            ], final);
        });
    }

    // Prompt user for missing details in the given IConnectionCredentials
    private promptForMissingInfo(connectionCreds: IConnectionCredentials): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            // called by async.js when all functions have finished executing
            let final = function(err, object, results): boolean {
                if (err) {
                    return false;
                } else {
                    resolve(results); // final connectionCreds with all the missing inputs filled in
                }
            };

            // call each of these functions in a waterfall and pass parameters from one to the next
            // See this for more info: https://github.com/caolan/async#waterfall
            async.waterfall([
                async.apply(self.promptForUsername, self, connectionCreds),
                self.promptForPassword
            ], final);
        });
    }

    // Helper to prompt for username
    private promptForServer(self: ConnectionUI, connectionCreds: IConnectionCredentials, callback): void {
        let inputOptions: vscode.InputBoxOptions = {placeHolder: Constants.serverPlaceholder, prompt: Constants.serverPrompt};
        self.promptForValue(self, connectionCreds, inputOptions, (c) => self.isNotEmpty(connectionCreds.server), (c, input) => c.server = input, callback);
    }

    // Helper to prompt for username
    private promptForUsername(self: ConnectionUI, connectionCreds: IConnectionCredentials, callback): void {
        let usernameInputOptions: vscode.InputBoxOptions = {placeHolder: Constants.usernamePlaceholder, prompt: Constants.usernamePrompt};
        self.promptForValue(self, connectionCreds, usernameInputOptions, (c) => self.isNotEmpty(connectionCreds.user), (c, input) => c.user = input, callback);
    }

    // Helper to prompt for password
    private promptForPassword(self: ConnectionUI, connectionCreds: IConnectionCredentials, callback): void {
        let passwordInputOptions: vscode.InputBoxOptions = {placeHolder: Constants.passwordPlaceholder, prompt: Constants.passwordPrompt, password: true};
        self.promptForValue(self, connectionCreds, passwordInputOptions,
            (c) => self.isNotEmpty(connectionCreds.password), (c, input) => c.password = input, callback);
    }

    private isNotEmpty(str: string): boolean {
        return (str && 0 !== str.length);
    }


    // Helper function that checks for any property on a credential object, and if missing prompts
    // the user to enter it. Handles cancelation by returning true for the err parameter
    private promptForValue(
        self: ConnectionUI,
        connectionCreds: IConnectionCredentials,
        inputOptions: vscode.InputBoxOptions,
        valueChecker: (c: IConnectionCredentials) => boolean,
        valueSetter: (c: IConnectionCredentials, input: any) => void,
        callback): void {

        if (valueChecker(connectionCreds)) {
            // we already have the required value - tell async.js to proceed to the next function
            callback(undefined, self, connectionCreds);
        } else {
            // we don't have the value, prompt the user to enter it
            self.promptUser(inputOptions)
            .then((input) => {
                if (input) {
                    valueSetter(connectionCreds, input);
                    callback(undefined, self, connectionCreds); // tell async.js to proceed to the next function
                } else {
                    // user cancelled - raise an error and abort the wizard
                    callback(true, self, connectionCreds);
                }
            });
        }
    }

    // Helper to prompt user for input
    // If the input is a mandatory input then keeps prompting the user until cancelled
    private promptUser(options: vscode.InputBoxOptions, mandatoryInput = true): Promise<string> {
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
}
