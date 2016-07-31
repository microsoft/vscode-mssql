'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import { RecentConnections } from '../models/recentConnections';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ConnectionProfile } from '../models/connectionProfile';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem } from '../models/interfaces';
import { IPrompter } from '../prompts/question';

export class ConnectionUI {
    private _prompter: IPrompter;

    constructor(prompter: IPrompter) {
        this._prompter = prompter;
    }

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
        return ConnectionProfile.createProfile(this._prompter);
    }

    // Prompt user for missing details in the given IConnectionCredentials
    private promptForMissingInfo(credentials: IConnectionCredentials): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            ConnectionCredentials.ensureRequiredPropertiesSet(credentials, false, self._prompter, (answers) => resolve(credentials));
        });
    }
}
