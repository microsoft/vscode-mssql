/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { IAccount, IConnectionInfo } from "vscode-mssql";
import { AccountStore } from "../azure/accountStore";
import * as constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import ConnectionManager from "../controllers/connectionManager";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { ConnectionCredentials } from "../models/connectionCredentials";
import { ConnectionStore } from "../models/connectionStore";
import {
    CredentialsQuickPickItemType,
    IConnectionCredentialsQuickPickItem,
    IConnectionProfile,
} from "../models/interfaces";
import * as Utils from "../models/utils";
import { Timer } from "../models/utils";
import { INameValueChoice, IPrompter, IQuestion, QuestionTypes } from "../prompts/question";
import { ConnectionCompleteParams } from "../models/contracts/connection";
import { AddFirewallRuleWebviewController } from "../controllers/addFirewallRuleWebviewController";
import { SessionCreatedParameters } from "../models/contracts/objectExplorer/createSessionRequest";
import { CREATE_NEW_GROUP_ID, IConnectionGroup } from "../sharedInterfaces/connectionGroup";
import { FormItemOptions } from "../sharedInterfaces/form";

/**
 * The different tasks for managing connection profiles.
 */
enum ManageProfileTask {
    Create = 1,
    ClearRecentlyUsed,
    Edit,
    Remove,
}

export interface ISqlProviderItem extends vscode.QuickPickItem {
    providerId: string;
}

