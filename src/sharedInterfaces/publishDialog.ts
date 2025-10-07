/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as constants from "../constants/constants";
import { FormItemSpec, FormState, FormReducers, FormEvent } from "./form";

/**
 * Data fields shown in the Publish form.
 */
export interface IPublishForm {
    publishProfilePath?: string;
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
    savePublishProfile: { profileName: string };
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
    /** Generate (but do not execute) a publish script */
    generatePublishScript(): void;
    /** Choose a publish profile file and apply (may partially override form state) */
    selectPublishProfile(): void;
    /** Persist current form state as a named profile */
    savePublishProfile(profileName: string): void;
}
