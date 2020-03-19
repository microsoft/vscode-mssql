/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import vscode = require('vscode');
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');
import ConnInfo = require('./connectionInfo');
import Utils = require('../models/utils');
import ValidationException from '../utils/validationException';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem, CredentialsQuickPickItemType } from '../models/interfaces';
import { ICredentialStore } from '../credentialstore/icredentialstore';
import { CredentialStore } from '../credentialstore/credentialstore';
import { IConnectionConfig } from '../connectionconfig/iconnectionconfig';
import { ConnectionConfig } from '../connectionconfig/connectionconfig';
import VscodeWrapper from '../controllers/vscodeWrapper';

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

    public static formatCredentialIdForCred(creds: IConnectionCredentials, itemType?: CredentialsQuickPickItemType): string {
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
     * @returns {<IConnectionCredentialsQuickPickItem[]>}
     */
    public getPickListItems(): IConnectionCredentialsQuickPickItem[] {
        let pickListItems: IConnectionCredentialsQuickPickItem[] = this.loadAllConnections(true);
        pickListItems.push(<IConnectionCredentialsQuickPickItem> {
            label: LocalizedConstants.CreateProfileFromConnectionsListLabel,
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

    public async addSavedPassword(credentialsItem: IConnectionCredentialsQuickPickItem): Promise<IConnectionCredentialsQuickPickItem> {
        if (typeof(credentialsItem.connectionCreds['savePassword']) === 'undefined' ||
            credentialsItem.connectionCreds['savePassword'] === false) {
            // Don't try to lookup a saved password if savePassword is set to false for the credential
            return credentialsItem;
        // Note that 'emptyPasswordInput' property is only present for connection profiles
        } else if (this.shouldLookupSavedPassword(<IConnectionProfile>credentialsItem.connectionCreds)) {
            let credentialId = ConnectionStore.formatCredentialIdForCred(credentialsItem.connectionCreds, credentialsItem.quickPickItemType);
            try {
                const savedCred = await this._credentialStore.readCredential(credentialId);
                if (savedCred) {
                    credentialsItem.connectionCreds.password = savedCred.password;
                }
                return credentialsItem;
            } catch (err) {
                throw err;
            }
        } else {
            // Already have a password, no need to look up
            return credentialsItem;
        }
    }

    /**
     * Lookup credential store
     * @param connectionCredentials Connection credentials of profile for password lookup
     */
    public async lookupPassword(connectionCredentials: IConnectionCredentials, isConnectionString: boolean = false): Promise<string> {
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
    public async saveProfile(profile: IConnectionProfile, forceWritePlaintextPassword?: boolean): Promise<IConnectionProfile> {
        // Add the profile to the saved list, taking care to clear out the password field if necessary
        let savedProfile: IConnectionProfile;
        if (forceWritePlaintextPassword) {
            savedProfile = Object.assign({}, profile);
        } else {
            savedProfile = Object.assign({}, profile, { password: '' });
        }

        try {
            await this._connectionConfig.addConnection(savedProfile);
            // Only save if we successfully added the profile
            await this.saveProfilePasswordIfNeeded(profile);

            // Add necessary default properties before returning
            // this is needed to support immediate connections
            ConnInfo.fixupConnectionCredentials(profile);
            return profile;
        } catch (err) {
            throw err;
        }
    }

    /**
     * Gets the list of recently used connections. These will not include the password - a separate call to
     * {addSavedPassword} is needed to fill that before connecting
     *
     * @returns {IConnectionCredentials[]} the array of connections, empty if none are found
     */
    public getRecentlyUsedConnections(): IConnectionCredentials[] {
        let configValues = this._context.globalState.get<IConnectionCredentials[]>(Constants.configRecentConnections);
        if (!configValues) {
            configValues = [];
        }
        return configValues;
    }

    /**
     * Adds a connection to the recently used list.
     * Password values are stored to a separate credential store if the "savePassword" option is true
     *
     * @param {IConnectionCredentials} conn the connection to add
     * @returns {Promise<void>} a Promise that returns when the connection was saved
     */
    public async addRecentlyUsed(conn: IConnectionCredentials): Promise<void> {

        // Get all profiles
        let configValues = this.getRecentlyUsedConnections();
        let maxConnections = this.getMaxRecentConnectionsCount();

        // Remove the connection from the list if it already exists
        configValues = configValues.filter(value => !Utils.isSameProfile(<IConnectionProfile>value, <IConnectionProfile>conn));

        // Add the connection to the front of the list, taking care to clear out the password field
        let savedConn: IConnectionCredentials = Object.assign({}, conn, { password: '' });
        configValues.unshift(savedConn);

        // Remove last element if needed
        if (configValues.length > maxConnections) {
            configValues = configValues.slice(0, maxConnections);
        }

        try {
            await this._context.globalState.update(Constants.configRecentConnections, configValues);
            // Only save if we successfully added the profile and if savePassword
            if ((<IConnectionProfile>conn).savePassword) {
                this.doSaveCredential(conn, CredentialsQuickPickItemType.Mru);
            }
        } catch (error) {
            throw error;
        }
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
    public async removeRecentlyUsed(conn: IConnectionProfile, keepCredentialStore: boolean = false): Promise<void> {

        // Get all profiles
        let configValues = this.getRecentlyUsedConnections();

        // Remove the connection from the list if it already exists
        configValues = configValues.filter(value => !Utils.isSameProfile(<IConnectionProfile>value, conn));

        // Remove any saved password
        if (conn.savePassword && !keepCredentialStore) {
            let credentialId = ConnectionStore.formatCredentialId(conn.server, conn.database, conn.user, ConnectionStore.CRED_MRU_USER);
            await this._credentialStore.deleteCredential(credentialId);
        }

        try {
            // Update the MRU list
            await this._context.globalState.update(Constants.configRecentConnections, configValues);
        } catch (err) {
            throw err;
        }
    }

    public async saveProfilePasswordIfNeeded(profile: IConnectionProfile): Promise<boolean> {
        if (!profile.savePassword) {
            return true
        }
        const result = this.doSaveCredential(profile, CredentialsQuickPickItemType.Profile);
        return result;
    }

    public async saveProfileWithConnectionString(profile: IConnectionProfile): Promise<boolean> {
        if (!profile.connectionString) {
            return true;
        }
        const result = await this.doSaveCredential(profile, CredentialsQuickPickItemType.Profile, true);
        return result;
    }

    private async doSaveCredential(conn: IConnectionCredentials, type: CredentialsQuickPickItemType, isConnectionString: boolean = false): Promise<boolean> {
        let password = isConnectionString ? conn.connectionString : conn.password;

        if (Utils.isNotEmpty(password)) {
            let credType: string = type === CredentialsQuickPickItemType.Mru ? ConnectionStore.CRED_MRU_USER : ConnectionStore.CRED_PROFILE_USER;
            let credentialId = ConnectionStore.formatCredentialId(conn.server, conn.database, conn.user, credType, isConnectionString);
            try {
                const result = await this._credentialStore.saveCredential(credentialId, password);
                return result;
            } catch (err) {
                throw err;
            }
        } else {
            return true;
        }

    }

    /**
     * Removes a profile from the user settings and deletes any related password information
     * from the credential store
     *
     * @param {IConnectionProfile} profile the profile to be removed
     * @param {Boolean} keepCredentialStore optional value to keep the credential store after a profile removal
     * @returns {Promise<boolean>} true if successful
     */
    public async removeProfile(profile: IConnectionProfile, keepCredentialStore: boolean = false): Promise<boolean> {
        let profileFound = await this._connectionConfig.removeConnection(profile);
        if (profileFound) {
            // Remove the profile from the recently used list if necessary
            await this.removeRecentlyUsed(profile, keepCredentialStore)

            // Now remove password from credential store. Currently do not care about status unless an error occurred
            if (profile.savePassword === true && !keepCredentialStore) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user, ConnectionStore.CRED_PROFILE_USER);
                try {
                    await this._credentialStore.deleteCredential(credentialId);
                } catch (error) {
                    throw error;
                }
            }
            return profileFound;
        }
    }

    private createQuickPickItem(item: IConnectionCredentials, itemType: CredentialsQuickPickItemType): IConnectionCredentialsQuickPickItem {
        return <IConnectionCredentialsQuickPickItem> {
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
    public async removeProfilePassword(connection: IConnectionCredentials): Promise<void> {
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

    private getConnectionsFromGlobalState<T extends IConnectionCredentials>(configName: string): T[] {
        let connections: T[] = [];
        // read from the global state
        let configValues = this._context.globalState.get<T[]>(configName);
        this.addConnections(connections, configValues);
        return connections;
    }

    private mapToQuickPickItems(connections: IConnectionCredentials[], itemType: CredentialsQuickPickItemType): IConnectionCredentialsQuickPickItem[] {
        return connections.map(c => this.createQuickPickItem(c, itemType));
    }

    private loadProfiles(loadWorkspaceProfiles: boolean): IConnectionCredentialsQuickPickItem[] {
        let connections: IConnectionProfile[] = this._connectionConfig.getConnections(loadWorkspaceProfiles);
        let quickPickItems = connections.map(c => this.createQuickPickItem(c, CredentialsQuickPickItemType.Profile));
        return quickPickItems;
    }

    private addConnections(connections: IConnectionCredentials[], configValues: IConnectionCredentials[]): void {
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
        if (typeof(maxConnections) !== 'number' || maxConnections <= 0) {
            maxConnections = 5;
        }
        return maxConnections;
    }
}
