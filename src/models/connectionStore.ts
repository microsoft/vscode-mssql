/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as Constants from '../constants/constants';
import * as LocalizedConstants from '../constants/localizedConstants';
import * as ConnInfo from './connectionInfo';
import * as Utils from '../models/utils';
import ValidationException from '../utils/validationException';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { IConnectionProfile, IConnectionCredentialsQuickPickItem, CredentialsQuickPickItemType, AuthenticationTypes } from '../models/interfaces';
import { ICredentialStore } from '../credentialstore/icredentialstore';
import { CredentialStore } from '../credentialstore/credentialstore';
import { IConnectionConfig } from '../connectionconfig/iconnectionconfig';
import { ConnectionConfig } from '../connectionconfig/connectionconfig';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { IConnectionInfo } from 'vscode-mssql';

/**
 * Manages the connections list including saved profiles and the most recently used connections
 *
 * @export
 * @class ConnectionStore
 */
export class ConnectionStore {

    constructor(
        private _context: vscode.ExtensionContext,
        private _credentialStore?: ICredentialStore,
        private _connectionConfig?: IConnectionConfig,
        private _vscodeWrapper?: VscodeWrapper) {
        if (!this._credentialStore) {
            this._credentialStore = new CredentialStore();
        }
        if (!this.vscodeWrapper) {
            this.vscodeWrapper = new VscodeWrapper();
        }
        if (!this._connectionConfig) {
            this._connectionConfig = new ConnectionConfig();
        }
    }

    public static get CRED_PREFIX(): string { return 'Microsoft.SqlTools'; }
    public static get CRED_SEPARATOR(): string { return '|'; }
    public static get CRED_SERVER_PREFIX(): string { return 'server:'; }
    public static get CRED_DB_PREFIX(): string { return 'db:'; }
    public static get CRED_USER_PREFIX(): string { return 'user:'; }
    public static get CRED_ITEMTYPE_PREFIX(): string { return 'itemtype:'; }
    public static get CRED_CONNECTION_STRING_PREFIX(): string { return 'isConnectionString:'; }
    public static get CRED_PROFILE_USER(): string { return CredentialsQuickPickItemType[CredentialsQuickPickItemType.Profile]; }
    public static get CRED_MRU_USER(): string { return CredentialsQuickPickItemType[CredentialsQuickPickItemType.Mru]; }

    public static formatCredentialIdForCred(creds: IConnectionInfo, itemType?: CredentialsQuickPickItemType): string {
        if (Utils.isEmpty(creds)) {
            throw new ValidationException('Missing Connection which is required');
        }
        let itemTypeString: string = ConnectionStore.CRED_PROFILE_USER;
        if (itemType) {
            itemTypeString = CredentialsQuickPickItemType[itemType];
        }
        return ConnectionStore.formatCredentialId(creds.server, creds.database, creds.user, itemTypeString);
    }

    /**
     * Creates a formatted credential usable for uniquely identifying a SQL Connection.
     * This string can be decoded but is not optimized for this.
     * @static
     * @param {string} server name of the server - required
     * @param {string} database name of the database - optional
     * @param {string} user name of the user - optional
     * @param {string} itemType type of the item (MRU or Profile) - optional
     * @returns {string} formatted string with server, DB and username
     */
    public static formatCredentialId(server: string, database?: string, user?: string, itemType?: string, isConnectionString?: boolean): string {
        if (Utils.isEmpty(server)) {
            throw new ValidationException('Missing Server Name, which is required');
        }
        let cred: string[] = [ConnectionStore.CRED_PREFIX];
        if (!itemType) {
            itemType = ConnectionStore.CRED_PROFILE_USER;
        }

        ConnectionStore.pushIfNonEmpty(itemType, ConnectionStore.CRED_ITEMTYPE_PREFIX, cred);
        ConnectionStore.pushIfNonEmpty(server, ConnectionStore.CRED_SERVER_PREFIX, cred);
        ConnectionStore.pushIfNonEmpty(database, ConnectionStore.CRED_DB_PREFIX, cred);
        ConnectionStore.pushIfNonEmpty(user, ConnectionStore.CRED_USER_PREFIX, cred);
        if (isConnectionString) {
            ConnectionStore.pushIfNonEmpty('true', ConnectionStore.CRED_CONNECTION_STRING_PREFIX, cred);
        }

        return cred.join(ConnectionStore.CRED_SEPARATOR);
    }

