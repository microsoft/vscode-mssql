'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import ConnInfo = require('./connectionInfo');
import Utils = require('../models/utils');
import { IConnectionCredentials, IConnectionProfile, IConnectionCredentialsQuickPickItem } from '../models/interfaces';

export class RecentConnections {
    private _context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
    }

    // Load connections from user preferences and return them as a formatted picklist
    public getPickListItems(): Promise<IConnectionCredentialsQuickPickItem[]> {
        const self = this;
        return new Promise<IConnectionCredentialsQuickPickItem[]>((resolve, reject) => {
            self.loadConnections()
            .then(function(connections): void
            {
                const pickListItems = connections.map( (item: IConnectionCredentials) => {
                    return <IConnectionCredentialsQuickPickItem> {
                        label: ConnInfo.getPicklistLabel(item),
                        description: ConnInfo.getPicklistDescription(item),
                        detail: ConnInfo.getPicklistDetails(item),
                        connectionCreds: item,
                        isNewConnectionQuickPickItem: false
                    };
                });

                // Always add an "Add New Connection" quickpick item
                pickListItems.push(<IConnectionCredentialsQuickPickItem> {
                        label: Constants.RegisterNewConnectionLabel,
                        connectionCreds: undefined,
                        isNewConnectionQuickPickItem: true
                    });
                resolve(pickListItems);
            });
        });
    }

    public saveConnection(profile: IConnectionProfile): Promise<void> {
        const self = this;
        return new Promise<void>((resolve, reject) => {
            // Get all profiles
            let configValues = self._context.globalState.get<IConnectionProfile[]>(Constants.configMyConnections);
            if (!configValues) {
                configValues = [];
            }

            // Remove the profile if already set
            configValues.filter(value => value.profileName !== profile.profileName);

            // Add the profile back
            configValues.push(profile);

            // saveConnection
            self._context.globalState.update(Constants.configMyConnections, configValues);
            resolve();
        });
    }

    // Load connections from user preferences
    private loadConnections(): Promise<IConnectionCredentials[]> {
        let self = this;
        return new Promise<IConnectionCredentials[]>((resolve, reject) => {
            // Load connections from user preferences
            // Per this https://code.visualstudio.com/Docs/customization/userandworkspace
            // Settings defined in workspace scope overwrite the settings defined in user scope
            let connections: IConnectionCredentials[] = [];
            let config = vscode.workspace.getConfiguration(Constants.extensionName);

            // first read from the user settings
            let configValues = config[Constants.configMyConnections];
            self.addConnections(connections, configValues);

            // next read from the global state
            configValues = self._context.globalState.get<IConnectionProfile[]>(Constants.configMyConnections);
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
