/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DisasterRecoveryReducers,
    DisasterRecoveryAzureFormState,
    DisasterRecoveryViewModel,
    DisasterRecoveryProvider,
    ObjectManagementWebviewState,
} from "./objectManagement";
import { MediaDeviceType } from "./backup";
import { FileBrowserProvider, FileBrowserReducers } from "./fileBrowser";
import { FormContextProps, FormReducers } from "./form";
import { TaskExecutionMode } from "./schemaCompare";
import { ApiStatus } from "./webview";
import { BlobItem } from "@azure/storage-blob";

//#region Sql Tools Service Interfaces

export interface RestoreParams extends RestoreInfo {
    ownerUri: string;
    options: { [key: string]: any };
    taskExecutionMode: TaskExecutionMode;
}

export interface RestoreInfo {
    /**
     * Restore session id. The parameter is optional and if passed, an existing plan will be used
     */
    sessionId?: string;

    /**
     * Comma delimited list of backup files
     */
    backupFilePaths?: string;

    deviceType?: MediaDeviceType;

    /**
     * Target Database name to restore to
     */
    targetDatabaseName?: string;

    /**
     * Source Database name to restore from
     */
    sourceDatabaseName?: string;

    /**
     * If set to true, the db files will be relocated to default data location in the server
     */
    relocateDbFiles?: boolean;

    /**
     * If set to true, the backup files will be used to create restore plan otherwise the source database name will be used
     */
    readHeaderFromMedia?: boolean;

    /**
     * Ids of the selected backup set to restore. If null, all backup sets will be selected. If empty list,
     * no backup sets will be selected
     */
    selectedBackupSets: string[] | null;

    /**
     * Optional parameter which indicates whether to overwrite target database by source database name.
     */
    overwriteTargetDatabase?: boolean;
}

export interface RestoreResponse {
    result: boolean;
    taskId: string;
    errorMessage: string;
}

export interface RestorePlanDetailInfo {
    /**
     * The name of the option from RestoreOptionsHelper
     */
    name: string;

    /**
     * The current value of the option
     */
    currentValue: any;

    /**
     * Indicates whether the option is read only or can be changed in client
     */
    isReadOnly: boolean;

    /**
     * Indicates whether the option should be visible in client
     */
    isVisible: boolean;

    /**
     * The default value of the option
     */
    defaultValue: any;

    /**
     * Error message if the current value is not valid
     */
    errorMessage: any;
}

export interface RestoreDatabaseFileInfo {
    /**
     * File type (Rows Data, Log ...)
     */
    fileType: string;

    /**
     * Logical Name
     */
    logicalFileName: string;

    /**
     * Original location of the file to restore to
     */
    originalFileName: string;

    /**
     * The file to restore to
     */
    restoreAsFileName: string;
}

export interface DatabaseFileInfo {
    properties: LocalizedPropertyInfo[];
    id: string;
    isSelected: boolean;
}

export interface LocalizedPropertyInfo {
    propertyName: string;
    propertyValue: string;
    propertyDisplayName: string;
    propertyValueDisplayName: string;
}

export interface RestorePlanResponse {
    /**
     * Restore session id, can be used in restore request to use an existing restore plan
     */
    sessionId: string;

    /**
     * The list of backup sets to restore
     */
    backupSetsToRestore: DatabaseFileInfo[];

    /**
     * Indicates whether the restore operation is supported
     */
    canRestore: boolean;

    /**
     * Errors occurred while creating restore plan
     */
    errorMessage: string;

    /**
     * The db files included in the backup file
     */
    dbFiles: RestoreDatabaseFileInfo[];

    /**
     * Database names extracted from backup sets
     */
    databaseNamesFromBackupSets: string[];

    /**
     * For testing purpose to verify the target database
     */
    databaseName?: string;

    /**
     * Plan details
     */
    planDetails: Record<string, RestorePlanDetailInfo>;
}

