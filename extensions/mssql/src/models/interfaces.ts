/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { AccountStore } from "../azure/accountStore";
import * as Constants from "../constants/constants";
import * as vscodeMssql from "vscode-mssql";
import { AzureAuthType } from "./contracts/azure";

export type ConfigSource = vscode.ConfigurationTarget | string;

// interfaces
export enum ContentType {
    Root = 0,
    Messages = 1,
    ResultsetsMeta = 2,
    Columns = 3,
    Rows = 4,
    SaveResults = 5,
    Copy = 6,
    EditorSelection = 7,
    OpenLink = 8,
    ShowError = 9,
    ShowWarning = 10,
    Config = 11,
    LocalizedTexts = 12,
}

export enum AuthenticationTypes {
    Integrated = 1,
    SqlLogin = 2,
    AzureMFA = 3,
}

export enum EncryptOptions {
    Optional = "Optional",
    Mandatory = "Mandatory",
    Strict = "Strict",
}

export const contentTypes = [
    Constants.outputContentTypeRoot,
    Constants.outputContentTypeMessages,
    Constants.outputContentTypeResultsetMeta,
    Constants.outputContentTypeColumns,
    Constants.outputContentTypeRows,
    Constants.outputContentTypeSaveResults,
    Constants.outputContentTypeCopy,
    Constants.outputContentTypeEditorSelection,
    Constants.outputContentTypeOpenLink,
    Constants.outputContentTypeShowError,
    Constants.outputContentTypeShowWarning,
    Constants.outputContentTypeConfig,
    Constants.localizedTexts,
];

/**
 * Extension of IConnectionInfo that adds metadata relevant to the MSSQL extension's handling of connection profiles,
 * such as the profile name, connection ID, connection group ID, and whether the password should be saved.
 */
export interface IConnectionProfile extends vscodeMssql.IConnectionInfo {
    profileName: string;
    id: string;
    groupId: string;
    savePassword: boolean;
    emptyPasswordInput: boolean;
    azureAuthType: AzureAuthType;
    accountStore: AccountStore;
    configSource: ConfigSource;
    isValidProfile(): boolean;
    isAzureActiveDirectory(): boolean;
}

export interface IConnectionGroup {
    id: string;
    name: string;
    configSource: ConfigSource;
    parentId?: string;
    color?: string;
    description?: string;
}

export enum CredentialsQuickPickItemType {
    Profile,
    Mru,
    NewConnection,
}

export interface IConnectionProfileWithSource extends IConnectionProfile {
    profileSource: CredentialsQuickPickItemType;
}

export interface IConnectionCredentialsQuickPickItem extends vscode.QuickPickItem {
    connectionCreds: vscodeMssql.IConnectionInfo;
    quickPickItemType: CredentialsQuickPickItemType;
}

// Obtained from an active connection to show in the status bar
export interface IConnectionProperties {
    serverVersion: string;
    currentUser: string;
    currentDatabase: string;
}

export interface IDbColumn {
    allowDBNull?: boolean;
    baseCatalogName: string;
    baseColumnName: string;
    baseSchemaName: string;
    baseServerName: string;
    baseTableName: string;
    columnName: string;
    columnOrdinal?: number;
    columnSize?: number;
    isAliased?: boolean;
    isAutoIncrement?: boolean;
    isExpression?: boolean;
    isHidden?: boolean;
    isIdentity?: boolean;
    isKey?: boolean;
    isBytes?: boolean;
    isChars?: boolean;
    isSqlVariant?: boolean;
    isUdt?: boolean;
    dataType: string;
    isXml?: boolean;
    isJson?: boolean;
    isLong?: boolean;
    isReadOnly?: boolean;
    isUnique?: boolean;
    numericPrecision?: number;
    numericScale?: number;
    udtAssemblyQualifiedName: string;
    dataTypeName: string;
}

export interface IGridResultSet {
    columns: IDbColumn[];
    rowsUri: string;
    numberOfRows: number;
}

export interface ISelectionData {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface IResultMessage {
    batchId?: number;
    isError: boolean;
    time: string;
    message: string;
}

export interface IGridBatchMetaData {
    resultSets: IGridResultSet[];
    hasError: boolean;
    selection: ISelectionData;
    startTime: string;
    endTime: string;
    totalTime: string;
}

export interface IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
    resultsFontSize: number;
    resultsFontFamily: string;
}

export interface ILogger {
    logDebug(message: string): void;
    increaseIndent(): void;
    decreaseIndent(): void;
    append(message?: string): void;
    appendLine(message?: string): void;
}

export interface IAzureSignInQuickPickItem extends vscode.QuickPickItem {
    command: string;
}

