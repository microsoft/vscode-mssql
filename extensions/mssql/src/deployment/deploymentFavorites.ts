/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    configFavoriteAzureResourceGroups,
    configFavoriteAzureServers,
    configSelectedAzureSubscriptions,
    configSelectedFabricWorkspaces,
} from "../constants/constants";
import {
    FavoriteResourceType,
    FormItemOptions,
    sortOptionsByFavoriteOrder,
} from "../sharedInterfaces/form";

const favoriteConfigKeys: Record<FavoriteResourceType, string> = {
    [FavoriteResourceType.AzureSubscription]: configSelectedAzureSubscriptions,
    [FavoriteResourceType.AzureResourceGroup]: configFavoriteAzureResourceGroups,
    [FavoriteResourceType.AzureServer]: configFavoriteAzureServers,
    [FavoriteResourceType.FabricWorkspace]: configSelectedFabricWorkspaces,
};

export function getFavoriteIds(resourceType: FavoriteResourceType): string[] {
    const favoriteIds = vscode.workspace
        .getConfiguration()
        .get<string[]>(favoriteConfigKeys[resourceType], []);
    return resourceType === FavoriteResourceType.AzureSubscription
        ? favoriteIds.map((id) => id.slice(id.lastIndexOf("/") + 1))
        : favoriteIds;
}

export function applyFavorites(
    options: FormItemOptions[],
    resourceType: FavoriteResourceType,
    getFavoriteId: (option: FormItemOptions) => string = (option) => option.value,
): FormItemOptions[] {
    const favoriteIds = getFavoriteIds(resourceType);
    const favoriteOrderById = new Map(favoriteIds.map((id, index) => [id, index]));
    return sortOptionsByFavoriteOrder(
        options.map((option) => {
            const favoriteId = getFavoriteId(option);
            const favoriteOrder = favoriteOrderById.get(favoriteId);
            return {
                ...option,
                favoriteResourceType: resourceType,
                favoriteId,
                isFavorite: favoriteOrder !== undefined,
                favoriteOrder,
            };
        }),
    );
}

export async function toggleFavorite(
    resourceType: FavoriteResourceType,
    favoriteId: string,
): Promise<string[]> {
    const configKey = favoriteConfigKeys[resourceType];
    const config = vscode.workspace.getConfiguration();
    const rawFavoriteIds = config.get<string[]>(configKey, []);
    const favoriteIds =
        resourceType === FavoriteResourceType.AzureSubscription
            ? rawFavoriteIds.map((id) => id.slice(id.lastIndexOf("/") + 1))
            : rawFavoriteIds;
    const nextIds = favoriteIds.includes(favoriteId)
        ? favoriteIds.filter((id) => id !== favoriteId)
        : [...favoriteIds, favoriteId];
    await config.update(configKey, nextIds, vscode.ConfigurationTarget.Global);
    return nextIds;
}
