/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormItemSpec, FormState, FormReducers } from "./form";

/**
 * Data fields shown in the Publish form.
 */
export interface IPublishForm {
    profileName?: string;
    serverName?: string;
    databaseName?: string;
    publishTarget?: "existingServer" | "localContainer";
    sqlCmdVariables?: { [key: string]: string };

    // Local container specific fields
    containerPort?: string; // store as string for easy binding, validate numeric
    containerAdminPassword?: string;
    containerAdminPasswordConfirm?: string;
    containerImageTag?: string; // selected image tar path or name
    acceptContainerLicense?: boolean;
}

/*
 * State maintained in the Publish dialog webview.
 * Extends the generic form state with additional fields specific to publishing.
 */
export interface PublishDialogWebviewState
    extends FormState<IPublishForm, PublishDialogWebviewState, PublishDialogFormItemSpec> {
    projectFilePath: string;
    inProgress: boolean;
    lastPublishResult?: { success: boolean; details?: string };
    projectProperties?: ProjectProperties; // cached full project properties (including targetVersion)
}

/**
 * Form item specification for Publish dialog fields.
 */
export interface PublishDialogFormItemSpec
    extends FormItemSpec<IPublishForm, PublishDialogWebviewState, PublishDialogFormItemSpec> {
    isAdvancedOption?: boolean;
    optionCategory?: string;
    optionCategoryLabel?: string;
}

/*
 * Partial project properties we use from the service
 */
export interface ProjectProperties {
    targetVersion?: string;
    projectGuid?: string;
    configuration?: string;
    outputPath?: string;
    databaseSource?: string;
    defaultCollation?: string;
    databaseSchemaProvider?: string;
    projectStyle?: unknown;
}

/**
 * Reducers (messages) the controller supports in addition to the generic form actions.
 */
export interface PublishDialogReducers extends FormReducers<IPublishForm> {
    setPublishValues: {
        profileName?: string;
        serverName?: string;
        databaseName?: string;
        publishTarget?: "existingServer" | "localContainer";
        sqlCmdVariables?: { [key: string]: string };
        projectFilePath?: string;
        containerPort?: string;
        containerAdminPassword?: string;
        containerAdminPasswordConfirm?: string;
        containerImageTag?: string;
        acceptContainerLicense?: boolean;
    };

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
    savePublishProfile: { profileName: string };
    fetchDockerTags: { tagsUrl: string };
}
