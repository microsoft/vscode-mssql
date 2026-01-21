/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import * as mssql from "vscode-mssql";
import { FormItemSpec, FormState, FormReducers, FormEvent } from "./form";
import { DialogMessageSpec } from "./dialogMessage";
import { RequestType } from "vscode-jsonrpc";
import { IConnectionDialogProfile } from "./connectionDialog";

// Publish target options - defines where the database project will be published
export enum PublishTarget {
    ExistingServer = "existingServer",
    LocalContainer = "localContainer",
    NewAzureServer = "newAzureServer",
}

// Masking mode for SqlPackage command generation
export enum MaskMode {
    Masked = "Masked",
    Unmasked = "Unmasked",
}

/**
 * Field names for the Publish form - defines the keys used in IPublishForm interface
 */
export const PublishFormFields = {
    PublishProfilePath: "publishProfilePath",
    ServerName: "serverName",
    DatabaseName: "databaseName",
    PublishTarget: "publishTarget",
    SqlCmdVariables: "sqlCmdVariables",
    ContainerPort: "containerPort",
    ContainerAdminPassword: "containerAdminPassword",
    ContainerAdminPasswordConfirm: "containerAdminPasswordConfirm",
    ContainerImageTag: "containerImageTag",
    AcceptContainerLicense: "acceptContainerLicense",
} as const;

/**
 * Container-specific fields that are shown/hidden based on publish target
 */
export const PublishFormContainerFields = [
    PublishFormFields.ContainerPort,
    PublishFormFields.ContainerAdminPassword,
    PublishFormFields.ContainerAdminPasswordConfirm,
    PublishFormFields.ContainerImageTag,
    PublishFormFields.AcceptContainerLicense,
] as const;

// Re-export other publish-related constants for use in webview code
export const DefaultSqlPortNumber = constants.DefaultSqlPortNumber;

/**
 * Extended project properties that includes additional metadata beyond what GetProjectPropertiesResult provides.
 * This type is used internally for publish and build operations.
 */
export type ProjectPropertiesResult = mssql.GetProjectPropertiesResult & {
    /** Extracted target version from DatabaseSchemaProvider (e.g. "150", "AzureV12") */
    targetVersion?: string;
    /** Absolute path to the .sqlproj file */
    projectFilePath: string;
    /** Calculated absolute path to the output .dacpac file */
    dacpacOutputPath: string;
};

/**
 * Data fields shown in the Publish form.
 */
export interface IPublishForm {
    publishProfilePath?: string;
    serverName?: string;
    databaseName?: string;
    publishTarget?: PublishTarget;
    sqlCmdVariables?: { [key: string]: string };
    containerPort?: string;
    containerAdminPassword?: string;
    containerAdminPasswordConfirm?: string;
    containerImageTag?: string;
    acceptContainerLicense?: boolean;
}

/**
 * Extends generic FormState so form system works unchanged.
 */
export interface PublishDialogState
    extends FormState<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {
    projectFilePath: string;
    inProgress: boolean;
    lastPublishResult?: { success: boolean; details?: string };
    projectProperties?: ProjectPropertiesResult;
    hasFormErrors?: boolean;
    deploymentOptions?: mssql.DeploymentOptions;
    waitingForNewConnection?: boolean;
    formMessage?: DialogMessageSpec;
    defaultDeploymentOptions?: mssql.DeploymentOptions;
    defaultSqlCmdVariables?: { [key: string]: string };
    availableConnections?: { connectionUri: string; profile: IConnectionDialogProfile }[];
    selectedConnectionUri?: string;
    isLoadingDatabases?: boolean;
}

/**
 * Form item specification for Publish dialog fields.
 */
export interface PublishDialogFormItemSpec
    extends FormItemSpec<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {}

/**
 * Reducers (messages) the controller supports in addition to the generic form actions.
 */
export interface PublishDialogReducers extends FormReducers<IPublishForm> {
    publishNow: {
        projectFilePath?: string;
        databaseName?: string;
        connectionUri?: string;
        sqlCmdVariables?: { [key: string]: string };
        publishProfilePath?: string;
    };
    generatePublishScript: {};
    selectPublishProfile: {};
    savePublishProfile: { publishProfileName: string };
    openConnectionDialog: {};
    closeMessage: {};
    updateDeploymentOptions: { deploymentOptions: mssql.DeploymentOptions };
    updateSqlCmdVariables: { variables: { [key: string]: string } };
    revertSqlCmdVariables: {};
    connectToServer: { connectionUri: string };
}

/**
 * Public operations + form dispatch surface for the Publish Project webview.
 * React context a stable, typed contract while keeping implementation details (raw RPC naming, snapshot plumbing) encapsulated.
 */
export interface PublishProjectProvider {
    formAction(event: FormEvent<IPublishForm>): void;
    publishNow(payload?: {
        projectFilePath?: string;
        databaseName?: string;
        connectionUri?: string;
        sqlCmdVariables?: { [key: string]: string };
        publishProfilePath?: string;
    }): void;
    generatePublishScript(): void;
    selectPublishProfile(): void;
    savePublishProfile(publishProfileName: string): void;
    openConnectionDialog(): void;
    closeMessage(): void;
    updateDeploymentOptions(deploymentOptions: mssql.DeploymentOptions): void;
    updateSqlCmdVariables(variables: { [key: string]: string }): void;
    revertSqlCmdVariables(): void;
    generateSqlPackageCommand(maskMode?: MaskMode): Promise<mssql.SqlPackageCommandResult>;
    connectToServer(connectionUri: string): void;
}

/**
 * Request to generate a sqlpackage command string from the backend.
 */
export namespace GenerateSqlPackageCommandRequest {
    export const type = new RequestType<
        { maskMode?: MaskMode },
        mssql.SqlPackageCommandResult,
        void
    >("generateSqlPackageCommand");
}
