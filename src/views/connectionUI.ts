'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import { RecentConnections } from '../models/recentConnections';
import Interfaces = require('../models/interfaces');

let async = require('async');
const mssql = require('mssql');

export class ConnectionUI {
    // Helper to let user choose a connection from a picklist
    // Return the ConnectionInfo for the user's choice
    public showConnections(): Promise<Interfaces.IConnectionCredentials> {
        const self = this;
        return new Promise<Interfaces.IConnectionCredentials>((resolve, reject) => {
            let recentConnections = new RecentConnections();
            recentConnections.getPickListItems()
            .then((picklist: Interfaces.IConnectionCredentialsQuickPickItem[]) => {
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

    // Helper to let the user choose a database on the current server
    // TODO: refactor this to use the service layer/SMO once the plumbing/conversion is complete
    public showDatabasesOnCurrentServer(currentCredentials: Interfaces.IConnectionCredentials): Promise<Interfaces.IConnectionCredentials> {
        const self = this;
        return new Promise<Interfaces.IConnectionCredentials>((resolve, reject) => {
            // create a new connection to the master db using the current connection as a base
            let masterCredentials: Interfaces.IConnectionCredentials = <any>{};
            Object.assign<Interfaces.IConnectionCredentials, Interfaces.IConnectionCredentials>(masterCredentials, currentCredentials);
            masterCredentials.database = 'master';
            const masterConnection = new mssql.Connection(masterCredentials);

            masterConnection.connect().then( () => {
                // query sys.databases for a list of databases on the server
                new mssql.Request(masterConnection).query('SELECT name FROM sys.databases').then( recordset => {
                    const pickListItems = recordset.map(record => {
                        let newCredentials: Interfaces.IConnectionCredentials = <any>{};
                        Object.assign<Interfaces.IConnectionCredentials, Interfaces.IConnectionCredentials>(newCredentials, currentCredentials);
                        newCredentials.database = record.name;

                        return <Interfaces.IConnectionCredentialsQuickPickItem> {
                            label: record.name,
                            description: '',
                            detail: '',
                            connectionCreds: newCredentials
                        };
                    });

                    const pickListOptions: vscode.QuickPickOptions = {
                        placeHolder: Constants.msgChooseDatabasePlaceholder
                    };

                    // show database picklist, and modify the current connection to switch the active database
                    vscode.window.showQuickPick<Interfaces.IConnectionCredentialsQuickPickItem>(pickListItems, pickListOptions).then( selection => {
                        if (typeof selection !== 'undefined') {
                            resolve(selection.connectionCreds);
                        } else {
                            resolve(undefined);
                        }
                    });
                }).catch( err => {
                    reject(err);
                });
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
    private showConnectionsPickList(pickList: Interfaces.IConnectionCredentialsQuickPickItem[]): Promise<Interfaces.IConnectionCredentials> {
        const self = this;
        return new Promise<Interfaces.IConnectionCredentials>((resolve, reject) => {
            // init picklist options
            let opts: vscode.QuickPickOptions = {
                matchOnDescription: true,
                placeHolder: Constants.recentConnectionsPlaceholder
            };

            // show picklist
            vscode.window.showQuickPick(pickList, opts)
            .then(selection => {
                if (selection !== undefined) {
                    // user chose a connection from picklist. Prompt for mandatory info that's missing (e.g. username and/or password)
                    let connectionCreds = selection.connectionCreds;
                    self.promptForMissingInfo(connectionCreds).then((resolvedConnectionCreds) => {
                        if (!resolvedConnectionCreds) {
                            return false;
                        }
                        resolve(resolvedConnectionCreds);
                    });
                }
            });
        });
    }

    // Prompt user for missing details in the given IConnectionCredentials
    private promptForMissingInfo(connectionCreds: Interfaces.IConnectionCredentials): Promise<Interfaces.IConnectionCredentials> {
        const self = this;
        return new Promise<Interfaces.IConnectionCredentials>((resolve, reject) => {
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
    private promptForUsername(self, connectionCreds: Interfaces.IConnectionCredentials, callback): void {
        if (connectionCreds.user) {
            // we already have a username - tell async.js to proceed to the next function
            callback(undefined, self, connectionCreds);
        } else {
            // we don't have a username, prompt the user to enter it
            let usernameInputOptions: vscode.InputBoxOptions = {placeHolder: Constants.usernamePlaceholder, prompt: Constants.usernamePrompt};
            self.promptUser(usernameInputOptions)
            .then((input) => {
                if (input) {
                    connectionCreds.user = input;
                    callback(undefined, self, connectionCreds); // tell async.js to proceed to the next function
                } else {
                    // user cancelled - raise an error and abort the wizard
                    callback(true, self, connectionCreds);
                }
            });
        }
    }

    // Helper to prompt for password
    private promptForPassword(self, connectionCreds: Interfaces.IConnectionCredentials, callback): void {
        if (connectionCreds.password) {
            // we already have a password - tell async.js to proceed to the next function
            callback(undefined, self, connectionCreds);
        } else {
            // we don't have a password, prompt the user to enter it
            let passwordInputOptions: vscode.InputBoxOptions = {placeHolder: Constants.passwordPlaceholder, prompt: Constants.passwordPrompt, password: true};
            self.promptUser(passwordInputOptions)
            .then((input) => {
                if (input) {
                    connectionCreds.password = input;
                    callback(undefined, self, connectionCreds); // tell async.js to proceed to the next function
                } else {
                    // user cancelled - raise an error and abort the wizard
                    callback(true, self, connectionCreds);
                }
            });
        }
    }

    // Helper to prompt user for input
    // If the input is a mandatory inout then keeps prompting the user until cancelled
    // private promptUser(options: vscode.InputBoxOptions, mandatoryInput = true): Promise<string> {
    //     return new Promise<string>((resolve, reject) => {
    //         let prompt = () => {
    //             vscode.window.showInputBox(options).then((input) => {
    //                 if ((!input || !input.trim()) && mandatoryInput) {
    //                     // Prompt user to re-enter if this is a mandatory input
    //                     vscode.window.showWarningMessage(options.prompt + Constants.gMsgIsRequired, Constants.gMsgRetry).then((choice) => {
    //                         if (choice === Constants.gMsgRetry) {
    //                             prompt();
    //                         }
    //                     });
    //                     return false;
    //                 } else {
    //                     resolve(input);
    //                 }
    //             });
    //         };
    //         prompt();
    //     });
    // }
}
