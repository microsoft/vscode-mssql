/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SqlToolsServiceClient from "../languageservice/serviceclient";
import {
    GetServerContextualizationRequest,
    ListDatabasesRequest,
    MetadataListRequest,
    TableMetadataRequest,
    ViewMetadataRequest,
} from "../models/contracts/metadataContracts";
import {
    ColumnMetadata,
    DatabaseInfo,
    GetServerContextualizationParams,
    GetServerContextualizationResult,
    ListDatabasesParams,
    ListDatabasesResult,
    MetadataListParams,
    MetadataListResult,
    ObjectMetadata,
    TableMetadataParams,
    TableMetadataResult,
} from "../sharedInterfaces/metadata";
import { getErrorMessage } from "../utils/utils";

/**
 * Interface for the Metadata Service that handles database metadata operations.
 */
export interface IMetadataService {
    /**
     * Gets the SQL Tools Service client instance.
     */
    readonly sqlToolsClient: SqlToolsServiceClient;

    /**
     * Retrieves metadata for all database objects (tables, views, stored procedures, functions).
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to an array of ObjectMetadata
     */
    getMetadata(ownerUri: string): Promise<ObjectMetadata[]>;

    /**
     * Retrieves column metadata for a specific table.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The table name
     * @returns A Promise that resolves to an array of ColumnMetadata
     */
    getTableInfo(ownerUri: string, schema: string, objectName: string): Promise<ColumnMetadata[]>;

    /**
     * Retrieves column metadata for a specific view.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The view name
     * @returns A Promise that resolves to an array of ColumnMetadata
     */
    getViewInfo(ownerUri: string, schema: string, objectName: string): Promise<ColumnMetadata[]>;

    /**
     * Lists all databases on the connected server.
     *
     * @param ownerUri - The URI identifying the connection
     * @param includeDetails - Whether to include detailed database information
     * @returns A Promise that resolves to either an array of database names or DatabaseInfo objects
     */
    getDatabases(ownerUri: string, includeDetails?: boolean): Promise<string[] | DatabaseInfo[]>;

    /**
     * Generates CREATE scripts for database objects (used for AI contextualization).
     *
     * @param ownerUri - The URI identifying the connection
     * @param databaseName - The target database name
     * @returns A Promise that resolves to a string containing the generated CREATE statements
     */
    getServerContext(ownerUri: string, databaseName: string): Promise<string>;
}

export class MetadataService implements IMetadataService {
    constructor(private _client: SqlToolsServiceClient) {}

    /**
     * Gets the SQL Tools Service client instance.
     * @returns The SQL Tools Service client used for database operations.
     */
    public get sqlToolsClient(): SqlToolsServiceClient {
        return this._client;
    }

    /**
     * Retrieves metadata for all database objects (tables, views, stored procedures, functions).
     *
     * @param ownerUri - The URI identifying the connection
     * @returns A Promise that resolves to an array of ObjectMetadata
     * @throws Logs error and re-throws if the request fails
     */
    public async getMetadata(ownerUri: string): Promise<ObjectMetadata[]> {
        try {
            const params: MetadataListParams = {
                ownerUri: ownerUri,
            };

            const result: MetadataListResult = await this._client.sendRequest(
                MetadataListRequest.type,
                params,
            );

            return result?.metadata ?? [];
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    /**
     * Retrieves column metadata for a specific table.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The table name
     * @returns A Promise that resolves to an array of ColumnMetadata
     * @throws Logs error and re-throws if the request fails
     */
    public async getTableInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
    ): Promise<ColumnMetadata[]> {
        return this.getObjectColumnInfo(ownerUri, schema, objectName, "table");
    }

    /**
     * Retrieves column metadata for a specific view.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The view name
     * @returns A Promise that resolves to an array of ColumnMetadata
     * @throws Logs error and re-throws if the request fails
     */
    public async getViewInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
    ): Promise<ColumnMetadata[]> {
        return this.getObjectColumnInfo(ownerUri, schema, objectName, "view");
    }

    /**
     * Retrieves column metadata for a specific table or view.
     *
     * @param ownerUri - The URI identifying the connection
     * @param schema - The schema name (e.g., "dbo")
     * @param objectName - The object name
     * @param objectType - The type of object ("table" or "view")
     * @returns A Promise that resolves to an array of ColumnMetadata
     * @throws Logs error and re-throws if the request fails
     */
    private async getObjectColumnInfo(
        ownerUri: string,
        schema: string,
        objectName: string,
        objectType: "table" | "view",
    ): Promise<ColumnMetadata[]> {
        try {
            const params: TableMetadataParams = {
                ownerUri: ownerUri,
                schema: schema,
                objectName: objectName,
            };

            const requestType =
                objectType === "table" ? TableMetadataRequest.type : ViewMetadataRequest.type;

            const result: TableMetadataResult = await this._client.sendRequest(requestType, params);

            return result?.columns ?? [];
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    /**
     * Lists all databases on the connected server.
     *
     * @param ownerUri - The URI identifying the connection
     * @param includeDetails - Whether to include detailed database information (default: false)
     * @returns A Promise that resolves to either an array of database names or DatabaseInfo objects
     * @throws Logs error and re-throws if the request fails
     */
    public async getDatabases(
        ownerUri: string,
        includeDetails: boolean = false,
    ): Promise<string[] | DatabaseInfo[]> {
        try {
            const params: ListDatabasesParams = {
                ownerUri: ownerUri,
                includeDetails: includeDetails,
            };

            const result: ListDatabasesResult = await this._client.sendRequest(
                ListDatabasesRequest.type,
                params,
            );

            if (includeDetails && result.databases) {
                return result.databases;
            }

            return result.databaseNames || [];
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }

    /**
     * Generates CREATE scripts for database objects (used for AI contextualization).
     *
     * @param ownerUri - The URI identifying the connection
     * @param databaseName - The target database name
     * @returns A Promise that resolves to a string containing the generated CREATE statements
     * @throws Logs error and re-throws if the request fails
     */
    public async getServerContext(ownerUri: string, databaseName: string): Promise<string> {
        try {
            const params: GetServerContextualizationParams = {
                ownerUri: ownerUri,
                databaseName: databaseName,
            };

            const result: GetServerContextualizationResult = await this._client.sendRequest(
                GetServerContextualizationRequest.type,
                params,
            );

            return result.context;
        } catch (error) {
            this._client.logger.error(getErrorMessage(error));
            throw error;
        }
    }
}