    public get connectionConfig(): IConnectionConfig {
        return this._connectionConfig;
    }

    private static pushIfNonEmpty(value: string, prefix: string, arr: string[]): void {
        if (Utils.isNotEmpty(value)) {
            arr.push(prefix.concat(value));
        }
    }

    private get vscodeWrapper(): VscodeWrapper {
        return this._vscodeWrapper;
    }

    private set vscodeWrapper(value: VscodeWrapper) {
        this._vscodeWrapper = value;
    }

    /**
     * Load connections from MRU and profile list and return them as a formatted picklist.
     * Note: connections will not include password value
     *
     * @returns {Promise<IConnectionCredentialsQuickPickItem[]>}
     */
    public getPickListItems(): IConnectionCredentialsQuickPickItem[] {
        let pickListItems: IConnectionCredentialsQuickPickItem[] = this.loadAllConnections(true);
        pickListItems.push(<IConnectionCredentialsQuickPickItem>{
            label: `$(add) ${LocalizedConstants.CreateProfileFromConnectionsListLabel}`,
            connectionCreds: undefined,
            quickPickItemType: CredentialsQuickPickItemType.NewConnection
        });
        return pickListItems;
    }

    /**
     * Gets all connection profiles stored in the user settings
     * Note: connections will not include password value
     *
     * @returns {IConnectionCredentialsQuickPickItem[]}
     */
    public getProfilePickListItems(getWorkspaceProfiles: boolean): IConnectionCredentialsQuickPickItem[] {
        return this.loadProfiles(getWorkspaceProfiles);
    }

    public addSavedPassword(credentialsItem: IConnectionCredentialsQuickPickItem): Promise<IConnectionCredentialsQuickPickItem> {
        let self = this;
        return new Promise<IConnectionCredentialsQuickPickItem>((resolve, reject) => {
            if (typeof (credentialsItem.connectionCreds['savePassword']) === 'undefined' ||
                credentialsItem.connectionCreds['savePassword'] === false) {
                // Don't try to lookup a saved password if savePassword is set to false for the credential
                resolve(credentialsItem);
                // Note that 'emptyPasswordInput' property is only present for connection profiles
            } else if (self.shouldLookupSavedPassword(<IConnectionProfile>credentialsItem.connectionCreds)) {
                let credentialId = ConnectionStore.formatCredentialIdForCred(credentialsItem.connectionCreds, credentialsItem.quickPickItemType);
                self._credentialStore.readCredential(credentialId)
                    .then(savedCred => {
                        if (savedCred) {
                            credentialsItem.connectionCreds.password = savedCred.password;
                        }
                        resolve(credentialsItem);
                    })
                    .catch(err => reject(err));
            } else {
                // Already have a password, no need to look up
                resolve(credentialsItem);
            }
        });
    }

    /**
     * Lookup credential store
     * @param connectionCredentials Connection credentials of profile for password lookup
     */
    public async lookupPassword(connectionCredentials: IConnectionInfo, isConnectionString: boolean = false): Promise<string> {
        const credentialId = ConnectionStore.formatCredentialId(
            connectionCredentials.server, connectionCredentials.database,
            connectionCredentials.user, ConnectionStore.CRED_PROFILE_USER, isConnectionString);
        const savedCredential = await this._credentialStore.readCredential(credentialId);
        if (savedCredential && savedCredential.password) {
            return savedCredential.password;
        } else {
            return undefined;
        }
    }

    /**
     * public for testing purposes. Validates whether a password should be looked up from the credential store or not
     *
     * @param {IConnectionProfile} connectionCreds
     * @returns {boolean}
     * @memberof ConnectionStore
     */
    public shouldLookupSavedPassword(connectionCreds: IConnectionProfile): boolean {
        if (ConnectionCredentials.isPasswordBasedCredential(connectionCreds)) {
            // Only lookup if password isn't saved in the profile, and if it was not explicitly defined
            // as a blank password
            return Utils.isEmpty(connectionCreds.password) && !connectionCreds.emptyPasswordInput;
        }
        return false;
    }

