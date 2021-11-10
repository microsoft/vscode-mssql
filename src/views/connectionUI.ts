/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import { ConnectionCredentials } from '../models/connectionCredentials';
import ConnectionManager from '../controllers/connectionManager';
import { ConnectionStore } from '../models/connectionStore';
import { ConnectionProfile } from '../models/connectionProfile';
import { IConnectionProfile, IConnectionCredentialsQuickPickItem, CredentialsQuickPickItemType } from '../models/interfaces';
import { INameValueChoice, IQuestion, IPrompter, QuestionTypes } from '../prompts/question';
import { Timer } from '../models/utils';
import * as Utils from '../models/utils';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { ObjectExplorerUtils} from '../objectExplorer/objectExplorerUtils';
import { IFirewallIpAddressRange } from '../models/contracts/firewall/firewallRequest';
import { AccountStore } from '../azure/accountStore';
import { IAccount } from '../models/contracts/azure/accountInterfaces';
import providerSettings from '../azure/providerSettings';
import { IConnectionInfo } from 'vscode-mssql';

/**
 * The different tasks for managing connection profiles.
 */
enum ManageProfileTask {
    Create = 1,
    ClearRecentlyUsed,
    Edit,
    Remove
}

export interface ISqlProviderItem extends vscode.QuickPickItem {
    providerId: string;
}

export class ConnectionUI {
    private _errorOutputChannel: vscode.OutputChannel;

