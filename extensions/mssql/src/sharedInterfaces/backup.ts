/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormContextProps, FormReducers } from "./form";
import { FileBrowserProvider, FileBrowserReducers } from "./fileBrowser";
import { TaskExecutionMode } from "./schemaCompare";
import {
    DisasterRecoveryAzureFormState,
    DisasterRecoveryReducers,
    DisasterRecoveryViewModel,
    DisasterRecoveryProvider,
    ObjectManagementWebviewState,
} from "./objectManagement";

//#region Sql Tools Service Interfaces

export interface BackupParams {
    ownerUri: string;
    BackupInfo: BackupInfo;
    taskExecutionMode: TaskExecutionMode;
}

export interface BackupResponse {
    result: boolean;
    taskId: number;
}

export interface DefaultDatabaseInfoParams {
    ownerUri: string;
}

export interface BackupConfigInfoResponse {
    backupConfigInfo: BackupConfigInfo;
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
     * Number of days before a backup set can be overwritten
     */
    retainDays: number;

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

export interface BackupConfigInfo {
    recoveryModel: string;
    defaultBackupFolder: string;
    backupEncryptors: BackupEncryptor[];
}

export interface BackupEncryptor {
    encryptorType: number;
    encryptorName: string;
}

export class BackupDatabaseViewModel extends DisasterRecoveryViewModel {
    databaseName: string = "";
    backupEncryptors: BackupEncryptor[] = [];
    recoveryModel: string = "";
    defaultBackupName: string = "";
}

export interface BackupDatabaseParams {
    state: ObjectManagementWebviewState<BackupDatabaseFormState>;
    taskExecutionMode: TaskExecutionMode;
}

export interface BackupDatabaseReducers<TFormState>
    extends FormReducers<TFormState>, FileBrowserReducers, DisasterRecoveryReducers {
    /**
     * Gets the database information associated with the backup operation
     */
    backupDatabase: {};

    /**
     * Opens the generated backup script in a new editor window
     */
    openBackupScript: {};

    /**
     * Handles changes to backup file paths
     * @param index The index of the backup file being changed
     * @param newValue The new value for the backup file path
     * @param isFolderChange Indicates whether the change is for the folder path or the file name
     */
    handleFileChange: {
        index: number;
        newValue: string;
        isFolderChange: boolean;
    };
}

export interface BackupDatabaseProvider
    extends
        FormContextProps<BackupDatabaseFormState>,
        FileBrowserProvider,
        DisasterRecoveryProvider {
    /**
     * Backs up the database based on the provided backup information
     */
    backupDatabase(): void;

    /**
     * Opens the generated backup script in a new editor window
     */
    openBackupScript(): void;

    /**
     *  Handles changes to backup file paths
     * @param index    The index of the backup file being changed
     * @param newValue  The new value for the backup file path
     * @param isFolderChange  Indicates whether the change is for the folder path or the file name
     */
    handleFileChange(index: number, newValue: string, isFolderChange: boolean): void;
}

export interface BackupDatabaseFormState extends DisasterRecoveryAzureFormState {
    backupName: string;
    backupType: BackupType;
    copyOnly: boolean;
    backupCompression: BackupCompression;
    mediaSet: MediaSet;
    mediaSetName: string;
    mediaSetDescription: string;
    performChecksum: boolean;
    verifyBackup: boolean;
    continueOnError: boolean;
    transactionLog: LogOption;
    retainDays: number;
    encryptionEnabled: boolean;
    encryptionAlgorithm: EncryptionAlgorithm;
    encryptorName: string;
}

export interface BackupFile {
    filePath: string;
    isExisting: boolean;
    errorMessage?: string;
}

export enum BackupType {
    Full = "Full",
    Differential = "Differential",
    TransactionLog = "TransactionLog",
}

export function getBackupTypeNumber(backupType: BackupType): number {
    switch (backupType) {
        case BackupType.Full:
            return 0;
        case BackupType.Differential:
            return 1;
        case BackupType.TransactionLog:
            return 2;
        default:
            return 0;
    }
}

export enum BackupComponent {
    Database = 0,
    Files = 1,
}

/**
 * Backup physical device type: https://docs.microsoft.com/en-us/dotnet/api/microsoft.sqlserver.management.smo.backupdevicetype
 */
export enum PhysicalDeviceType {
    Disk = 2,
    FloppyA = 3,
    FloppyB = 4,
    Tape = 5,
    Pipe = 6,
    CDRom = 7,
    Url = 9,
    Unknown = 100,
}

/**
 * Backup media device type: https://docs.microsoft.com/en-us/dotnet/api/microsoft.sqlserver.management.smo.devicetype
 */
export enum MediaDeviceType {
    LogicalDevice = 0,
    Tape = 1,
    File = 2,
    Pipe = 3,
    VirtualDevice = 4,
    Url = 5,
}

export enum BackupCompression {
    Default = "Default",
    Compress = "Compress",
    NoCompression = "NoCompression",
}

export function getBackupCompressionNumber(compression: BackupCompression): number {
    switch (compression) {
        case BackupCompression.Default:
            return 0;
        case BackupCompression.Compress:
            return 1;
        case BackupCompression.NoCompression:
            return 2;
        default:
            return 0;
    }
}

export enum MediaSet {
    Append = "Append",
    Overwrite = "Overwrite",
    Create = "Create",
}

export enum LogOption {
    Truncate = "Truncate",
    BackupTail = "BackupTail",
}

export enum EncryptionAlgorithm {
    AES128 = "AES 128",
    AES192 = "AES 192",
    AES256 = "AES 256",
    TripleDES = "Triple DES",
}

export function getEncryptionAlgorithmNumber(algorithm: EncryptionAlgorithm): number {
    switch (algorithm) {
        case EncryptionAlgorithm.AES128:
            return 0;
        case EncryptionAlgorithm.AES192:
            return 1;
        case EncryptionAlgorithm.AES256:
            return 2;
        case EncryptionAlgorithm.TripleDES:
            return 3;
    }
}

//#endregion
