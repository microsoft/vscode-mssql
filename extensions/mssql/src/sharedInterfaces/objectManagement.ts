/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-languageclient";
import { FormEvent, FormItemSpec, FormReducers, FormState } from "./form";
import { ApiStatus } from "./webview";
import { TaskExecutionMode } from "./task";

export interface ObjectManagementService {
    /**
     * Backup a database.
     * @param connectionUri The URI of the server connection.
     * @param backupInfo Various settings for how to backup the database.
     * @param taskMode Whether to run the backup operation, generate a script for it, or both.
     * @returns A response indicating if the backup or scripting operation started successfully.
     */
    backupDatabase(
        connectionUri: string,
        backupInfo: BackupInfo,
        taskMode: TaskExecutionMode,
    ): Thenable<BackupResponse>;
}

//#region Sql Tools Service Interfaces
export namespace BackupRequest {
    export const type = new RequestType<BackupParams, BackupResponse, void, void>("backup/backup");
}

export interface BackupParams {
    ownerUri: string;
    BackupInfo: BackupInfo;
    taskExecutionMode: TaskExecutionMode;
}

export interface BackupResponse {
    success: boolean;
    taskId: number;
}

//#endregion

//#region Backup Database
export interface BackupInfo {
    /**
     * Name of the database to perform backup
     */
    databaseName: string;

    /**
     * Component to backup - Database or Files
     */
    backupComponent: number;

    /**
     * Type of backup - Full / Differential / Log
     */
    backupType: number;

    /**
     * Backup device - Disk, Url, etc.
     */
    backupDeviceType: number;

    /**
     * The text input of selected files
     */
    selectedFiles: string;

    /**
     * Backup set name
     */
    backupsetName: string;

    /**
     * List of selected file groups
     */
    selectedFileGroup: Record<string, string>;

    /**
     * List of { key: backup path, value: device type }
     */
    backupPathDevices: Record<string, number>;

    /**
     * List of selected backup paths
     */
    backupPathList: string[];

    /**
     * Indicates if the backup should be copy-only
     */
    isCopyOnly: boolean;

    /**
     * Determines whether media is formatted as the first step of backup
     */
    formatMedia: boolean;

    /**
     * Determines whether backup devices are initialized
     */
    initialize: boolean;

    /**
     * Determines whether the tape header is read
     */
    skipTapeHeader: boolean;

    /**
     * Name used to identify a particular media set
     */
    mediaName: string;

    /**
     * Description of the medium that contains a backup set
     */
    mediaDescription: string;

    /**
     * Determines whether checksum is calculated during backup
     */
    checksum: boolean;

    /**
     * Determines whether backup continues after a checksum error
     */
    continueAfterError: boolean;

    /**
     * Determines whether to truncate the database log
     */
    logTruncation: boolean;

    /**
     * Determines whether to back up the tail of the log
     */
    tailLogBackup: boolean;

    /**
     * Description for a particular backup set
     */
    backupSetDescription: string;

    /**
     * Number of days before a backup set can be overwritten
     */
    retainDays: number;

    /**
     * Date and time when the backup set expires
     */
    expirationDate: Date;

    /**
     * Backup compression option
     */
    compressionOption: number;

    /**
     * Determines whether verify is required
     */
    verifyBackupRequired: boolean;

    /**
     * Backup encryption algorithm
     */
    encryptionAlgorithm: number;

    /**
     * Backup encryptor type
     */
    encryptorType: number;

    /**
     * Name of the encryptor
     */
    encryptorName: string;
}

export class BackupDatabaseState
    implements FormState<BackupDatabaseFormState, BackupDatabaseState, BackupDatabaseFormItemSpec>
{
    loadState: ApiStatus = ApiStatus.Loading;
    errorMessage?: string;
    databaseNode: BackupDatabaseNode = {} as BackupDatabaseNode;
    formState: BackupDatabaseFormState = {} as BackupDatabaseFormState;
    formComponents: Partial<Record<keyof BackupDatabaseFormState, BackupDatabaseFormItemSpec>> = {};
    formErrors: string[] = [];
}

export interface BackupDatabaseNode {
    label: string;
    nodePath: string;
    nodeStatus: string;
}

export interface BackupDatabaseReducers extends FormReducers<BackupDatabaseFormState> {
    /**
     * Handles form-related actions and state updates.
     */
    formAction: {
        event: FormEvent<BackupDatabaseFormState>;
    };
    /**
     * Gets the database information associated with the backup operation
     */
    getDatabase: {};
}

export interface BackupDatabaseProvider {
    /**
     * Handles form-related actions and state updates.
     * @param event The form event containing the action and data.
     */
    formAction(event: FormEvent<BackupDatabaseFormState>): void;

    /**
     * Gets the database information associated with the backup operation
     */
    getDatabase(): void;
}

export interface BackupDatabaseFormItemSpec
    extends FormItemSpec<BackupDatabaseFormState, BackupDatabaseState, BackupDatabaseFormItemSpec> {
    componentWidth: string;
}

export interface BackupDatabaseFormState {
    backupName: string;
    recoveryModel: RecoveryModel;
    backupType: BackupType;
    copyOnly: boolean;
    saveToUrl: boolean;
    backupFiles: string[];
    backupCompression: BackupCompression;
    encryptionEnabled: boolean;
    backupToExistingMediaSet: boolean;
    existingMediaSetBackupMethod: ExistingMediaSetBackupMethod;
    newMediaSetName: string;
    newMediaSetDescription: string;
    performChecksum: boolean;
    verifyBackup: boolean;
    continueOnError: boolean;
    logOption: LogOption;
    retainDays: number;
}

export enum RecoveryModel {
    Full = "Full",
    BulkLogged = "BulkLogged",
    Simple = "Simple",
}

export enum BackupType {
    Full = "Full",
    Differential = "Differential",
    TransactionLog = "TransactionLog",
}

export enum BackupCompression {
    Default = "Default",
    Compress = "Compress",
    NoCompression = "NoCompression",
}

export enum ExistingMediaSetBackupMethod {
    Append = "Append",
    Overwrite = "Overwrite",
}

export enum LogOption {
    Truncate = "Truncate",
    BackupTail = "BackupTail",
}

//#endregion
