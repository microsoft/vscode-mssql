'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import ConnInfo = require('./connectionInfo');
import Utils = require('../models/utils');
import ValidationException from '../utils/validationException';
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem } from '../models/interfaces';
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
            throw new ValidationException('Missing Connection or Server Name, which are required');
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
                        isNewConnectionQuickPickItem: true
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
        return new Promise<IConnectionCredentialsQuickPickItem[]>((resolve, reject) => {
            self.loadProfiles()
            .then(function(connections): void
            {
                const pickListItems = self.mapToQuickPickItems(connections);
                resolve(pickListItems);
            });
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
            self._context.globalState.update(Constants.configMyConnections, configValues);

            // Add the password to the credential store if necessary
            if (profile.savePassword === true && Utils.isNotEmpty(profile.password)) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user);
                self._credentialStore.setCredential(credentialId, ConnectionStore.CRED_PROFILE_USER, profile.password);
            }

            resolve(profile);
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

            if (profile.savePassword === true) {
                let credentialId = ConnectionStore.formatCredentialId(profile.server, profile.database, profile.user);
                self._credentialStore.removeCredentialByName(credentialId, ConnectionStore.CRED_PROFILE_USER);
            }

            // save all profiles
            self._context.globalState.update(Constants.configMyConnections, configValues);
            resolve(found);
        });
    }

    // maps credentials to user-displayable items
    private mapToQuickPickItems(connections: IConnectionCredentials[]): IConnectionCredentialsQuickPickItem[] {
        return connections.map( (item: IConnectionCredentials) => {
            return <IConnectionCredentialsQuickPickItem> {
                label: ConnInfo.getPicklistLabel(item),
                description: ConnInfo.getPicklistDescription(item),
                detail: ConnInfo.getPicklistDetails(item),
                connectionCreds: item,
                isNewConnectionQuickPickItem: false
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
