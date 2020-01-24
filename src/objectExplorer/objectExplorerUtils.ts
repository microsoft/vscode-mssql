/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import { TreeNodeInfo } from './treeNodeInfo';
import { IConnectionProfile } from '../models/interfaces';
import Constants = require('../constants/constants');
import LocalizedConstants = require('../constants/localizedConstants');

export class ObjectExplorerUtils {

    public static readonly rootPath: string = path.join(__dirname, 'objectTypes');

    public static iconPath(label: string): string {
        if (label) {
            if (label === Constants.disconnectedServerLabel) {
                // if disconnected
                label = `${Constants.serverLabel}_red`;
            } else if (label === Constants.serverLabel) {
                // if connected
                label += '_green';
            }
            return path.join(ObjectExplorerUtils.rootPath, `${label}.svg`);
        }
    }

    public static getNodeUri(node: TreeNodeInfo): string {
        const profile = <IConnectionProfile>node.connectionCredentials;
        return ObjectExplorerUtils.getNodeUriFromProfile(profile);
    }

    public static getNodeUriFromProfile(profile: IConnectionProfile): string {
        let uri: string;
        if (profile.authenticationType === Constants.sqlAuthentication) {
            uri = `${profile.server}_${profile.database}_${profile.user}_${profile.profileName}`;
        } else {
            uri = `${profile.server}_${profile.database}_${profile.profileName}`;
        }
        return uri;
    }

    public static getDatabaseName(node: TreeNodeInfo): string {
        if (node.nodeType === Constants.serverLabel ||
            node.nodeType === Constants.disconnectedServerLabel) {
            return node.connectionCredentials.database;
        }
        while (node) {
            if (node.metadata) {
                if (node.metadata.metadataTypeName === Constants.databaseString) {
                    return node.metadata.name;
                }
            }
            node = node.parentNode;
        }
        return LocalizedConstants.defaultDatabaseLabel;
    }

    public static isFirewallError(errorMessage: string): boolean {
        return errorMessage.includes(Constants.firewallErrorMessage);
    }
}
