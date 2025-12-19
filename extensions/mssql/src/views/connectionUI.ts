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
import { ConnectionStore } from "../models/connectionStore";
import {
    CredentialsQuickPickItemType,
    IConnectionCredentialsQuickPickItem,
    IConnectionProfile,
} from "../models/interfaces";
import { Timer } from "../models/utils";
import { INameValueChoice, IPrompter, IQuestion, QuestionTypes } from "../prompts/question";
import { CREATE_NEW_GROUP_ID, IConnectionGroup } from "../sharedInterfaces/connectionGroup";
import { FormItemOptions } from "../sharedInterfaces/form";
import { ConnectionConfig } from "../connectionconfig/connectionconfig";

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

    private async handleSelectedConnection(
        selection: IConnectionCredentialsQuickPickItem,
    ): Promise<IConnectionInfo> {
        if (selection === undefined) {
            return undefined;
        }

        if (selection.quickPickItemType === CredentialsQuickPickItemType.NewConnection) {
            // Opening the Connection Dialog is considering the end of the flow regardless of whether they create a new connection,
            // so undefined is returned.
            // It's considered the end of the flow because opening a complex dialog in the middle of a flow then continuing is disorienting.
            // If they want to use their new connection, they can execute their query again.
            this.openConnectionDialog();
            return undefined;
        } else {
            await this._connectionStore.addSavedPassword(selection);
            return selection.connectionCreds;
        }
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

    public promptToManageProfiles(): Promise<void> {
        const self = this;
        const choices: INameValueChoice[] = [
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
                        await self.connectionManager.onCreateProfile();
                        return;
                    case ManageProfileTask.ClearRecentlyUsed:
                        const result = await self.promptToClearRecentConnectionsList();
                        if (!result) {
                            return;
                        }

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

                        return;
                    case ManageProfileTask.Edit:
                        await self.vscodeWrapper.executeCommand(
                            "workbench.action.openGlobalSettings",
                        );
                        return;
                    case ManageProfileTask.Remove:
                        await self.connectionManager.onRemoveProfile();
                        return;
                    default:
                        return;
                }
            },
        };

        return this._prompter.promptSingle(question);
    }

    /**
     * Calls the create profile workflow
     * @param validate whether the profile should be connected to and validated before saving
     * @returns undefined if profile creation failed or was cancelled, or if the Connection Dialog is getting used
     */
    public openConnectionDialog(): void {
        vscode.commands.executeCommand(constants.cmdAddObjectExplorer);
    }

    /**
     * Get the options for connection groups.
     * @returns A promise that resolves to an array of FormItemOptions for connection groups.
     */
    public async getConnectionGroupOptions(): Promise<FormItemOptions[]> {
        let connectionGroups =
            await this._connectionManager.connectionStore.readAllConnectionGroups();
        connectionGroups = connectionGroups.filter((g) => g.id !== ConnectionConfig.ROOT_GROUP_ID);

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
            if (!group.parentId || group.parentId === ConnectionConfig.ROOT_GROUP_ID) {
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
                value: ConnectionConfig.ROOT_GROUP_ID,
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

    public async addNewAccount(): Promise<IAccount> {
        return await this.connectionManager.azureController.addAccount(this._accountStore);
    }

    /**
     * Prompts the user to pick a profile for removal, then removes from the global saved state
     */
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
