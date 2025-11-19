/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConnectionProfile } from "../models/interfaces";

/**
 * Interface for a configuration file that stores connection profiles
 *
 * @export
 * @interface IConnectionConfig
 */
export interface IConnectionConfig {
    addConnection(profile: IConnectionProfile): Promise<void>;
    getConnections(getWorkspaceConnections: boolean): Promise<IConnectionProfile[]>;
    removeConnection(profile: IConnectionProfile): Promise<boolean>;
}
