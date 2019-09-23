/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as path from 'path';
import { TreeNodeInfo } from './treeNodeInfo';
import { IConnectionProfile } from '../models/interfaces';

export class ObjectExplorerUtils {

    public static readonly rootPath: string = path.join(__dirname, 'objectTypes');

    public static iconPath(label: string): string {
        if (label) {
            return path.join(ObjectExplorerUtils.rootPath, `${label}.svg`);
        }
    }

    public static getNodeUri(node: TreeNodeInfo): string {
        const nodeUri = node.nodePath + '_' + node.label;
        return nodeUri;
    }

    public static getNodeUriFromProfile(profile: IConnectionProfile): string {
        const uri = profile.server + '_' + profile.profileName;
        return uri;
    }
}
