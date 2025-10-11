/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import * as mssql from "vscode-mssql";
import { FormItemSpec, FormState, FormReducers, FormEvent } from "./form";

// Publish target options - defines where the database project will be published
export enum PublishTarget {
    ExistingServer = "existingServer",
    LocalContainer = "localContainer",
    NewAzureServer = "newAzureServer",
}

// export publish-related constants for use in webview code
export const PublishFormFields = constants.PublishFormFields;
export const DefaultSqlPortNumber = constants.DefaultSqlPortNumber;

/**
 * Project Properties interface -shared between server-side code and browser-side webviews.
 */
export interface ProjectProperties {
    projectGuid?: string;
    configuration?: string;
    outputPath: string;
    databaseSource?: string;
    defaultCollation: string;
    databaseSchemaProvider: string;
    projectStyle: unknown;
    targetVersion?: string;
    projectName?: string;
    projectFolderPath?: string;
}

/**
 * Data fields shown in the Publish form.
 */
export interface IPublishForm {
    publishProfilePath?: string;
    serverName?: string;
    databaseName?: string;
    publishTarget?: PublishTarget;
    sqlCmdVariables?: { [key: string]: string };
    // Container deployment specific fields (only used when publishTarget === 'localContainer')
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
    deploymentOptions?: mssql.DeploymentOptions;
    projectProperties?: ProjectProperties;
    waitingForNewConnection?: boolean;
    activeServers?: { [connectionUri: string]: { profileName: string; server: string } };
    connectionString?: string;
}

/**
 * Form item specification for Publish dialog fields.
 */
export interface PublishDialogFormItemSpec
    extends FormItemSpec<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {
    // (Removed advanced option metadata: was isAdvancedOption/optionCategory/optionCategoryLabel)
    // Reintroduce when the Publish dialog gains an "Advanced publish options" section with grouped fields.
    // TODO: https://github.com/microsoft/vscode-mssql/issues/20248 task for advanced options
}

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
    openPublishAdvanced: {};
    selectPublishProfile: {};
    savePublishProfile: { publishProfileName: string };
    openConnectionDialog: {};
}

/**
 * Public operations + form dispatch surface for the Publish Project webview.
 * React context a stable, typed contract while keeping implementation details (raw RPC naming, snapshot plumbing) encapsulated.
 */
export interface PublishProjectProvider {
    /** Dispatch a single field value change or field-level action */
    formAction(event: FormEvent<IPublishForm>): void;
    /** Execute an immediate publish using current (or overridden) form values */
    publishNow(payload?: {
        projectFilePath?: string;
        databaseName?: string;
        connectionUri?: string;
        sqlCmdVariables?: { [key: string]: string };
        publishProfilePath?: string;
    }): void;
    /** Generate a publish script */
    generatePublishScript(): void;
    /** Choose a publish profile file and apply */
    selectPublishProfile(): void;
    /** Persist current form state as a named publish profile */
    savePublishProfile(publishProfileName: string): void;
    /** Open connection dialog to select server and database */
    openConnectionDialog(): void;
}