    constructor(
        private _connectionManager: ConnectionManager,
        private _context: vscode.ExtensionContext,
        private _connectionStore: ConnectionStore,
        private _accountStore: AccountStore,
        private _prompter: IPrompter,
        private _vscodeWrapper?: VscodeWrapper
        ) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
        this._errorOutputChannel = this._vscodeWrapper.createOutputChannel(LocalizedConstants.connectionErrorChannelName);
    }

    private get connectionManager(): ConnectionManager {
        return this._connectionManager;
    }

    /**
     * Exposed for testing purposes
     */
    public get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    /**
     * Exposed for testing purposes
     */
    public set vscodeWrapper(wrapper: VscodeWrapper) {
        this._vscodeWrapper = wrapper;
    }

    // Show connection errors in an output window
    public showConnectionErrors(errorMessages: string): void {
        this._errorOutputChannel.clear();
        this._errorOutputChannel.append(errorMessages);
        this._errorOutputChannel.show(true);
    }


    /**
     * Helper to let user choose a connection from a picklist, or to create a new connection.
     * Return the ConnectionInfo for the user's choice
     * @param ignoreFocusOut Whether to ignoreFocusOut on the quickpick prompt
     * @returns The connection picked or created.
     */
    public async promptForConnection(ignoreFocusOut = false): Promise<IConnectionInfo | undefined> {
        let picklist = this._connectionStore.getPickListItems();
        // We have recent connections - show them in a picklist
        const selection = await this.promptItemChoice({
            placeHolder: LocalizedConstants.recentConnectionsPlaceholder,
            matchOnDescription: true,
            ignoreFocusOut
        }, picklist);
        if (selection) {
            return this.handleSelectedConnection(selection);
        } else {
            return undefined;
        }
    }

    public promptLanguageFlavor(): Promise<string> {
        const self = this;
        return new Promise<string>((resolve, reject) => {
            let picklist: ISqlProviderItem[] = [
                {
                    label: LocalizedConstants.mssqlProviderName,
                    description: LocalizedConstants.flavorDescriptionMssql,
                    providerId: constants.mssqlProviderName
                },
                {
                    label: LocalizedConstants.noneProviderName,
                    description: LocalizedConstants.flavorDescriptionNone,
                    providerId: constants.noneProviderName
                }
            ];
            self.promptItemChoice({
                placeHolder: LocalizedConstants.flavorChooseLanguage,
                matchOnDescription: true
            }, picklist).then(selection => {
                if (selection) {
                    resolve(selection.providerId);
                } else {
                    resolve(undefined);
                }
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

    /**
     * Helper for waitForLanguageModeToBeSql() method.
     */
    private waitForLanguageModeToBeSqlHelper(resolve: any, timer: Timer): void {
        if (timer.getDuration() > constants.timeToWaitForLanguageModeChange) {
            resolve(false);
        } else if (this.vscodeWrapper.isEditingSqlFile) {
            resolve(true);
        } else {
            setTimeout(this.waitForLanguageModeToBeSqlHelper.bind(this, resolve, timer), 50);
        }
    }

    /**
     * Wait for up to 10 seconds for the language mode to change to SQL.
     */
    private waitForLanguageModeToBeSql(): Promise<boolean> {
        const self = this;
        return new Promise((resolve, reject) => {
            let timer: Timer = new Timer();
            timer.start();
            self.waitForLanguageModeToBeSqlHelper(resolve, timer);
        });
    }

    /**
     * Prompt the user if they would like to cancel connecting.
     */
    public promptToCancelConnection(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            let question: IQuestion = {
                type: QuestionTypes.confirm,
                name: LocalizedConstants.msgPromptCancelConnect,
                message: LocalizedConstants.msgPromptCancelConnect
            };
            self._prompter.promptSingle(question).then(result => {
                resolve(result ? true : false);
            }).catch(err => {
                resolve(false);
            });
        });
    }

    /**
     * Prompt the user for password
     */
    public promptForPassword(): Promise<string> {
        const self = this;
        return new Promise<string>((resolve, reject) => {
            let question: IQuestion = {
                type: QuestionTypes.password,
                name: LocalizedConstants.passwordPrompt,
                message: LocalizedConstants.passwordPrompt,
                placeHolder: LocalizedConstants.passwordPlaceholder
            };
            self._prompter.promptSingle(question).then((result: string) => {
                resolve(result);
            }).catch(err => {
                reject(err);
            });
        });
    }

    /**
     * Prompt the user to change language mode to SQL.
     * @returns resolves to true if the user changed the language mode to SQL.
     */
    public promptToChangeLanguageMode(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            let question: IQuestion = {
                type: QuestionTypes.confirm,
                name: LocalizedConstants.msgChangeLanguageMode,
                message: LocalizedConstants.msgChangeLanguageMode
            };
            self._prompter.promptSingle(question).then( value => {
                if (value) {
                    this._vscodeWrapper.executeCommand('workbench.action.editor.changeLanguageMode').then( () => {
                        self.waitForLanguageModeToBeSql().then( result => {
                            resolve(result);
                        });
                    });
                } else {
                    resolve(false);
                }
            }).catch( err => {
                resolve(false);
            });
        });
    }

    // Helper to let the user choose a database on the current server
    public showDatabasesOnCurrentServer(
        currentCredentials: IConnectionInfo,
        databaseNames: Array<string>): Promise<IConnectionInfo> {
        const self = this;
        return new Promise<IConnectionInfo>((resolve, reject) => {
            const pickListItems: vscode.QuickPickItem[] = databaseNames.map(name => {
                let newCredentials: IConnectionInfo = <any>{};
                Object.assign<IConnectionInfo, IConnectionInfo>(newCredentials, currentCredentials);
                if (newCredentials['profileName']) {
                    delete newCredentials['profileName'];
                }
                newCredentials.database = name;

                return <IConnectionCredentialsQuickPickItem> {
                    label: name,
                    description: '',
                    detail: '',
                    connectionCreds: newCredentials,
                    quickPickItemType: CredentialsQuickPickItemType.Mru
                };
            });

            // Add an option to disconnect from the current server
            const disconnectItem: vscode.QuickPickItem = {
                label: LocalizedConstants.disconnectOptionLabel,
                description: LocalizedConstants.disconnectOptionDescription
            };
            pickListItems.push(disconnectItem);

            const pickListOptions: vscode.QuickPickOptions = {
                placeHolder: LocalizedConstants.msgChooseDatabasePlaceholder
            };

            // show database picklist, and modify the current connection to switch the active database
            self.vscodeWrapper.showQuickPick<vscode.QuickPickItem>(pickListItems, pickListOptions).then( selection => {
                if (selection === disconnectItem) {
                    self.handleDisconnectChoice().then(() => resolve(undefined), err => reject(err));
                } else if (typeof selection !== 'undefined') {
                    resolve((selection as IConnectionCredentialsQuickPickItem).connectionCreds);
                } else {
                    resolve(undefined);
                }
            });
        });
    }

    private handleDisconnectChoice(): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            let question: IQuestion = {
                type: QuestionTypes.confirm,
                name: LocalizedConstants.disconnectConfirmationMsg,
                message: LocalizedConstants.disconnectConfirmationMsg
            };
            self._prompter.promptSingle<boolean>(question).then(result => {
                if (result === true) {
                    self.connectionManager.onDisconnect().then(() => resolve(), err => reject(err));
                } else {
                    resolve();
                }
            }, err => reject(err));
        });
    }

    public createProfileWithDifferentCredentials(connection: IConnectionInfo): Promise<IConnectionInfo> {

        return new Promise<IConnectionInfo>((resolve, reject) => {
            this.promptForRetryConnectWithDifferentCredentials().then(result => {
                if (result) {
                    let connectionWithoutCredentials = Object.assign({}, connection, { user: '', password: '', emptyPasswordInput: false });
                    ConnectionCredentials.ensureRequiredPropertiesSet(
                        connectionWithoutCredentials, // connection profile
                        true,                         // isProfile
                        false,                        // isPasswordRequired
                        true,                         // wasPasswordEmptyInConfigFile
                        this._prompter,
                        this._connectionStore, connection).then(connectionResult => {
                            resolve(connectionResult);
                        }, error => {
                            reject(error);
                        });

                } else {
                    resolve(undefined);
                }
            });
        });
    }

    private handleSelectedConnection(selection: IConnectionCredentialsQuickPickItem): Promise<IConnectionInfo> {
        const self = this;
        return new Promise<IConnectionInfo>((resolve, reject) => {
            if (selection !== undefined) {
                let connectFunc: Promise<IConnectionInfo>;
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
                }, err => reject(err));
            } else {
                resolve(undefined);
            }
        });
    }

    private promptToClearRecentConnectionsList(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            let question: IQuestion = {
                type: QuestionTypes.confirm,
                name: LocalizedConstants.msgPromptClearRecentConnections,
                message: LocalizedConstants.msgPromptClearRecentConnections
            };
            self._prompter.promptSingle(question).then(result => {
                resolve(result ? true : false);
            }).catch(err => {
                resolve(false);
            });
        });
    }

    public promptToManageProfiles(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            // Create profile, clear recent connections, edit profiles, or remove profile?
            let choices: INameValueChoice[] = [
                { name: LocalizedConstants.CreateProfileLabel, value: ManageProfileTask.Create },
                { name: LocalizedConstants.ClearRecentlyUsedLabel, value: ManageProfileTask.ClearRecentlyUsed},
                { name: LocalizedConstants.EditProfilesLabel, value: ManageProfileTask.Edit},
                { name: LocalizedConstants.RemoveProfileLabel, value: ManageProfileTask.Remove}
            ];

            let question: IQuestion = {
                type: QuestionTypes.expand,
                name: LocalizedConstants.ManageProfilesPrompt,
                message: LocalizedConstants.ManageProfilesPrompt,
                choices: choices,
                onAnswered: (value) => {
                    switch (value) {
                        case ManageProfileTask.Create:
                            self.connectionManager.onCreateProfile().then(result => {
                                resolve(result);
                            });
                            break;
                        case ManageProfileTask.ClearRecentlyUsed:
                            self.promptToClearRecentConnectionsList().then(result => {
                                if (result) {
                                    self.connectionManager.clearRecentConnectionsList().then(() => {
                                        self.vscodeWrapper.showInformationMessage(LocalizedConstants.msgClearedRecentConnections);
                                        resolve(true);
                                    });
                                } else {
                                    resolve(false);
                                }
                            });
                            break;
                        case ManageProfileTask.Edit:
                            self.vscodeWrapper.executeCommand('workbench.action.openGlobalSettings').then( () => {
                                resolve(true);
                            });
                            break;
                        case ManageProfileTask.Remove:
                            self.connectionManager.onRemoveProfile().then(result => {
                                resolve(result);
                            });
                            break;
                        default:
                            resolve(false);
                            break;
                    }
                }
            };

            this._prompter.promptSingle(question);
        });
    }

    /**
     * Calls the create profile workflow
     * @param validate whether the profile should be connected to and validated before saving
     * @returns undefined if profile creation failed
     */
    public createAndSaveProfile(validate: boolean = true): Promise<IConnectionProfile> {
        let self = this;
        return self.promptForCreateProfile()
            .then(profile => {
                if (profile) {
                    if (validate) {
                        // Validate the profile before saving
                        return self.validateAndSaveProfile(profile);
                    } else {
                        // Save the profile without validation
                        return self.saveProfile(profile);
                    }
                }
                return undefined;
            }).then(savedProfile => {
                if (savedProfile) {
                    if (validate) {
                        self.vscodeWrapper.showInformationMessage(LocalizedConstants.msgProfileCreatedAndConnected);
                    } else {
                        self.vscodeWrapper.showInformationMessage(LocalizedConstants.msgProfileCreated);
                    }
                }
                return savedProfile;
            });
    }

    /**
     * Validate a connection profile by connecting to it, and save it if we are successful.
     */
    public validateAndSaveProfile(profile: IConnectionProfile): Promise<IConnectionProfile> {
        const self = this;
        let uri = self.vscodeWrapper.activeTextEditorUri;
        if (!uri || !self.vscodeWrapper.isEditingSqlFile) {
            uri = ObjectExplorerUtils.getNodeUriFromProfile(profile);
        }
        return self.connectionManager.connect(uri, profile).then(async (result) => {
            if (result) {
                // Success! save it
                return self.saveProfile(profile);
            } else {
                // Check whether the error was for firewall rule or not
                if (self.connectionManager.failedUriToFirewallIpMap.has(uri)) {
                    // Firewall rule error
                    const clientIp = this.connectionManager.failedUriToFirewallIpMap.get(uri);
                    let success = await this.handleFirewallError(uri, profile, clientIp);
                    if (success) {
                        // Retry creating the profile if firewall rule
                        // was successful
                        self.connectionManager.failedUriToFirewallIpMap.delete(uri);
                        return self.validateAndSaveProfile(profile);
                    }
                    return undefined;
                } else {
                    // Normal connection error! Let the user try again, prefilling values that they already entered
                    return self.promptToRetryAndSaveProfile(profile);
                }
            }
        });
    }

    /**
     * Method to handle a firewall error. Returns true if a firewall rule was successfully added, and
     * false otherwise
     */
    public async handleFirewallError(uri: string, profile: IConnectionProfile, ipAddress: string): Promise<boolean> {
        // TODO: Access account which firewall error needs to be added from:
        // Try to match accountId to an account in account storage
        if (profile.accountId) {
            let account = this._accountStore.getAccount(profile.accountId);
            this.connectionManager.accountService.setAccount(account);
            // take that account from account storage and refresh tokens and create firewall rule
        } else {
            // If no match or no accountId present, need to add an azure account
            let selection = await this._vscodeWrapper.showInformationMessage(LocalizedConstants.msgPromptRetryFirewallRuleNotSignedIn,
                LocalizedConstants.azureAddAccount);
            if (selection === LocalizedConstants.azureAddAccount) {
                profile = await this.connectionManager.azureController.getTokens(profile, this._accountStore,
                    providerSettings.resources.azureManagementResource);
            }
            let account = this._accountStore.getAccount(profile.accountId);
            this.connectionManager.accountService.setAccount(account);

        }
        let success = await this.createFirewallRule(profile, profile.server, ipAddress);
        return success;
    }

    /**
     * Save a connection profile using the connection store
     */
    private saveProfile(profile: IConnectionProfile): Promise<IConnectionProfile> {
        return this._connectionStore.saveProfile(profile);
    }

    private promptForCreateProfile(): Promise<IConnectionProfile> {
        return ConnectionProfile.createProfile(this._prompter, this._connectionStore, this._context,
            this.connectionManager.azureController, this._accountStore);
    }

    private async promptToRetryAndSaveProfile(profile: IConnectionProfile, isFirewallError: boolean = false): Promise<IConnectionProfile> {
        const updatedProfile = await this.promptForRetryCreateProfile(profile, isFirewallError);
        if (updatedProfile) {
            return this.validateAndSaveProfile(updatedProfile);
        } else {
            return undefined;
        }
    }

    public async promptForRetryCreateProfile(profile: IConnectionProfile, isFirewallError: boolean = false): Promise<IConnectionProfile> {
        // Ask if the user would like to fix the profile
        let errorMessage = isFirewallError ? LocalizedConstants.msgPromptRetryFirewallRuleAdded : LocalizedConstants.msgPromptRetryCreateProfile;
        return this._vscodeWrapper.showErrorMessage(errorMessage, LocalizedConstants.retryLabel).then(result => {
            if (result === LocalizedConstants.retryLabel) {
                return ConnectionProfile.createProfile(this._prompter, this._connectionStore, this._context,
                    this.connectionManager.azureController, this._accountStore, profile);
            } else {
                return undefined;
            }
        });
    }

    private async promptForIpAddress(startIpAddress: string): Promise<IFirewallIpAddressRange> {
        let questions: IQuestion[] = [
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.startIpAddressPrompt,
                message: LocalizedConstants.startIpAddressPrompt,
                placeHolder: startIpAddress,
                default: startIpAddress,
                validate: (value: string) => {
                    if (!Number.parseFloat(value) || !value.match(constants.ipAddressRegex)) {
                        return LocalizedConstants.msgInvalidIpAddress;
                    }
                }
            },
            {
                type: QuestionTypes.input,
                name: LocalizedConstants.endIpAddressPrompt,
                message: LocalizedConstants.endIpAddressPrompt,
                placeHolder: startIpAddress,
                validate: (value: string) => {
                    if (!Number.parseFloat(value) || !value.match(constants.ipAddressRegex) ||
                        (Number.parseFloat(value) > Number.parseFloat(startIpAddress))) {
                        return LocalizedConstants.msgInvalidIpAddress;
                    }
                },
                default: startIpAddress
            }
        ];

        // Prompt and return the value if the user confirmed
        return this._prompter.prompt(questions).then((answers: { [questionId: string ]: string}) => {
            if (answers) {
                let result: IFirewallIpAddressRange = {
                    startIpAddress: answers[LocalizedConstants.startIpAddressPrompt] ?
                        answers[LocalizedConstants.startIpAddressPrompt] : startIpAddress,
                    endIpAddress: answers[LocalizedConstants.endIpAddressPrompt] ?
                        answers[LocalizedConstants.endIpAddressPrompt] : startIpAddress
                };
                return result;
            }
        });
    }

    private async createFirewallRule(profile: IConnectionProfile, serverName: string, ipAddress: string, account?: IAccount): Promise<boolean> {
        return this._vscodeWrapper.showInformationMessage(LocalizedConstants.msgPromptRetryFirewallRuleSignedIn,
            LocalizedConstants.createFirewallRuleLabel).then(async (result) => {
            if (result === LocalizedConstants.createFirewallRuleLabel) {
                const firewallService = this.connectionManager.firewallService;
                let ipRange = await this.promptForIpAddress(ipAddress);
                if (ipRange) {
                    let firewallResult = await firewallService.createFirewallRule(serverName, ipRange.startIpAddress, ipRange.endIpAddress);
                    if (firewallResult.result) {
                        this._vscodeWrapper.showInformationMessage(LocalizedConstants.msgPromptFirewallRuleCreated);
                        return true;
                    } else {
                        Utils.showErrorMsg(firewallResult.errorMessage);
                        return false;
                    }
                } else {
                    return false;
                }
            } else {
                return false;
            }
        });
    }

    private promptForRetryConnectWithDifferentCredentials(): PromiseLike<boolean> {
        // Ask if the user would like to fix the profile
        return this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgPromptRetryConnectionDifferentCredentials
            , LocalizedConstants.retryLabel).then(result => {
                if (result === LocalizedConstants.retryLabel) {
                    return true;
                } else {
                    return false;
                }
            });
    }

    private fillOrPromptForMissingInfo(selection: IConnectionCredentialsQuickPickItem): Promise<IConnectionInfo> {
        // If a connection string is present, don't prompt for any other info
        if (selection.connectionCreds.connectionString) {
            return new Promise<IConnectionInfo> ((resolve, reject) => {
                resolve(selection.connectionCreds);
            });
        }

        const passwordEmptyInConfigFile: boolean = Utils.isEmpty(selection.connectionCreds.password);
        return this._connectionStore.addSavedPassword(selection)
            .then(sel => {
                return ConnectionCredentials.ensureRequiredPropertiesSet(
                    sel.connectionCreds,
                    selection.quickPickItemType === CredentialsQuickPickItemType.Profile,
                    false,
                    passwordEmptyInConfigFile,
                    this._prompter,
                    this._connectionStore);
            });
    }

    // Prompts the user to pick a profile for removal, then removes from the global saved state
    public removeProfile(): Promise<boolean> {
        let self = this;

        // Flow: Select profile to remove, confirm removal, remove, notify
        let profiles = self._connectionStore.getProfilePickListItems(false);
        return self.selectProfileForRemoval(profiles)
            .then(profile => {
                if (profile) {
                    return self._connectionStore.removeProfile(profile);
                }
                return false;
            }).then(result => {
                if (result) {
                    // TODO again consider moving information prompts to the prompt package
                    this._vscodeWrapper.showInformationMessage(LocalizedConstants.msgProfileRemoved);
                }
                return result;
            });
    }

    private selectProfileForRemoval(profiles: IConnectionCredentialsQuickPickItem[]): Promise<IConnectionProfile> {
        let self = this;
        if (!profiles || profiles.length === 0) {
            // Inform the user we have no profiles available for deletion
            // TODO: consider moving to prompter if we separate all UI logic from workflows in the future
            this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgNoProfilesSaved);
            return Promise.resolve(undefined);
        }

        let chooseProfile = 'ChooseProfile';
        let confirm = 'ConfirmRemoval';
        let questions: IQuestion[] = [
            {
                // 1: what profile should we remove?
                type: QuestionTypes.expand,
                name: chooseProfile,
                message: LocalizedConstants.msgSelectProfileToRemove,
                matchOptions: { matchOnDescription: true },
                choices: profiles
            },
            {
                // 2: Confirm removal before proceeding
                type: QuestionTypes.confirm,
                name: confirm,
                message: LocalizedConstants.confirmRemoveProfilePrompt
            }
        ];

        // Prompt and return the value if the user confirmed
        return self._prompter.prompt(questions).then(answers => {
            if (answers && answers[confirm]) {
                let profilePickItem = <IConnectionCredentialsQuickPickItem> answers[chooseProfile];
                return <IConnectionProfile> profilePickItem.connectionCreds;
            } else {
                return undefined;
            }
        });
    }
}