    /**
     * Saves a connection profile to the user settings.
     * Password values are stored to a separate credential store if the "savePassword" option is true
     *
     * @param {IConnectionProfile} profile the profile to save
     * @param {forceWritePlaintextPassword} whether the plaintext password should be written to the settings file
     * @returns {Promise<IConnectionProfile>} a Promise that returns the original profile, for help in chaining calls
     */
    public saveProfile(profile: IConnectionProfile, forceWritePlaintextPassword?: boolean): Promise<IConnectionProfile> {
        const self = this;
        return new Promise<IConnectionProfile>((resolve, reject) => {
            // Add the profile to the saved list, taking care to clear out the password field if necessary
            let savedProfile: IConnectionProfile;
            if (profile.authenticationType === Utils.authTypeToString(AuthenticationTypes.AzureMFA)) {
                savedProfile = Object.assign({}, profile, { azureAccountToken: '' });
            } else {
                if (forceWritePlaintextPassword) {
                    savedProfile = Object.assign({}, profile);
                } else {
                    savedProfile = Object.assign({}, profile, { password: '' });
                }
            }


            self._connectionConfig.addConnection(savedProfile)
                .then(() => {
                    // Only save if we successfully added the profile
                    return self.saveProfilePasswordIfNeeded(profile);
                    // And resolve / reject at the end of the process
                }, err => {
                    reject(err);
                }).then(resolved => {
                    // Add necessary default properties before returning
                    // this is needed to support immediate connections
                    ConnInfo.fixupConnectionCredentials(profile);
                    resolve(profile);
                }, err => {
                    reject(err);
                });
        });
    }

    /**
     * Gets the list of recently used connections. These will not include the password - a separate call to
     * {addSavedPassword} is needed to fill that before connecting
     *
     * @returns {IConnectionInfo[]} the array of connections, empty if none are found
     */
    public getRecentlyUsedConnections(): IConnectionInfo[] {
        let configValues = this._context.globalState.get<IConnectionInfo[]>(Constants.configRecentConnections);
        if (!configValues) {
            configValues = [];
        }
        return configValues;
    }

    /**
     * Adds a connection to the recently used list.
     * Password values are stored to a separate credential store if the "savePassword" option is true
     *
     * @param {IConnectionInfo} conn the connection to add
     * @returns {Promise<void>} a Promise that returns when the connection was saved
     */
    public addRecentlyUsed(conn: IConnectionInfo): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            // Get all profiles
            let configValues = self.getRecentlyUsedConnections();
            let maxConnections = self.getMaxRecentConnectionsCount();

            // Remove the connection from the list if it already exists
            configValues = configValues.filter(value => !Utils.isSameProfile(<IConnectionProfile>value, <IConnectionProfile>conn));

            // Add the connection to the front of the list, taking care to clear out the password field
            let savedConn: IConnectionInfo = Object.assign({}, conn, { password: '' });
            configValues.unshift(savedConn);

            // Remove last element if needed
            if (configValues.length > maxConnections) {
                configValues = configValues.slice(0, maxConnections);
            }

