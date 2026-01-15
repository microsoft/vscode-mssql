/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { MetadataType } from "./metadata";

/**
 * Represents a database object in search results
 */
export interface SearchResultItem {
    name: string;
    schema: string;
    type: MetadataType;
    typeName: string; // Friendly display name (e.g., "Table", "View", "Stored Procedure")
    fullName: string; // schema.name
}

/**
 * Filter settings for object types
 */
export interface ObjectTypeFilters {
    tables: boolean;
    views: boolean;
    storedProcedures: boolean;
    functions: boolean;
}

/**
 * State for the Global Search webview
 */
export interface GlobalSearchWebViewState {
    // Connection info
    serverName: string;
    connectionUri: string;

    // Database selection
    selectedDatabase: string;
    availableDatabases: string[];

    // Search state
    searchTerm: string;
    isSearching: boolean;

    // Filter state
    objectTypeFilters: ObjectTypeFilters;

    // Results
    searchResults: SearchResultItem[];
    totalResultCount: number;

    // UI state
    loadStatus: ApiStatus;
    errorMessage?: string;
}

/**
 * Context methods available to React components
 */
export interface GlobalSearchContextProps {
    // Search
    search: (searchTerm: string) => void;
    clearSearch: () => void;

    // Filters
    setDatabase: (database: string) => void;
    toggleObjectTypeFilter: (objectType: keyof ObjectTypeFilters) => void;

    // Object Actions
    scriptObject: (object: SearchResultItem, scriptType: "CREATE" | "DROP" | "SELECT") => void;
    copyObjectName: (object: SearchResultItem) => void;

    // Data refresh
    refreshDatabases: () => void;
    refreshResults: () => void;
}

/**
 * Reducer action payloads
 */
export interface GlobalSearchReducers {
    // Search
    search: { searchTerm: string };
    clearSearch: {};

    // Filters
    setDatabase: { database: string };
    toggleObjectTypeFilter: { objectType: keyof ObjectTypeFilters };

    // Object Actions
    scriptObject: { object: SearchResultItem; scriptType: "CREATE" | "DROP" | "SELECT" };
    copyObjectName: { object: SearchResultItem };

    // Data refresh
    refreshDatabases: {};
    refreshResults: {};
}
