/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import { ObjectMetadata } from "vscode-mssql";
import { getErrorMessage } from "../utils/utils";
import * as vscode from "vscode";
import {
    MetadataQueryRequest,
    MetadataQueryParams,
    MetadataQueryResult,
} from "../models/contracts/metadata/metadataRequest";

export interface DatabaseObject {
    name: string;
    type: string;
    schema: string;
    fullName: string;
}

export interface SearchResult {
    success: boolean;
    objects: DatabaseObject[];
    error?: string;
}

export class DatabaseObjectSearchService {
    private _client: SqlToolsServiceClient;
    private static _metadataCache: Map<string, ObjectMetadata[]> = new Map();

    constructor(client?: SqlToolsServiceClient) {
        this._client = client || SqlToolsServiceClient.instance;
    }

    /**
     * Search for database objects matching the given search term using metadata/list API
     */
    public async searchObjects(
        connectionUri: string,
        searchTerm: string,
        _database?: string, // reserved for future reconnection support; not used server-side
    ): Promise<SearchResult> {
        try {
            const term = (searchTerm ?? "").trim();
            if (!term) {
                return {
                    success: false,
                    objects: [],
                    error: vscode.l10n.t("Search term cannot be empty"),
                };
            }
            const lower = term.toLowerCase();

            // Ensure cache for this connection
            await this.warmCache(connectionUri).catch(() => undefined);
            let metadata: ObjectMetadata[] = [];
            try {
                metadata = await this.getOrFetchMetadata(connectionUri);
            } catch {
                // ignore and rely on fallback
                metadata = [];
            }

            // Filter by schema/name contains
            const filtered = metadata.filter((m) => {
                const n = (m.name ?? "").toLowerCase();
                const s = (m.schema ?? "").toLowerCase();
                return n.includes(lower) || s.includes(lower);
            });

            let objects: DatabaseObject[] = filtered
                .map((m) => ({
                    name: m.name,
                    schema: m.schema,
                    type: this.friendlyType(m),
                    fullName: m.schema ? `${m.schema}.${m.name}` : m.name,
                }))
                .filter((o) => !!o.name);

            return { success: true, objects };
        } catch (error) {
            return { success: false, objects: [], error: getErrorMessage(error) };
        }
    }

    /**
     * Clears cached metadata for a connection or all connections if none provided
     * Static so callers don't need to instantiate the service just to clear cache.
     */
    public static clearCache(connectionUri?: string): void {
        if (connectionUri) {
            DatabaseObjectSearchService._metadataCache.delete(connectionUri);
        } else {
            DatabaseObjectSearchService._metadataCache.clear();
        }
    }
    /** Pre-fetch and cache metadata for a connection to speed up first search */
    public async warmCache(connectionUri: string): Promise<void> {
        if (DatabaseObjectSearchService._metadataCache.has(connectionUri)) {
            return;
        }
        const params: MetadataQueryParams = { ownerUri: connectionUri } as MetadataQueryParams;
        try {
            const result: MetadataQueryResult = await this._client.sendRequest(
                MetadataQueryRequest.type,
                params,
            );
            DatabaseObjectSearchService._metadataCache.set(connectionUri, result?.metadata ?? []);
        } catch {
            DatabaseObjectSearchService._metadataCache.set(connectionUri, []);
        }
    }

    private async getOrFetchMetadata(connectionUri: string): Promise<ObjectMetadata[]> {
        const cached = DatabaseObjectSearchService._metadataCache.get(connectionUri);
        if (cached) {
            return cached;
        }
        const params: MetadataQueryParams = { ownerUri: connectionUri } as MetadataQueryParams;
        const result: MetadataQueryResult = await this._client.sendRequest(
            MetadataQueryRequest.type,
            params,
        );
        const md = result?.metadata ?? [];
        DatabaseObjectSearchService._metadataCache.set(connectionUri, md);
        return md;
    }

    private friendlyType(m: ObjectMetadata): string {
        switch (m?.metadataTypeName) {
            case "Table":
                return "Table";
            case "View":
                return "View";
            case "StoredProcedure":
                return "Stored Procedure";
            case "ScalarValuedFunction":
                return "Scalar Function";
            case "TableValuedFunction":
                return "Table-valued Function";
            default:
                return m?.metadataTypeName ?? "";
        }
    }
}
