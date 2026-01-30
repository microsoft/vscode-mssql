/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ApiStatus } from "./webview";
import { MetadataType } from "./metadata";

/**
 * Script types available for GlobalSearch actions
 */
export type ScriptType = "SELECT" | "CREATE" | "DROP" | "ALTER" | "EXECUTE";

/**
 * Represents a database object in search results
 */
export interface SearchResultItem {
    name: string;
    schema: string;
    type: MetadataType;
    typeName: string; // Friendly display name (e.g., "Table", "View", "Stored Procedure")
    metadataTypeName: string; // Scripting type name (e.g., "Table", "View", "StoredProcedure")
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
    availableSchemas: string[];
    selectedSchemas: string[];

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
    toggleSchemaFilter: (schema: string) => void;
    selectAllSchemas: () => void;
    clearSchemaSelection: () => void;

    // Object Actions
    scriptObject: (object: SearchResultItem, scriptType: ScriptType) => void;
    editData: (object: SearchResultItem) => void;
    modifyTable: (object: SearchResultItem) => void;
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
    toggleSchemaFilter: { schema: string };
    selectAllSchemas: {};
    clearSchemaSelection: {};

    // Object Actions
    scriptObject: { object: SearchResultItem; scriptType: ScriptType };
    editData: { object: SearchResultItem };
    modifyTable: { object: SearchResultItem };
    copyObjectName: { object: SearchResultItem };

    // Data refresh
    refreshDatabases: {};
    refreshResults: {};
}
