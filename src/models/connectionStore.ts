'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import ConnInfo = require('./connectionInfo');
import Utils = require('../models/utils');
import ValidationException from '../utils/validationException';
import { ConnectionCredentials } from '../models/connectionCredentials';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem, CredentialsQuickPickItemType } from '../models/interfaces';
import { ICredentialStore } from '../credentialStore/interfaces/icredentialstore';
import { CredentialStore } from '../credentialStore/credentialstore';

/**
 * Manages the connections list including saved profiles and the most recently used connections
 *
 * @export
 * @class ConnectionStore
 */
export class ConnectionStore {

    private _context: vscode.ExtensionContext;
    private _credentialStore: ICredentialStore;

    private _defaultPrefix: string = 'sqlsecret:';
    private _defaultFilename: string = 'sqlsecrets.json';
    private _defaultFolder: string = '.sqlsecrets';

    constructor(context: vscode.ExtensionContext, credentialStore?: ICredentialStore) {
        this._context = context;
        if (credentialStore) {
            this._credentialStore = credentialStore;
        } else {
            this._credentialStore = new CredentialStore(this._defaultPrefix, this._defaultFolder, this._defaultFilename);
        }
    }

    public static get CRED_PREFIX(): string { return 'SQLPassword'; }
    public static get CRED_SEPARATOR(): string { return '|'; }
    public static get CRED_SERVER_PREFIX(): string { return 'server:'; }
    public static get CRED_DB_PREFIX(): string { return 'db:'; }
    public static get CRED_USER_PREFIX(): string { return 'user:'; }
    public static get CRED_PROFILE_USER(): string { return 'profile'; };
    public static get CRED_MRU_USER(): string { return 'mru'; };

    public static formatCredentialIdForCred(creds: IConnectionCredentials): string {
        if (Utils.isEmpty(creds)) {
            throw new ValidationException('Missing Connection which is required');
        }
        return ConnectionStore.formatCredentialId(creds.server, creds.database, creds.user);
    }

    /**
     * Creates a formatted credential usable for uniquely identifying a SQL Connection.
     * This string can be decoded but is not optimized for this.
     * @static
     * @param {string} server name of the server - required
     * @param {string} database name of the database - optional
     * @param {string} user bname of the user - optional
     * @returns {string} formatted string with server, DB and username
     */
    public static formatCredentialId(server: string, database?: string, user?: string): string {
        if (Utils.isEmpty(server)) {
            throw new ValidationException('Missing Server Name, which is required');
        }
        let cred: string[] = [ConnectionStore.CRED_PREFIX];
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
            .then(function(connections): void
            {
                const pickListItems = self.mapToQuickPickItems(connections);

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
        return self.loadProfiles().then( connections => {
            return self.mapToQuickPickItems(connections);
        });
    }

    public addSavedPassword(credentialsItem: IConnectionCredentialsQuickPickItem): Promise<IConnectionCredentialsQuickPickItem> {
        let self = this;
        return new Promise<IConnectionCredentialsQuickPickItem>( (resolve, reject) => {
            if (ConnectionCredentials.isPasswordBasedCredential(credentialsItem.connectionCreds)
                    && Utils.isEmpty(credentialsItem.connectionCreds.password)) {

                let name: string = credentialsItem.quickPickItemType === CredentialsQuickPickItemType.Profile ?
                    ConnectionStore.CRED_PROFILE_USER : ConnectionStore.CRED_MRU_USER;

                let credentialId = ConnectionStore.formatCredentialIdForCred(credentialsItem.connectionCreds);
                self._credentialStore.getCredentialByName(credentialId, name)
                .then(savedCred => {
                    if (savedCred) {
                        credentialsItem.connectionCreds.password = savedCred.password;
                    }
                    resolve(credentialsItem);
                });
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
            configValues = configValues.filter(value => value.profileName !== profile.profileName);

            // Add the profile to the saved list, taking care to clear out the password field
            let savedProfile: IConnectionProfile = Object.assign({}, profile, { password: '' });
            configValues.push(savedProfile);
            self._context.globalState.update(Constants.configMyConnections, configValues)
            .then(() => {
                // Only save if we successfully added the profile
                return self.savePasswordIfNeeded(profile);
                // And resolve / reject at the end of the process
            }).then(resolved => {
                // Add necessary default properties before returning
                // this is needed to support immediate connections
                ConnInfo.fixupConnectionCredentials(profile);
                resolve(profile);
            }, rejected => reject(rejected));
        });
    }

    private savePasswordIfNeeded(profile: IConnectionProfile): Promise<void> {
        let self = this;
        return new Promise<void>((resolve, reject) => {
            if (profile.savePassword === true && Utils.isNotEmpty(profile.password)) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user);
                self._credentialStore.setCredential(credentialId, ConnectionStore.CRED_PROFILE_USER, profile.password)
                .then(() => {
                    resolve(undefined);
                }).catch(err => {
                    // Bubble up error if there was a problem executing the set command
                    reject(err);
                });
            } else {
                resolve(undefined);
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
                if (value.profileName === profile.profileName) {
                    // remove just this profile
                    found = true;
                    return false;
                } else {
                    return true;
                }
            });

            let promises: PromiseLike<void>[] = [];
            if (profile.savePassword === true) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user);
                promises.push(self._credentialStore.removeCredentialByName(credentialId, ConnectionStore.CRED_PROFILE_USER));
            }

            // save all profiles
            promises.push(self._context.globalState.update(Constants.configMyConnections, configValues));

            // Wait on all async operations then return
            Promise.all(promises).then(() => {
                resolve(found);
            }, rejected => {
                reject(rejected);
            });
        });
    }

    // maps credentials to user-displayable items
    private mapToQuickPickItems(connections: IConnectionCredentials[]): IConnectionCredentialsQuickPickItem[] {
        // treat items as any since can't do typeof check on an interface
        return connections.map( (item: any) => {
            let itemType = (Utils.isNotEmpty(<IConnectionProfile>item.profileName)) ? CredentialsQuickPickItemType.Profile : CredentialsQuickPickItemType.Mru;
            return <IConnectionCredentialsQuickPickItem> {
                label: ConnInfo.getPicklistLabel(item),
                description: ConnInfo.getPicklistDescription(item),
                detail: ConnInfo.getPicklistDetails(item),
                connectionCreds: item,
                quickPickItemType: itemType
            };
        });
    }

    // Load connections from user preferences
    private loadAllConnections(): Promise<IConnectionCredentials[]> {
        let self = this;
        return new Promise<IConnectionCredentials[]>(resolve => {
            // Load connections from user preferences
            // Per this https://code.visualstudio.com/Docs/customization/userandworkspace
            // Settings defined in workspace scope overwrite the settings defined in user scope
            let connections: IConnectionCredentials[] = [];
            let config = vscode.workspace.getConfiguration(Constants.extensionName);

            // first read from the user settings
            let configValues = config[Constants.configMyConnections];
            self.addConnections(connections, configValues);
            resolve(connections);
        }).then(connections => {
            // next read from the global state
            let newConnections = self.loadProfiles().then(profiles => {
                return connections.concat(profiles);
            });

            return newConnections;
        });
    }

    private loadProfiles(): Promise<IConnectionProfile[]> {
        let self = this;
        return new Promise<IConnectionCredentials[]>((resolve, reject) => {
            let connections: IConnectionProfile[] = [];
            // read from the global state
            let configValues = self._context.globalState.get<IConnectionProfile[]>(Constants.configMyConnections);
            self.addConnections(connections, configValues);
            resolve(connections);
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