export interface RestoreConfigInfo {
    dataFileFolder: string;
    logFileFolder: string;
    defaultBackupFolder: string;
    sourceDatabaseNamesWithBackupSets: string[];
}

export interface RestorePlanDetails {
    backupTailLog: RestorePlanDetailInfo;
    closeExistingConnections: RestorePlanDetailInfo;
    dataFileFolder: RestorePlanDetailInfo;
    keepReplication: RestorePlanDetailInfo;
    lastBackupTaken: RestorePlanDetailInfo;
    logFileFolder: RestorePlanDetailInfo;
    overwriteTargetDatabase: RestorePlanDetailInfo;
    recoveryState: RestorePlanDetailInfo;
    relocateDbFiles: RestorePlanDetailInfo;
    replaceDatabase: RestorePlanDetailInfo;
    setRestrictedUser: RestorePlanDetailInfo;
    sourceDatabaseName: RestorePlanDetailInfo;
    standbyFile: RestorePlanDetailInfo;
    tailLogBackupFile: RestorePlanDetailInfo;
    tailLogWithNoRecovery: RestorePlanDetailInfo;
    targetDatabaseName: RestorePlanDetailInfo;
}

export interface RestoreConfigInfoResponse {
    /**
     * Config Info
     */
    configInfo: RestoreConfigInfo;

    /**
     * Errors occurred while creating the restore config info
     */
    errorMessage: string;
}
//#endregion

export class RestoreDatabaseViewModel extends DisasterRecoveryViewModel {
    serverName: string = "";
    restorePlan: RestorePlanResponse | undefined = undefined;
    restorePlanStatus: ApiStatus = ApiStatus.NotStarted;
    blobs: BlobItem[] = [];
    cachedRestorePlanParams: RestoreParams | undefined = undefined;
    selectedBackupSets: string[] = [];
}

export interface RestoreDatabaseParams {
    state: ObjectManagementWebviewState<RestoreDatabaseFormState>;
    taskExecutionMode: TaskExecutionMode;
}

export interface RestoreDatabaseFormState extends DisasterRecoveryAzureFormState {
    // Database fields/ general fields
    sourceDatabaseName: string;
    targetDatabaseName: string;

    // Restore-specific Azure field
    blob: string;

    // Advanced options
    relocateDbFiles: boolean;
    replaceDatabase: boolean;
    keepReplication: boolean;
    setRestrictedUser: boolean;
    recoveryState: string;
    backupTailLog: boolean;
    tailLogWithNoRecovery: boolean;
    closeExistingConnections: boolean;

    // File browser fields
    dataFileFolder: string;
    logFileFolder: string;
    standbyFile: string;
    tailLogBackupFile: string;
}

export interface RestoreDatabaseReducers<TFormState>
    extends FormReducers<TFormState>,
        FileBrowserReducers,
        DisasterRecoveryReducers {
    /**
     * Restores the database
     */
    restoreDatabase: {};

    /**
     * Opens the generated restore script in a new editor window
     */
    openRestoreScript: {};

    /**
     * Updates the selected backup sets to restore
     * @param selectedBackupSets  The list of selected backup set ids to restore
     */
    updateSelectedBackupSets: {
        selectedBackupSets: number[];
    };
}

export interface RestoreDatabaseProvider
    extends FormContextProps<RestoreDatabaseFormState>,
        FileBrowserProvider,
        DisasterRecoveryProvider {
    /**
     * Restores the database based on the provided restore information
     */
    restoreDatabase(): void;

    /**
     * Opens the generated restore script in a new editor window
     */
    openRestoreScript(): void;

    /**
     * Updates the selected backup sets to restore
     * @param selectedBackupSets  The list of selected backup set ids to restore
     */
    updateSelectedBackupSets(selectedBackupSets: number[]): void;
}

export enum RecoveryState {
    WithRecovery = "WithRecovery",
    NoRecovery = "WithNoRecovery",
    Standby = "WithStandby",
}

export enum RestorePlanTableType {
    BackupSets,
    DatabaseFiles,
}
