/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from "extension-toolkit/base";
import { IConnectionGroup, IConnectionProfile } from "../models/interfaces";
import { Deferred } from "../protocol";
import type { ConfigTarget } from "./connectionconfig";

/**
 * Interface for a configuration file that stores connection profiles
 *
 * @export
 * @interface IConnectionConfig
 */
export const IConnectionConfig = createServiceIdentifier<IConnectionConfig>("connectionConfig");

export interface IConnectionConfig {
    readonly _serviceBrand: undefined;

    /**
     * Resolves once the connection config has finished loading connections and groups
     * from settings and any required migration/initialization has completed.
     */
    readonly initialized: Deferred<void>;

    getConnections(): Promise<IConnectionProfile[]>;
    getConnectionById(id: string): Promise<IConnectionProfile | undefined>;
    addConnection(profile: IConnectionProfile): Promise<void>;
    removeConnection(profile: IConnectionProfile): Promise<boolean>;
    updateConnection(updatedProfile: IConnectionProfile): Promise<void>;

    /**
     * Populates any missing metadata (group, ID, config source) on the given profile.
     * @returns true if the profile was modified.
     */
    populateMissingConnectionMetadata(profile: IConnectionProfile): boolean;

    getRootGroup(): IConnectionGroup | undefined;
    getGroups(location?: ConfigTarget): Promise<IConnectionGroup[]>;
    getGroupById(id: string): IConnectionGroup | undefined;
    addGroup(group: IConnectionGroup): Promise<void>;
    removeGroup(id: string, contentAction?: "delete" | "move"): Promise<boolean>;
    updateGroup(updatedGroup: IConnectionGroup): Promise<void>;
}
