/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface FavoritableOption {
    value: string;
    favoriteId?: string;
}

export function sortOptionsWithFavorites<T extends FavoritableOption>(
    options: T[],
    favoriteOptionIds?: string[],
): T[] {
    if (favoriteOptionIds === undefined) {
        return options;
    }

    const favoriteIds = new Set(favoriteOptionIds);
    return options
        .map((option, index) => ({ option, index }))
        .sort((a, b) => {
            const aIsFavorite = favoriteIds.has(a.option.favoriteId ?? a.option.value);
            const bIsFavorite = favoriteIds.has(b.option.favoriteId ?? b.option.value);
            return aIsFavorite === bIsFavorite ? a.index - b.index : aIsFavorite ? -1 : 1;
        })
        .map(({ option }) => option);
}

export function findOptionIndex<T extends FavoritableOption>(options: T[], option: T): number {
    return options.findIndex((candidate) => candidate.value === option.value);
}

export function findFirstFavoriteOption<T extends FavoritableOption>(
    options: T[],
    favoriteOptionIds?: string[],
): T | undefined {
    if (!favoriteOptionIds?.length) {
        return undefined;
    }

    const favoriteIds = new Set(favoriteOptionIds);
    return options.find((option) => favoriteIds.has(option.favoriteId ?? option.value));
}
