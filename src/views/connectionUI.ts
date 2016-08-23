'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ConnectionStore } from '../models/connectionStore';
import { ConnectionProfile } from '../models/connectionProfile';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem, CredentialsQuickPickItemType } from '../models/interfaces';
import { IQuestion, IPrompter, QuestionTypes } from '../prompts/question';
import Interfaces = require('../models/interfaces');

// let async = require('async');
const mssql = require('mssql');

export class ConnectionUI {
    constructor(private _connectionStore: ConnectionStore, private _prompter: IPrompter) {
    }

    // Helper to let user choose a connection from a picklist
    // Return the ConnectionInfo for the user's choice
    public showConnections(): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            self._connectionStore.getPickListItems()
            .then((picklist: IConnectionCredentialsQuickPickItem[]) => {
                return new Promise<IConnectionCredentials>(() => {
                    if (picklist.length === 0) {
                        // No recent connections - prompt to open user settings or workspace settings to add a connection
                        self.openUserOrWorkspaceSettings();
                        return false;
                    } else {
                        // We have recent connections - show them in a picklist
                        return self.promptItemChoice({
                            placeHolder: Constants.recentConnectionsPlaceholder,
                            matchOnDescription: true
                        }, picklist)
                            .then(selection => {
                                resolve(self.handleSelectedConnection(selection));
                            });
                    }
                });
            });
        });
    }

    // requests the user to choose an item from the list
    private promptItemChoice<T extends vscode.QuickPickItem>(options: vscode.QuickPickOptions, choices: T[]): Promise<T> {
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: 'question',
            message: options.placeHolder,
            matchOptions: options,
            choices: choices
        };
        return this._prompter.promptSingle(question);
    }

    // Helper to let the user choose a database on the current server
    // TODO: refactor this to use the service layer/SMO once the plumbing/conversion is complete
    public showDatabasesOnCurrentServer(currentCredentials: Interfaces.IConnectionCredentials): Promise<Interfaces.IConnectionCredentials> {
        // const self = this;
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
                            connectionCreds: newCredentials,
                            quickPickItemType: CredentialsQuickPickItemType.Mru
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

    private handleSelectedConnection(selection: IConnectionCredentialsQuickPickItem): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            if (selection !== undefined) {
                let connectFunc: Promise<IConnectionCredentials>;
                if (selection.quickPickItemType === CredentialsQuickPickItemType.NewConnection) {
                    // call the workflow to create a new connection
                    connectFunc = self.createAndSaveProfile();
                } else {
                    // user chose a connection from picklist. Prompt for mandatory info that's missing (e.g. username and/or password)
                    connectFunc = self.fillOrPromptForMissingInfo(selection);
                }

                connectFunc.then((resolvedConnectionCreds) => {
                    if (!resolvedConnectionCreds) {
                        resolve(undefined);
                    }
                    resolve(resolvedConnectionCreds);
                });
            }
        });
    }

    // Calls the create profile workflow
    // Returns undefined if profile creation failed
    public createAndSaveProfile(): Promise<IConnectionProfile> {
        let self = this;
        return self.promptForCreateProfile()
            .then(profile => {
                if (profile) {
                    return self._connectionStore.saveProfile(profile);
                }
                return undefined;
            });
    }

    private promptForCreateProfile(): Promise<IConnectionProfile> {
        return ConnectionProfile.createProfile(this._prompter);
    }

    private fillOrPromptForMissingInfo(selection: IConnectionCredentialsQuickPickItem): Promise<IConnectionCredentials> {
        return this._connectionStore.addSavedPassword(selection).then(sel => {
            return ConnectionCredentials.ensureRequiredPropertiesSet(sel.connectionCreds, false, this._prompter);
        });
    }

    // Prompts the user to pick a profile for removal, then removes from the global saved state
    public removeProfile(): Promise<boolean> {
        let self = this;

        // Flow: Select profile to remove, confirm removal, remove
        return self._connectionStore.getProfilePickListItems()
            .then(profiles => self.selectProfileForRemoval(profiles))
            .then(profile => {
                if (profile) {
                    let result = self._connectionStore.removeProfile(profile);
                    if (result) {
                        // TODO again consider moving information prompts to the prompt package
                        vscode.window.showInformationMessage(Constants.msgProfileRemoved);
                    }
                    return result;
                }
                return false;
            });
    }

    private selectProfileForRemoval(profiles: IConnectionCredentialsQuickPickItem[]): Promise<IConnectionProfile> {
        let self = this;
        if (!profiles) {
            // Inform the user we have no profiles available for deletion
            // TODO: consider moving to prompter if we separate all UI logic from workflows in the future
            vscode.window.showErrorMessage(Constants.msgNoProfilesSaved);
            return Promise.resolve(undefined);
        }

        let chooseProfile = 'ChooseProfile';
        let confirm = 'ConfirmRemoval';
        let questions: IQuestion[] = [
            {
                // 1: what profile should we remove?
                type: QuestionTypes.expand,
                name: chooseProfile,
                message: Constants.msgSelectProfileToRemove,
                matchOptions: { matchOnDescription: true },
                choices: profiles
            },
            {
                // 2: Confirm removal before proceeding
                type: QuestionTypes.confirm,
                name: confirm,
                message: Constants.confirmRemoveProfilePrompt
            }
        ];

        // Prompt and return the value if the user confirmed
        return self._prompter.prompt(questions).then(answers => {
            if (answers[confirm]) {
                let profilePickItem = <IConnectionCredentialsQuickPickItem> answers[chooseProfile];
                return profilePickItem.connectionCreds;
            } else {
                return undefined;
            }
        });
    }
}