            self._context.globalState.update(Constants.configRecentConnections, configValues)
                .then(() => {
                    // Only save if we successfully added the profile and if savePassword
                    if ((<IConnectionProfile>conn).savePassword) {
                        self.doSaveCredential(conn, CredentialsQuickPickItemType.Mru);
                    }
                    // And resolve / reject at the end of the process
                    resolve(undefined);
                }, err => {
                    reject(err);
                });
        });
    }

    /**
     * Clear all recently used connections from the MRU list.
     */
    public async clearRecentlyUsed(): Promise<void> {
        // Update the MRU list to be empty
        try {
            await this._context.globalState.update(Constants.configRecentConnections, []);
        } catch (error) {
            Promise.reject(error);
        }
    }

    /**
     * Remove a connection profile from the recently used list.
     */
    public removeRecentlyUsed(conn: IConnectionProfile, keepCredentialStore: boolean = false): Promise<void> {
        const self = this;
        return new Promise<void>(async (resolve, reject) => {
            // Get all profiles
            let configValues = self.getRecentlyUsedConnections();

            // Remove the connection from the list if it already exists
            configValues = configValues.filter(value => !Utils.isSameProfile(<IConnectionProfile>value, conn));

            // Remove any saved password
            if (conn.savePassword && !keepCredentialStore) {
                let credentialId = ConnectionStore.formatCredentialId(conn.server, conn.database, conn.user, ConnectionStore.CRED_MRU_USER);
                await self._credentialStore.deleteCredential(credentialId);
            }

            // Update the MRU list
            self._context.globalState.update(Constants.configRecentConnections, configValues)
                .then(() => {
                    // And resolve / reject at the end of the process
                    resolve(undefined);
                }, err => {
                    reject(err);
                });
        });
    }

    public saveProfilePasswordIfNeeded(profile: IConnectionProfile): Promise<boolean> {
        if (!profile.savePassword) {
            return Promise.resolve(true);
        }
        return this.doSaveCredential(profile, CredentialsQuickPickItemType.Profile);
    }

    public saveProfileWithConnectionString(profile: IConnectionProfile): Promise<boolean> {
        if (!profile.connectionString) {
            return Promise.resolve(true);
        }
        return this.doSaveCredential(profile, CredentialsQuickPickItemType.Profile, true);
    }

    private doSaveCredential(conn: IConnectionInfo, type: CredentialsQuickPickItemType, isConnectionString: boolean = false): Promise<boolean> {
        let self = this;
        let password = isConnectionString ? conn.connectionString : conn.password;
        return new Promise<boolean>((resolve, reject) => {
            if (Utils.isNotEmpty(password)) {
                let credType: string = type === CredentialsQuickPickItemType.Mru ? ConnectionStore.CRED_MRU_USER : ConnectionStore.CRED_PROFILE_USER;
                let credentialId = ConnectionStore.formatCredentialId(conn.server, conn.database, conn.user, credType, isConnectionString);
                self._credentialStore.saveCredential(credentialId, password)
                    .then((result) => {
                        resolve(result);
                    }).catch(err => {
                        // Bubble up error if there was a problem executing the set command
                        reject(err);
                    });
            } else {
                resolve(true);
            }
        });
    }

    /**
     * Removes a profile from the user settings and deletes any related password information
     * from the credential store
     *
     * @param {IConnectionProfile} profile the profile to be removed
     * @param {Boolean} keepCredentialStore optional value to keep the credential store after a profile removal
     * @returns {Promise<boolean>} true if successful
     */
    public removeProfile(profile: IConnectionProfile, keepCredentialStore: boolean = false): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            self._connectionConfig.removeConnection(profile).then(profileFound => {
                resolve(profileFound);
            }).catch(err => {
                reject(err);
            });
        }).then(profileFound => {
            // Remove the profile from the recently used list if necessary
            return new Promise<boolean>((resolve, reject) => {
                self.removeRecentlyUsed(profile, keepCredentialStore).then(() => {
                    resolve(profileFound);
                }).catch(err => {
                    reject(err);
                });
            });
        }).then(profileFound => {
            // Now remove password from credential store. Currently do not care about status unless an error occurred
            if (profile.savePassword === true && !keepCredentialStore) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user, ConnectionStore.CRED_PROFILE_USER);
                self._credentialStore.deleteCredential(credentialId).then(undefined, rejected => {
                    throw new Error(rejected);
                });
            }

            return profileFound;
        });
    }

    private createQuickPickItem(item: IConnectionInfo, itemType: CredentialsQuickPickItemType): IConnectionCredentialsQuickPickItem {
        return <IConnectionCredentialsQuickPickItem>{
            label: ConnInfo.getPicklistLabel(item, itemType),
            description: ConnInfo.getPicklistDescription(item),
            detail: ConnInfo.getPicklistDetails(item),
            connectionCreds: item,
            quickPickItemType: itemType
        };
    }

    /**
     * Deletes the password for a connection from the credential store
     * @param connectionCredential
     */
    public async deleteCredential(profile: IConnectionProfile): Promise<boolean> {
        let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user, ConnectionStore.CRED_PROFILE_USER);
        let result = await this._credentialStore.deleteCredential(credentialId);
        return result;
    }


    /**
     * Removes password from a saved profile and credential store
     */
    public async removeProfilePassword(connection: IConnectionInfo): Promise<void> {
        // if the password is saved in the credential store, remove it
        let profile = connection as IConnectionProfile;
        profile.password = '';
        await this.saveProfile(profile);
    }

    // Load connections from user preferences
    public loadAllConnections(addRecentConnections: boolean = false): IConnectionCredentialsQuickPickItem[] {
        let quickPickItems: IConnectionCredentialsQuickPickItem[] = [];

        // Read recently used items from a memento
        let recentConnections = [];
        if (addRecentConnections) {
            recentConnections = this.getConnectionsFromGlobalState(Constants.configRecentConnections);
        }

        // Load connections from user preferences
        // Per this https://code.visualstudio.com/Docs/customization/userandworkspace
        // Connections defined in workspace scope are unioned with the Connections defined in user scope
        let profilesInConfiguration = this._connectionConfig.getConnections(true);

        // Remove any duplicates that are in both recent connections and the user settings
        let profilesInRecentConnectionsList: number[] = [];
        profilesInConfiguration = profilesInConfiguration.filter(profile => {
            for (let index = 0; index < recentConnections.length; index++) {
                if (Utils.isSameProfile(profile, <IConnectionProfile>recentConnections[index])) {
                    if (Utils.isSameConnection(profile, recentConnections[index])) {
                        // The MRU item should reflect the current profile's settings from user preferences if it is still the same database
                        ConnInfo.fixupConnectionCredentials(profile);
                        recentConnections[index] = Object.assign({}, profile);
                        profilesInRecentConnectionsList.push(index);
                    }
                    return false;
                }
            }
            return true;
        });

        // Ensure that MRU items which are actually profiles are labeled as such
        let recentConnectionsItems = this.mapToQuickPickItems(recentConnections, CredentialsQuickPickItemType.Mru);
        for (let index of profilesInRecentConnectionsList) {
            recentConnectionsItems[index].quickPickItemType = CredentialsQuickPickItemType.Profile;
        }

        quickPickItems = quickPickItems.concat(recentConnectionsItems);
        quickPickItems = quickPickItems.concat(this.mapToQuickPickItems(profilesInConfiguration, CredentialsQuickPickItemType.Profile));

        // Return all connections
        return quickPickItems;
    }

    private getConnectionsFromGlobalState<T extends IConnectionInfo>(configName: string): T[] {
        let connections: T[] = [];
        // read from the global state
        let configValues = this._context.globalState.get<T[]>(configName);
        this.addConnections(connections, configValues);
        return connections;
    }

    private mapToQuickPickItems(connections: IConnectionInfo[], itemType: CredentialsQuickPickItemType): IConnectionCredentialsQuickPickItem[] {
        return connections.map(c => this.createQuickPickItem(c, itemType));
    }

    private loadProfiles(loadWorkspaceProfiles: boolean): IConnectionCredentialsQuickPickItem[] {
        let connections: IConnectionProfile[] = this._connectionConfig.getConnections(loadWorkspaceProfiles);
        let quickPickItems = connections.map(c => this.createQuickPickItem(c, CredentialsQuickPickItemType.Profile));
        return quickPickItems;
    }

    private addConnections(connections: IConnectionInfo[], configValues: IConnectionInfo[]): void {
        if (configValues) {
            for (let index = 0; index < configValues.length; index++) {
                let element = configValues[index];
                if (element.server && element.server.trim() && !element.server.trim().startsWith('{{')) {
                    let connection = ConnInfo.fixupConnectionCredentials(element);
                    connections.push(connection);
                } else {
                    Utils.logDebug(`Missing server name in user preferences connection: index ( ${index} ): ${element.toString()}`);
                }
            }
        }
    }

    private getMaxRecentConnectionsCount(): number {
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionConfigSectionName);

        let maxConnections: number = config[Constants.configMaxRecentConnections];
        if (typeof (maxConnections) !== 'number' || maxConnections <= 0) {
            maxConnections = 5;
        }
        return maxConnections;
    }
}