export class ResultSetSubset {
    rowCount: number;
    rows: vscodeMssql.DbCellValue[][];
}

export class ResultSetSummary {
    id: number;
    batchId: number;
    rowCount: number;
    columnInfo: vscodeMssql.IDbColumn[];
}

export class BatchSummary {
    id: number;
    selection: ISelectionData;
    resultSetSummaries: ResultSetSummary[];
    executionElapsed: string;
    executionEnd: string;
    executionStart: string;
}

export interface IGridResultSet {
    columns: IDbColumn[];
    rowsUri: string;
    numberOfRows: number;
}

export interface ISelectionData {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export interface IMessageLink {
    uri: string;
    text: string;
}

export interface IMessage {
    batchId?: number;
    time: string;
    message: string;
    isError: boolean;
    link?: IMessageLink;
}

export interface IGridIcon {
    showCondition: () => boolean;
    icon: () => string;
    hoverText: () => string;
    functionality: (batchId: number, resultId: number, index: number) => void;
}

export interface IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
}

export class QueryEvent {
    type: string;
    data: any;
}

export interface ISlickRange {
    fromCell: number;
    fromRow: number;
    toCell: number;
    toRow: number;
}

export interface IResultsConfig {
    shortcuts: { [key: string]: string };
    messagesDefaultOpen: boolean;
}

export interface ISelectionData {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
}

export enum FieldType {
    String = 0,
    Boolean = 1,
    Integer = 2,
    Decimal = 3,
    Date = 4,
    Unknown = 5,
}

export interface IColumnDefinition {
    id?: string;
    field?: string;
    name: string;
    type: FieldType;
    width?: number;
    cssClass?: string;
    focusable?: boolean;
    selectable?: boolean;
    asyncPostRender?: (cellRef: string, row: number, dataContext: JSON, colDef: any) => void;
    formatter?: (row: number, cell: any, value: any, columnDef: any, dataContext: any) => string;
}

export interface IGridDataRow {
    row?: number;
    values: any[];
}

/** Azure Account Interfaces */
export enum AzureLoginStatus {
    Initializing = "Initializing",
    LoggingIn = "LoggingIn",
    LoggedIn = "LoggedIn",
    LoggedOut = "LoggedOut",
}

export interface IAzureSession {
    readonly environment: any;
    readonly userId: string;
    readonly tenantId: string;
    readonly credentials: any;
}

export interface IAzureResourceFilter {
    readonly sessions: IAzureSession[];
    readonly subscription: ISubscription;
}

export interface ISubscription {
    /**
     * The fully qualified ID for the subscription. For example,
     * /subscriptions/00000000-0000-0000-0000-000000000000.
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly id?: string;
    /**
     * The subscription ID.
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly subscriptionId?: string;
    /**
     * The subscription display name.
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly displayName?: string;
    /**
     * The subscription state. Possible values are Enabled, Warned, PastDue, Disabled, and Deleted.
     * Possible values include: 'Enabled', 'Warned', 'PastDue', 'Disabled', 'Deleted'
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly state?: SubscriptionState;
    /**
     * The subscription policies.
     */
    subscriptionPolicies?: ISubscriptionPolicies;
    /**
     * The authorization source of the request. Valid values are one or more combinations of Legacy,
     * RoleBased, Bypassed, Direct and Management. For example, 'Legacy, RoleBased'.
     */
    authorizationSource?: string;
}

/**
 * Defines values for SubscriptionState.
 * Possible values include: 'Enabled', 'Warned', 'PastDue', 'Disabled', 'Deleted'
 * @readonly
 * @enum {string}
 */
export type SubscriptionState = "Enabled" | "Warned" | "PastDue" | "Disabled" | "Deleted";

/**
 * Subscription policies.
 */
export interface ISubscriptionPolicies {
    /**
     * The subscription location placement ID. The ID indicates which regions are visible for a
     * subscription. For example, a subscription with a location placement Id of Public_2014-09-01
     * has access to Azure public regions.
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly locationPlacementId?: string;
    /**
     * The subscription quota ID.
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly quotaId?: string;
    /**
     * The subscription spending limit. Possible values include: 'On', 'Off', 'CurrentPeriodOff'
     * **NOTE: This property will not be serialized. It can only be populated by the server.**
     */
    readonly spendingLimit?: SpendingLimit;
}

/**
 * Defines values for SpendingLimit.
 * Possible values include: 'On', 'Off', 'CurrentPeriodOff'
 * @readonly
 * @enum {string}
 */
export type SpendingLimit = "On" | "Off" | "CurrentPeriodOff";

export interface IDeferred<T, E extends Error = Error> {
    resolve: (result: T | Promise<T>) => void;
    reject: (reason: E) => void;
}
