/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { FormItemSpec, FormState, FormReducers } from "./form";

/**
 * Data fields shown in the Publish form.
 */
export interface IPublishForm {
    profileName?: string;
    serverName?: string;
    databaseName?: string;
    publishTarget?: constants.PublishTargetType;
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
    // Optional project metadata (target version, etc.) loaded asynchronously
    projectProperties?: {
        targetVersion?: string;
        // Additional properties can be added here as needed
        [key: string]: unknown;
    };
}

/**
 * Form item specification for Publish dialog fields.
 */
export interface PublishDialogFormItemSpec
    extends FormItemSpec<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {
    isAdvancedOption?: boolean;
    optionCategory?: string;
    optionCategoryLabel?: string;
}

/**
 * Reducers (messages) the controller supports in addition to the generic form actions.
 */
export interface PublishDialogReducers extends FormReducers<IPublishForm> {
    setPublishValues: {
        profileName?: string;
        serverName?: string;
        databaseName?: string;
        publishTarget?: constants.PublishTargetType;
        sqlCmdVariables?: { [key: string]: string };
        containerPort?: string;
        containerAdminPassword?: string;
        containerAdminPasswordConfirm?: string;
        containerImageTag?: string;
        acceptContainerLicense?: boolean;
        projectFilePath?: string;
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
}
