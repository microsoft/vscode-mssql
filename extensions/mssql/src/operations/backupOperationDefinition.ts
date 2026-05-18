/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BackupInfo, BackupResponse } from "../sharedInterfaces/backup";
import { TaskExecutionMode } from "../enums";
import {
    OperationContext,
    OperationDefinition,
    OperationExecutionContext,
    OperationSummary,
    OperationValidationIssue,
} from "./operationSessionService";

export interface BackupOperationDraft {
    ownerUri: string;
    backupInfo: BackupInfo;
    taskExecutionMode: TaskExecutionMode;
}

export type BackupOperationCommand =
    | { type: "patch_backup_info"; set: Partial<BackupInfo> }
    | { type: "set_task_execution_mode"; taskExecutionMode: TaskExecutionMode };

export interface BackupExecutor {
    backup(draft: BackupOperationDraft): Promise<BackupResponse>;
}

export class BackupOperationDefinition
    implements OperationDefinition<BackupOperationDraft, BackupResponse, BackupOperationCommand>
{
    public readonly kind = "backup";

    constructor(private readonly executor: BackupExecutor) {}

    public createDefaultDraft(context: OperationContext): BackupOperationDraft {
        return {
            ownerUri: context.ownerUri ?? "",
            backupInfo: {
                databaseName: context.databaseName ?? "",
                backupComponent: 0,
                backupType: 0,
                backupDeviceType: 0,
                selectedFiles: "",
                backupsetName: "",
                selectedFileGroup: {},
                backupPathDevices: {},
                backupPathList: [],
                isCopyOnly: false,
                formatMedia: false,
                initialize: false,
                skipTapeHeader: false,
                mediaName: "",
                mediaDescription: "",
                checksum: false,
                continueAfterError: false,
                logTruncation: false,
                tailLogBackup: false,
                retainDays: 0,
                compressionOption: 0,
                verifyBackupRequired: false,
                encryptionAlgorithm: 0,
                encryptorType: 0,
                encryptorName: "",
            },
            taskExecutionMode: TaskExecutionMode.execute,
        };
    }

    public applyCommand(
        draft: BackupOperationDraft,
        command: BackupOperationCommand,
    ): BackupOperationDraft {
        switch (command.type) {
            case "patch_backup_info":
                return {
                    ...draft,
                    backupInfo: {
                        ...draft.backupInfo,
                        ...command.set,
                    },
                };
            case "set_task_execution_mode":
                return {
                    ...draft,
                    taskExecutionMode: command.taskExecutionMode,
                };
        }
    }

    public validate(
        draft: BackupOperationDraft,
        _context: OperationContext,
    ): OperationValidationIssue[] {
        const issues: OperationValidationIssue[] = [];
        if (!draft.ownerUri) {
            issues.push({
                property: "ownerUri",
                severity: "error",
                message: "A connection owner URI is required.",
            });
        }
        if (!draft.backupInfo.databaseName) {
            issues.push({
                property: "databaseName",
                severity: "error",
                message: "A database name is required.",
            });
        }
        if (draft.backupInfo.backupPathList.length === 0) {
            issues.push({
                property: "backupPathList",
                severity: "warning",
                message: "No backup destination has been selected.",
            });
        }
        return issues;
    }

    public summarize(draft: BackupOperationDraft): OperationSummary {
        return {
            title: `Backup ${draft.backupInfo.databaseName || "database"}`,
            details: {
                databaseName: draft.backupInfo.databaseName,
                destinationCount: draft.backupInfo.backupPathList.length,
                copyOnly: draft.backupInfo.isCopyOnly,
                verify: draft.backupInfo.verifyBackupRequired,
            },
        };
    }

    public redact(draft: BackupOperationDraft): unknown {
        return {
            ...draft,
            ownerUri: draft.ownerUri ? "<redacted>" : "",
            backupInfo: {
                ...draft.backupInfo,
                backupPathList: draft.backupInfo.backupPathList.map(() => "<redacted-path>"),
                backupPathDevices: Object.fromEntries(
                    Object.values(draft.backupInfo.backupPathDevices).map((deviceType, index) => [
                        `<redacted-path-${index + 1}>`,
                        deviceType,
                    ]),
                ),
            },
        };
    }

    public async execute(
        draft: BackupOperationDraft,
        context: OperationExecutionContext,
    ): Promise<BackupResponse> {
        if (!context.confirmed) {
            throw new Error("Backup execution requires confirmation.");
        }
        return this.executor.backup(draft);
    }
}
