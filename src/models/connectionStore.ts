'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import ConnInfo = require('./connectionInfo');
import Utils = require('../models/utils');
import ValidationException from '../utils/validationException';
import VscodeWrapper from '../controllers/vscodeWrapper';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem, CredentialsQuickPickItemType } from '../models/interfaces';
import { ICredentialStore } from '../credentialstore/icredentialstore';
import { CredentialStore } from '../credentialstore/credentialstore';

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
        private _vscodeWrapper?: VscodeWrapper) {

        if (!this._credentialStore) {
            this._credentialStore = new CredentialStore();
        }
        if (!this._vscodeWrapper) {
            this._vscodeWrapper = new VscodeWrapper();
        }
    }

    public static get CRED_PREFIX(): string { return 'Microsoft.SqlTools'; }
    public static get CRED_SEPARATOR(): string { return '|'; }
    public static get CRED_SERVER_PREFIX(): string { return 'server:'; }
    public static get CRED_DB_PREFIX(): string { return 'db:'; }
    public static get CRED_USER_PREFIX(): string { return 'user:'; }
    public static get CRED_ITEMTYPE_PREFIX(): string { return 'itemtype:'; }
    public static get CRED_PROFILE_USER(): string { return 'profile'; };
    public static get CRED_MRU_USER(): string { return 'mru'; };

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
    public static formatCredentialId(server: string, database?: string, user?: string, itemType?: string): string {
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
        return cred.join(ConnectionStore.CRED_SEPARATOR);
    }

    private static pushIfNonEmpty(value: string, prefix: string, arr: string[]): void {
        if (Utils.isNotEmpty(value)) {
            arr.push(prefix.concat(value));
        }
    }

    /**
     * Load connections from MRU and profile list and return them as a formatted picklist.
     * Note: connections will not include password value
     *
     * @returns {Promise<IConnectionCredentialsQuickPickItem[]>}
     */
    public getPickListItems(): IConnectionCredentialsQuickPickItem[] {
        let pickListItems: IConnectionCredentialsQuickPickItem[] = this.loadAllConnections();
        pickListItems.push(<IConnectionCredentialsQuickPickItem> {
            label: Constants.CreateProfileLabel,
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
    public getProfilePickListItems(): IConnectionCredentialsQuickPickItem[] {
        return this.loadProfiles();
    }

    public addSavedPassword(credentialsItem: IConnectionCredentialsQuickPickItem): Promise<IConnectionCredentialsQuickPickItem> {
        let self = this;
        return new Promise<IConnectionCredentialsQuickPickItem>( (resolve, reject) => {
            if (ConnectionCredentials.isPasswordBasedCredential(credentialsItem.connectionCreds)
                    && Utils.isEmpty(credentialsItem.connectionCreds.password)) {

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
     * Saves a connection profile to the user settings.
     * Password values are stored to a separate credential store if the "savePassword" option is true
     *
     * @param {IConnectionProfile} profile the profile to save
     * @returns {Promise<IConnectionProfile>} a Promise that returns the original profile, for help in chaining calls
     */
    public saveProfile(profile: IConnectionProfile): Promise<IConnectionProfile> {
        const self = this;
        return new Promise<IConnectionProfile>((resolve, reject) => {
            // Get all profiles
            let configValues = self._context.globalState.get<IConnectionProfile[]>(Constants.configMyConnections);
            if (!configValues) {
                configValues = [];
            }

            // Remove the profile if already set
            configValues = configValues.filter(value => !Utils.isSameProfile(value, profile));

            // Add the profile to the saved list, taking care to clear out the password field
            let savedProfile: IConnectionProfile = Object.assign({}, profile, { password: '' });
            configValues.push(savedProfile);
            self._context.globalState.update(Constants.configMyConnections, configValues)
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
    public addRecentlyUsed(conn: IConnectionCredentials): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            // Get all profiles
            let configValues = self.getRecentlyUsedConnections();
            let maxConnections = self.getMaxRecentConnectionsCount();

            // Remove the connection from the list if it already exists
            configValues = configValues.filter(value => !Utils.isSameConnection(value, conn));

            // Add the connection to the front of the list, taking care to clear out the password field
            let savedConn: IConnectionCredentials = Object.assign({}, conn, { password: '' });
            configValues.unshift(savedConn);

            // Remove last element if needed
            if (configValues.length > maxConnections) {
                configValues = configValues.slice(0, maxConnections);
            }

            self._context.globalState.update(Constants.configRecentConnections, configValues)
            .then(() => {
                // Only save if we successfully added the profile
                self.doSavePassword(conn, CredentialsQuickPickItemType.Mru);
                // And resolve / reject at the end of the process
                resolve(undefined);
            }, err => {
                reject(err);
            });
        });
    }

    private saveProfilePasswordIfNeeded(profile: IConnectionProfile): Promise<boolean> {
        if (!profile.savePassword) {
            return Promise.resolve(true);
        }
        return this.doSavePassword(profile, CredentialsQuickPickItemType.Profile);
    }

    private doSavePassword(conn: IConnectionCredentials, type: CredentialsQuickPickItemType): Promise<boolean> {
        let self = this;
        return new Promise<boolean>((resolve, reject) => {
            if (Utils.isNotEmpty(conn.password)) {
                let credType: string = type === CredentialsQuickPickItemType.Mru ? ConnectionStore.CRED_MRU_USER : ConnectionStore.CRED_PROFILE_USER;
                let credentialId = ConnectionStore.formatCredentialId(conn.server, conn.database, conn.user, credType);
                self._credentialStore.saveCredential(credentialId, conn.password)
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
     * @returns {Promise<boolean>} true if successful
     */
    public removeProfile(profile: IConnectionProfile): Promise<boolean> {
        const self = this;
        return new Promise<boolean>((resolve, reject) => {
            // Get all profiles
            let configValues = self._context.globalState.get<IConnectionProfile[]>(Constants.configMyConnections);
            if (!configValues) {
                configValues = [];
            }

            // Remove the profile if already set
            let found: boolean = false;
            configValues = configValues.filter(value => {
                if (Utils.isSameProfile(value, profile)) {
                    // remove just this profile
                    found = true;
                    return false;
                } else {
                    return true;
                }
            });

            self._context.globalState.update(Constants.configMyConnections, configValues).then(() => {
                resolve(found);
            }, err => reject(err));
        }).then(profileFound => {
            // Now remove password from credential store. Currently do not care about status unless an error occurred
            if (profile.savePassword === true) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user, ConnectionStore.CRED_PROFILE_USER);
                self._credentialStore.deleteCredential(credentialId).then(undefined, rejected => {
                    throw new Error(rejected);
                });
            }
            return profileFound;
        });
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

    // Load connections from user preferences
    private loadAllConnections(): IConnectionCredentialsQuickPickItem[] {
        let quickPickItems: IConnectionCredentialsQuickPickItem[] = [];

        // Read recently used items from a memento
        let recentConnections = this.getConnectionsFromGlobalState(Constants.configRecentConnections);
        quickPickItems = quickPickItems.concat(this.mapToQuickPickItems(recentConnections, CredentialsQuickPickItemType.Mru));

        // Load connections from user preferences
        // Per this https://code.visualstudio.com/Docs/customization/userandworkspace
        // Settings defined in workspace scope overwrite the settings defined in user scope
        let profilesInConfiguration = this.getConnectionsFromConfig<IConnectionCredentials>(Constants.configMyConnections);
        quickPickItems = quickPickItems.concat(this.mapToQuickPickItems(profilesInConfiguration, CredentialsQuickPickItemType.Profile));

        // next read from the profiles saved in our own memento
        // TODO remove once user settings are editable programmatically
        let profiles = this.loadProfiles();
        quickPickItems = quickPickItems.concat(profiles);

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

    private getConnectionsFromConfig<T extends IConnectionCredentials>(configName: string): T[] {
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionName);
        // we do not want the default value returned since it's used for helping users only
        let configValues = config.get(configName, undefined);
        if (configValues) {
            configValues = configValues.filter(conn => {
                // filter any connection missing a server name or the sample that's shown by default
                return !!(conn.server) && conn.server !== Constants.SampleServerName;
            });
        } else {
            configValues = [];
        }
        return configValues;
    }


    private mapToQuickPickItems(connections: IConnectionCredentials[], itemType: CredentialsQuickPickItemType): IConnectionCredentialsQuickPickItem[] {
        return connections.map(c => this.createQuickPickItem(c, itemType));
    }

    private loadProfiles(): IConnectionCredentialsQuickPickItem[] {
        let connections: IConnectionProfile[] = this.getConnectionsFromGlobalState<IConnectionProfile>(Constants.configMyConnections);
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
                    Utils.logDebug(Constants.configMyConnectionsNoServerName + ' index (' + index + '): ' + element.toString());
                }
            }
        }
    }

    private getMaxRecentConnectionsCount(): number {
        let config = this._vscodeWrapper.getConfiguration(Constants.extensionName);

        let maxConnections: number = config[Constants.configMaxRecentConnections];
        if (typeof(maxConnections) !== 'number' || maxConnections <= 0) {
            maxConnections = 5;
        }
        return maxConnections;
    }
}