export class ConnectionUI {
    constructor(
        private _connectionManager: ConnectionManager,
        private _context: vscode.ExtensionContext,
        private _connectionStore: ConnectionStore,
        private _accountStore: AccountStore,
        private _prompter: IPrompter,
        private _vscodeWrapper?: VscodeWrapper,
    ) {
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
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

    /**
     * Prompt user to choose a connection profile from stored connections , or to create a new connection.
     * @param ignoreFocusOut Whether to ignoreFocusOut on the quickpick prompt
     * @returns The connectionInfo choosen or created from the user, or undefined if the user cancels the prompt.
     */
    public async promptForConnection(
        connectionProfileList: IConnectionCredentialsQuickPickItem[],
        ignoreFocusOut: boolean = false,
    ): Promise<IConnectionInfo | undefined> {
        // Let this design use Promise and resolve/reject pattern instead of async/await
        // because resolve/reject is done in in callback events.
        return await new Promise<IConnectionInfo | undefined>((resolve, _) => {
            // We have recent connections - show them in a prompt for connection profiles
            const connectionProfileQuickPick =
                this.vscodeWrapper.createQuickPick<IConnectionCredentialsQuickPickItem>();
            connectionProfileQuickPick.items = connectionProfileList;
            connectionProfileQuickPick.placeholder =
                LocalizedConstants.recentConnectionsPlaceholder;
            connectionProfileQuickPick.matchOnDescription = true;
            connectionProfileQuickPick.ignoreFocusOut = ignoreFocusOut;
            connectionProfileQuickPick.canSelectMany = false;
            connectionProfileQuickPick.busy = false;

            connectionProfileQuickPick.show();
            connectionProfileQuickPick.onDidChangeSelection((selection) => {
                if (selection[0]) {
                    // add progress notification and hide quickpick after user chooses an item from the quickpick
                    connectionProfileQuickPick.busy = true;
                    connectionProfileQuickPick.hide();
                    resolve(this.handleSelectedConnection(selection[0]));
                } else {
                    resolve(undefined);
                }
            });
            connectionProfileQuickPick.onDidHide(() => {
                connectionProfileQuickPick.dispose();
                resolve(undefined);
            });
        });
    }

    public promptLanguageFlavor(): Promise<string> {
        const self = this;
        return new Promise<string>(async (resolve, reject) => {
            let picklist: ISqlProviderItem[] = [
                {
                    label: LocalizedConstants.mssqlProviderName,
                    description: LocalizedConstants.flavorDescriptionMssql,
                    providerId: constants.mssqlProviderName,
                },
                {
                    label: LocalizedConstants.noneProviderName,
                    description: LocalizedConstants.flavorDescriptionNone,
                    providerId: constants.noneProviderName,
                },
            ];
            const selection = await self.promptItemChoice(
                {
                    placeHolder: LocalizedConstants.flavorChooseLanguage,
                    matchOnDescription: true,
                },
                picklist,
            );
            if (selection) {
                resolve(selection.providerId);
            } else {
                resolve(undefined);
            }
        });
    }

    // requests the user to choose an item from the list
    private promptItemChoice<T extends vscode.QuickPickItem>(
        options: vscode.QuickPickOptions,
        choices: T[],
    ): Promise<T> {
        let question: IQuestion = {
            type: QuestionTypes.expand,
            name: "question",
            message: options.placeHolder,
            matchOptions: options,
            choices: choices,
        };
        return this._prompter.promptSingle(question, question.matchOptions.ignoreFocusOut);
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
                message: LocalizedConstants.msgPromptCancelConnect,
            };
            self._prompter
                .promptSingle(question)
                .then((result) => {
                    resolve(result ? true : false);
                })
                .catch((err) => {
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
                placeHolder: LocalizedConstants.passwordPlaceholder,
            };
            self._prompter
                .promptSingle(question)
                .then((result: string) => {
                    resolve(result);
                })
                .catch((err) => {
                    reject(err);
                });
        });
    }

    public async promptToChangeLanguageMode(): Promise<boolean> {
        let question: IQuestion = {
            type: QuestionTypes.confirm,
            name: LocalizedConstants.msgChangeLanguageMode,
            message: LocalizedConstants.msgChangeLanguageMode,
        };

        const value = await this._prompter.promptSingle(question);

        if (value) {
            await this._vscodeWrapper.executeCommand("workbench.action.editor.changeLanguageMode");
            const result = await this.waitForLanguageModeToBeSql();
            return result;
        } else {
            return false;
        }
    }

    // Helper to let the user choose a database on the current server
    public showDatabasesOnCurrentServer(
        currentCredentials: IConnectionInfo,
        databaseNames: Array<string>,
    ): Promise<IConnectionInfo> {
        const self = this;
        return new Promise<IConnectionInfo>((resolve, reject) => {
            const pickListItems: vscode.QuickPickItem[] = databaseNames.map((name) => {
                let newCredentials: IConnectionInfo = <any>{};
                Object.assign<IConnectionInfo, IConnectionInfo>(newCredentials, currentCredentials);
                if (newCredentials["profileName"]) {
                    delete newCredentials["profileName"];
                }
                newCredentials.database = name;

                return <IConnectionCredentialsQuickPickItem>{
                    label: name,
                    description: "",
                    detail: "",
                    connectionCreds: newCredentials,
                    quickPickItemType: CredentialsQuickPickItemType.Mru,
                };
            });

            // Add an option to disconnect from the current server
            const disconnectItem: vscode.QuickPickItem = {
                label: LocalizedConstants.disconnectOptionLabel,
                description: LocalizedConstants.disconnectOptionDescription,
            };
            pickListItems.push(disconnectItem);

            const pickListOptions: vscode.QuickPickOptions = {
                placeHolder: LocalizedConstants.msgChooseDatabasePlaceholder,
            };

            // show database picklist, and modify the current connection to switch the active database
            self.vscodeWrapper
                .showQuickPick<vscode.QuickPickItem>(pickListItems, pickListOptions)
                .then((selection) => {
                    if (selection === disconnectItem) {
                        self.handleDisconnectChoice().then(
                            () => resolve(undefined),
                            (err) => reject(err),
                        );
                    } else if (typeof selection !== "undefined") {
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
                message: LocalizedConstants.disconnectConfirmationMsg,
            };
            self._prompter.promptSingle<boolean>(question).then(
                (result) => {
                    if (result === true) {
                        self.connectionManager.onDisconnect().then(
                            () => resolve(),
                            (err) => reject(err),
                        );
                    } else {
                        resolve();
                    }
                },
                (err) => reject(err),
            );
        });
    }

    public async createProfileWithDifferentCredentials(
        connection: IConnectionInfo,
    ): Promise<IConnectionInfo> {
        const retryResult = await this.promptForRetryConnectWithDifferentCredentials();

        if (!retryResult) {
            return undefined;
        }

        let connectionWithoutCredentials = Object.assign({}, connection, {
            user: "",
            password: "",
            emptyPasswordInput: false,
        });

        return await ConnectionCredentials.ensureRequiredPropertiesSet(
            connectionWithoutCredentials, // connection profile
            true, // isProfile
            false, // isPasswordRequired
            true, // wasPasswordEmptyInConfigFile
            this._prompter,
            this._connectionStore,
            connection,
            false, // shouldSaveUpdates
        );
    }

    private handleSelectedConnection(
        selection: IConnectionCredentialsQuickPickItem,
    ): Promise<IConnectionInfo> {
        return new Promise<IConnectionInfo>((resolve, reject) => {
            if (selection !== undefined) {
                let connectFunc: Promise<IConnectionInfo>;
                if (selection.quickPickItemType === CredentialsQuickPickItemType.NewConnection) {
                    // call the workflow to create a new connection
                    connectFunc = this.createAndSaveProfile();
                } else {
                    // user chose a connection from picklist. Prompt for mandatory info that's missing (e.g. username and/or password)
                    connectFunc = this.fillOrPromptForMissingInfo(
                        selection,
                        false /* shouldSaveUpdates */,
                    );
                }

                connectFunc.then(
                    (resolvedConnectionCreds) => {
                        if (!resolvedConnectionCreds) {
                            resolve(undefined);
                        }
                        resolve(resolvedConnectionCreds);
                    },
                    (err) =>
                        // we will send back a cancelled error in order to re-prompt the promptForConnection
                        reject(err),
                );
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
                message: LocalizedConstants.msgPromptClearRecentConnections,
            };
            self._prompter
                .promptSingle(question)
                .then((result) => {
                    resolve(result ? true : false);
                })
                .catch((err) => {
                    resolve(false);
                });
        });
    }

    public promptToManageProfiles(): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            // Create profile, clear recent connections, edit profiles, or remove profile?
            let choices: INameValueChoice[] = [
                {
                    name: LocalizedConstants.CreateProfileLabel,
                    value: ManageProfileTask.Create,
                },
                {
                    name: LocalizedConstants.ClearRecentlyUsedLabel,
                    value: ManageProfileTask.ClearRecentlyUsed,
                },
                {
                    name: LocalizedConstants.EditProfilesLabel,
                    value: ManageProfileTask.Edit,
                },
                {
                    name: LocalizedConstants.RemoveProfileLabel,
                    value: ManageProfileTask.Remove,
                },
            ];

            let question: IQuestion = {
                type: QuestionTypes.expand,
                name: LocalizedConstants.ManageProfilesPrompt,
                message: LocalizedConstants.ManageProfilesPrompt,
                choices: choices,
                onAnswered: async (value) => {
                    switch (value) {
                        case ManageProfileTask.Create:
                            const result = await self.connectionManager.onCreateProfile();
                            resolve(result);
                            break;
                        case ManageProfileTask.ClearRecentlyUsed:
                            try {
                                const result = await self.promptToClearRecentConnectionsList();
                                if (result) {
                                    const credentialsDeleted =
                                        await self.connectionManager.clearRecentConnectionsList();
                                    if (credentialsDeleted) {
                                        self.vscodeWrapper.showInformationMessage(
                                            LocalizedConstants.msgClearedRecentConnections,
                                        );
                                    } else {
                                        self.vscodeWrapper.showWarningMessage(
                                            LocalizedConstants.msgClearedRecentConnectionsWithErrors,
                                        );
                                    }
                                    resolve(true);
                                } else {
                                    resolve(false);
                                }
                            } catch (error) {
                                reject(error);
                            }
                            break;
                        case ManageProfileTask.Edit:
                            self.vscodeWrapper
                                .executeCommand("workbench.action.openGlobalSettings")
                                .then(() => {
                                    resolve(true);
                                });
                            break;
                        case ManageProfileTask.Remove:
                            const removeProfileResult = self.connectionManager.onRemoveProfile();
                            resolve(removeProfileResult);
                            break;
                        default:
                            resolve(false);
                            break;
                    }
                },
            };

            void this._prompter.promptSingle(question);
        });
    }

    /**
     * Calls the create profile workflow
     * @param validate whether the profile should be connected to and validated before saving
     * @returns undefined if profile creation failed or was cancelled, or if the Connection Dialog is getting used
     */
    public async createAndSaveProfile(
        validate: boolean = true,
    ): Promise<IConnectionProfile | undefined> {
        // Opening the Connection Dialog is considering the end of the flow regardless of whether they create a new connection,
        // so undefined is returned.
        // It's considered the end of the flow because opening a complex dialog in the middle of a flow then continuing is disorienting.
        // If they want to use their new connection, they can execute their query again.
        vscode.commands.executeCommand(constants.cmdAddObjectExplorer);
        return undefined;
    }

    /**
     * Validate a connection profile by connecting to it, and save it if we are successful.
     */
    public async validateAndSaveProfileFromDialog(
        profile: IConnectionProfile,
    ): Promise<ConnectionCompleteParams> {
        const result = await this.connectionManager.connectDialog(profile);
        return result;
    }

    public async addFirewallRule(uri: string, profile: IConnectionProfile): Promise<boolean> {
        if (this.connectionManager.failedUriToFirewallIpMap.has(uri)) {
            // Firewall rule error
            const firewallResponse = this.connectionManager.failedUriToFirewallIpMap.get(uri);
            let success = await this.handleFirewallError(profile, firewallResponse);
            if (success) {
                // Retry creating the profile if firewall rule
                // was successful
                this.connectionManager.failedUriToFirewallIpMap.delete(uri);
                return true;
            }
        }
        return false;
    }

    /**
     * Method to handle a firewall error. Returns true if a firewall rule was successfully added, and
     * false otherwise
     */
    public async handleFirewallError(
        profile: IConnectionInfo,
        connectionResponse: ConnectionCompleteParams | SessionCreatedParameters,
    ): Promise<boolean> {
        if (connectionResponse.errorNumber !== constants.errorFirewallRule) {
            Utils.logDebug(
                `handleFirewallError called with non-firewall-error response; error number: '${connectionResponse.errorNumber}'`,
            );
        }

        const addFirewallRuleController = new AddFirewallRuleWebviewController(
            this._context,
            this._vscodeWrapper,
            {
                serverName: profile.server,
                errorMessage: connectionResponse.errorMessage,
            },
            this.connectionManager.firewallService,
        );
        addFirewallRuleController.panel.reveal();

        const wasCreated = await addFirewallRuleController.dialogResult;

        return wasCreated === true; // dialog closed is undefined
    }

    /**
     * Get the options for connection groups.
     * @returns A promise that resolves to an array of FormItemOptions for connection groups.
     */
    public async getConnectionGroupOptions(): Promise<FormItemOptions[]> {
        const rootId = this._connectionManager.connectionStore.rootGroupId;
        let connectionGroups =
            await this._connectionManager.connectionStore.readAllConnectionGroups();
        connectionGroups = connectionGroups.filter((g) => g.id !== rootId);

        // Count occurrences of group names to handle naming conflicts
        const nameOccurrences = new Map<string, number>();
        for (const group of connectionGroups) {
            const count = nameOccurrences.get(group.name) || 0;
            nameOccurrences.set(group.name, count + 1);
        }

        // Create a map of group IDs to their full paths
        const groupById = new Map(connectionGroups.map((g) => [g.id, g]));

        // Helper function to get parent path
        const getParentPath = (group: IConnectionGroup): string => {
            if (!group.parentId || group.parentId === rootId) {
                return group.name;
            }
            const parent = groupById.get(group.parentId);
            if (!parent) {
                return group.name;
            }
            return `${getParentPath(parent)} > ${group.name}`;
        };

        const result = connectionGroups
            .map((g) => {
                // If there are naming conflicts, use the full path
                const displayName = nameOccurrences.get(g.name) > 1 ? getParentPath(g) : g.name;

                return {
                    displayName,
                    value: g.id,
                };
            })
            .sort((a, b) => a.displayName.localeCompare(b.displayName));

        return [
            {
                displayName: LocalizedConstants.ConnectionDialog.default,
                value: rootId,
            },
            {
                displayName: LocalizedConstants.ConnectionDialog.createConnectionGroup,
                value: CREATE_NEW_GROUP_ID,
            },
            ...result,
        ];
    }

    /**
     * Save a connection profile using the connection store
     */
    public async saveProfile(profile: IConnectionProfile): Promise<IConnectionProfile> {
        return await this._connectionStore.saveProfile(profile);
    }

    private async promptForRetryConnectWithDifferentCredentials(): Promise<boolean> {
        // Ask if the user would like to fix the profile
        const result = await this._vscodeWrapper.showErrorMessage(
            LocalizedConstants.msgPromptRetryConnectionDifferentCredentials,
            LocalizedConstants.retryLabel,
        );

        return result === LocalizedConstants.retryLabel;
    }

    private fillOrPromptForMissingInfo(
        selection: IConnectionCredentialsQuickPickItem,
        shouldSaveUpdates: boolean = true,
    ): Promise<IConnectionInfo> {
        // If a connection string is present, don't prompt for any other info
        if (selection.connectionCreds.connectionString) {
            return new Promise<IConnectionInfo>((resolve, reject) => {
                resolve(selection.connectionCreds);
            });
        }

        const passwordEmptyInConfigFile: boolean = Utils.isEmpty(
            selection.connectionCreds.password,
        );
        return this._connectionStore.addSavedPassword(selection).then((sel) => {
            return ConnectionCredentials.ensureRequiredPropertiesSet(
                sel.connectionCreds,
                selection.quickPickItemType === CredentialsQuickPickItemType.Profile,
                false,
                passwordEmptyInConfigFile,
                this._prompter,
                this._connectionStore,
                undefined, // defaultProfileValues
                shouldSaveUpdates,
            );
        });
    }

    public async addNewAccount(): Promise<IAccount> {
        return await this.connectionManager.azureController.addAccount(this._accountStore);
    }

    // Prompts the user to pick a profile for removal, then removes from the global saved state
    public async removeProfile(): Promise<boolean> {
        let self = this;

        // Flow: Select profile to remove, confirm removal, remove, notify
        let profiles = await self._connectionStore.getProfilePickListItems(false);
        let profile = await self.selectProfileForRemoval(profiles);
        let profileRemoved = profile ? await self._connectionStore.removeProfile(profile) : false;

        if (profileRemoved) {
            // TODO again consider moving information prompts to the prompt package
            this._vscodeWrapper.showInformationMessage(LocalizedConstants.msgProfileRemoved);
        }
        return profileRemoved;
    }

    private selectProfileForRemoval(
        profiles: IConnectionCredentialsQuickPickItem[],
    ): Promise<IConnectionProfile> {
        let self = this;
        if (!profiles || profiles.length === 0) {
            // Inform the user we have no profiles available for deletion
            // TODO: consider moving to prompter if we separate all UI logic from workflows in the future
            this._vscodeWrapper.showErrorMessage(LocalizedConstants.msgNoProfilesSaved);
            return Promise.resolve(undefined);
        }

        let chooseProfile = "ChooseProfile";
        let confirm = "ConfirmRemoval";
        let questions: IQuestion[] = [
            {
                // 1: what profile should we remove?
                type: QuestionTypes.expand,
                name: chooseProfile,
                message: LocalizedConstants.msgSelectProfileToRemove,
                matchOptions: { matchOnDescription: true },
                choices: profiles,
            },
            {
                // 2: Confirm removal before proceeding
                type: QuestionTypes.confirm,
                name: confirm,
                message: LocalizedConstants.confirmRemoveProfilePrompt,
            },
        ];

        // Prompt and return the value if the user confirmed
        return self._prompter.prompt(questions).then((answers) => {
            if (answers && answers[confirm]) {
                let profilePickItem = <IConnectionCredentialsQuickPickItem>answers[chooseProfile];
                return <IConnectionProfile>profilePickItem.connectionCreds;
            } else {
                return undefined;
            }
        });
    }
}
