'use strict';
import vscode = require('vscode');
import Constants = require('./constants');
import ConnInfo = require('./connectionInfo');
import Interfaces = require('./interfaces');
import Utils = require('../models/utils');

export class RecentConnections {
    // Load connections from user preferences and return them as a formatted picklist
    public getPickListItems(): Promise<Interfaces.IConnectionCredentialsQuickPickItem[]> {
        const self = this;
        return new Promise<Interfaces.IConnectionCredentialsQuickPickItem[]>((resolve, reject) => {
            self.loadConnections()
            .then(function(connections): void
            {
                const pickListItems = connections.map( (item: Interfaces.IConnectionCredentials) => {
                    return <Interfaces.IConnectionCredentialsQuickPickItem> {
                        label: ConnInfo.getPicklistLabel(item),
                        description: ConnInfo.getPicklistDescription(item),
                        detail: ConnInfo.getPicklistDetails(item),
                        connectionCreds: item
                    };
                });
                resolve(pickListItems);
            });
        });
    }

    // Load connections from user preferences
    private loadConnections(): Promise<Interfaces.IConnectionCredentials[]> {
        return new Promise<Interfaces.IConnectionCredentials[]>((resolve, reject) => {
            // Load connections from user preferences
            // Per this https://code.visualstudio.com/Docs/customization/userandworkspace
            // Settings defined in workspace scope overwrite the settings defined in user scope
            let connections: Interfaces.IConnectionCredentials[] = [];
            let config = vscode.workspace.getConfiguration(Constants.gExtensionName);
            let configValues = config[Constants.gConfigMyConnections];
            for (let index = 0; index < configValues.length; index++) {
                let element = configValues[index];
                if (element.server && element.server.trim() && !element.server.trim().startsWith('{{')) {
                    let connection = ConnInfo.fixupConnectionCredentials(element);
                    connections.push(connection);
                } else {
                    Utils.logDebug(Constants.gConfigMyConnectionsNoServerName + ' index (' + index + '): ' + element.toString());
                }
            }
            resolve(connections);
        });
    }
}
