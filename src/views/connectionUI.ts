'use strict';
import vscode = require('vscode');
import Constants = require('../models/constants');
import { RecentConnections } from '../models/recentConnections';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { ConnectionProfile } from '../models/connectionProfile';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem } from '../models/interfaces';
import { IQuestion, IPrompter, QuestionTypes } from '../prompts/question';
import Interfaces = require('../models/interfaces');
import VscodeWrapper from '../controllers/vscodeWrapper';

export class ConnectionUI {
    private _context: vscode.ExtensionContext;
    private _prompter: IPrompter;
    private _errorOutputChannel: vscode.OutputChannel;
    private _vscodeWrapper: VscodeWrapper;

    constructor(context: vscode.ExtensionContext, prompter: IPrompter, wrapper?: VscodeWrapper) {
        this._context = context;
        this._prompter = prompter;
        this._errorOutputChannel = vscode.window.createOutputChannel(Constants.connectionErrorChannelName);
        if (wrapper) {
            this.vscodeWrapper = wrapper;
        } else {
            this.vscodeWrapper = new VscodeWrapper();
        }
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    // Show connection errors in an output window
    public showConnectionErrors(errorMessages: string): void {
        this._errorOutputChannel.clear();
        this._errorOutputChannel.append(errorMessages);
        this._errorOutputChannel.show(true);
    }

    // Helper to let user choose a connection from a picklist
    // Return the ConnectionInfo for the user's choice
    public showConnections(): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            let recentConnections = new RecentConnections(self._context);
            recentConnections.getPickListItems()
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
                                resolve(self.handleSelectedConnection(selection, recentConnections));
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
    public showDatabasesOnCurrentServer(currentCredentials: Interfaces.IConnectionCredentials,
                                        databaseNames: Array<string>): Promise<Interfaces.IConnectionCredentials> {
        const self = this;
        return new Promise<Interfaces.IConnectionCredentials>((resolve, reject) => {
            const pickListItems = databaseNames.map(name => {
                let newCredentials: Interfaces.IConnectionCredentials = <any>{};
                Object.assign<Interfaces.IConnectionCredentials, Interfaces.IConnectionCredentials>(newCredentials, currentCredentials);
                newCredentials.database = name;

                return <Interfaces.IConnectionCredentialsQuickPickItem> {
                    label: name,
                    description: '',
                    detail: '',
                    connectionCreds: newCredentials,
                    isNewConnectionQuickPickItem: false
                };
            });

            const pickListOptions: vscode.QuickPickOptions = {
                placeHolder: Constants.msgChooseDatabasePlaceholder
            };

            // show database picklist, and modify the current connection to switch the active database
            self.vscodeWrapper.showQuickPick<Interfaces.IConnectionCredentialsQuickPickItem>(pickListItems, pickListOptions).then( selection => {
                if (typeof selection !== 'undefined') {
                    resolve(selection.connectionCreds);
                } else {
                    resolve(undefined);
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

    private handleSelectedConnection(selection: IConnectionCredentialsQuickPickItem, recentConnections: RecentConnections): Promise<IConnectionCredentials> {
        const self = this;
        return new Promise<IConnectionCredentials>((resolve, reject) => {
            if (selection !== undefined) {
                let connectFunc: Promise<IConnectionCredentials>;
                if (selection.isNewConnectionQuickPickItem) {
                    // call the workflow to create a new connection
                    connectFunc = self.createAndSaveProfile();
                } else {
                    // user chose a connection from picklist. Prompt for mandatory info that's missing (e.g. username and/or password)
                    let connectionCreds = selection.connectionCreds;
                    connectFunc = self.promptForMissingInfo(connectionCreds);
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
        let recentConnections = new RecentConnections(this._context);
        return this.promptForCreateProfile()
            .then(profile => {
                if (profile) {
                    return recentConnections.saveConnection(profile);
                }
                return undefined;
            });
    }

    private promptForCreateProfile(): Promise<IConnectionProfile> {
        return ConnectionProfile.createProfile(this._prompter);
    }

    // Prompt user for missing details in the given IConnectionCredentials
    private promptForMissingInfo(credentials: IConnectionCredentials): Promise<IConnectionCredentials> {
        return ConnectionCredentials.ensureRequiredPropertiesSet(credentials, false, this._prompter);
    }

    // Prompts the user to pick a profile for removal, then removes from the global saved state
    public removeProfile(): Promise<boolean> {
        let self = this;
        let recentConnections = new RecentConnections(self._context);

        // Flow: Select profile to remove, confirm removal, remove
        return recentConnections.getProfilePickListItems()
            .then(profiles => self.selectProfileForRemoval(profiles))
            .then(profile => {
                if (profile) {
                    let result = recentConnections.removeProfile(profile);
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
                message: Constants.msgSelectProfile,
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
