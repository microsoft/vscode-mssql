'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import ConnInfo = require('./connectionInfo');
import Utils = require('../models/utils');
import ValidationException from '../utils/validationException';
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

    private _context: vscode.ExtensionContext;
    private _credentialStore: ICredentialStore;

    constructor(context: vscode.ExtensionContext, credentialStore?: ICredentialStore) {
        this._context = context;
        if (credentialStore) {
            this._credentialStore = credentialStore;
        } else {
            this._credentialStore = new CredentialStore();
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
    public getPickListItems(): Promise<IConnectionCredentialsQuickPickItem[]> {
        const self = this;
        return new Promise<IConnectionCredentialsQuickPickItem[]>((resolve, reject) => {
            self.loadAllConnections()
            .then((pickListItems: IConnectionCredentialsQuickPickItem[]) => {
                // Always add an "Add New Connection" quickpick item
                pickListItems.push(<IConnectionCredentialsQuickPickItem> {
                        label: Constants.CreateProfileLabel,
                        connectionCreds: undefined,
                        quickPickItemType: CredentialsQuickPickItemType.NewConnection
                    });
                resolve(pickListItems);
            });
        });
    }

    /**
     * Gets all connection profiles stored in the user settings
     * Note: connections will not include password value
     *
     * @returns {Promise<IConnectionCredentialsQuickPickItem[]>}
     */
    public getProfilePickListItems(): Promise<IConnectionCredentialsQuickPickItem[]> {
        const self = this;
        return self.loadProfiles().then(items => {
            // TODO add MRU list here
            return items;
        });
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
                return self.savePasswordIfNeeded(profile);
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

    private savePasswordIfNeeded(profile: IConnectionProfile): Promise<boolean> {
        let self = this;
        return new Promise<boolean>((resolve, reject) => {
            if (profile.savePassword === true && Utils.isNotEmpty(profile.password)) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user, ConnectionStore.CRED_PROFILE_USER);
                self._credentialStore.saveCredential(credentialId, profile.password)
                .then((result) => {
                    resolve(result);
                }).catch(err => {
                    // Bubble up error if there was a problem executing the set command
                    reject(err);
                });
            } else {
                // Operation successful as didn't need to save
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
    private loadAllConnections(): Promise<IConnectionCredentialsQuickPickItem[]> {
        let self = this;
        return new Promise<IConnectionCredentialsQuickPickItem[]>(resolve => {
            // Load connections from user preferences
            // Per this https://code.visualstudio.com/Docs/customization/userandworkspace
            // Settings defined in workspace scope overwrite the settings defined in user scope
            let connections: IConnectionCredentials[] = [];
            let config = vscode.workspace.getConfiguration(Constants.extensionName);

            // first read from the user settings
            let configValues = config[Constants.configMyConnections];
            self.addConnections(connections, configValues);
            let quickPickItems = connections.map(c => self.createQuickPickItem(c, CredentialsQuickPickItemType.Profile));
            resolve(quickPickItems);
        }).then(quickPickItems => {
            // next read from the global state
            let allQuickPickItems = self.loadProfiles().then(items => {
                return quickPickItems.concat(items);
            });

            return allQuickPickItems;
        });
    }

    private loadProfiles(): Promise<IConnectionCredentialsQuickPickItem[]> {
        let self = this;
        return new Promise<IConnectionCredentialsQuickPickItem[]>((resolve, reject) => {
            let connections: IConnectionProfile[] = [];
            // read from the global state
            let configValues = self._context.globalState.get<IConnectionProfile[]>(Constants.configMyConnections);
            self.addConnections(connections, configValues);
            let quickPickItems = connections.map(c => self.createQuickPickItem(c, CredentialsQuickPickItemType.Profile));
            resolve(quickPickItems);
        });
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
}
