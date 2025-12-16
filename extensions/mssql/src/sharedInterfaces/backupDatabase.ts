/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormEvent, FormItemSpec, FormReducers, FormState } from "./form";
import { ApiStatus } from "./webview";

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
    isAdvancedOption: boolean;
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
