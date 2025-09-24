/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FormItemSpec, FormState, FormReducers, FormEvent } from "./form";
import { RequestType } from "vscode-jsonrpc/browser";

/**
 * Data fields shown in the Publish form.
 */
export interface IPublishForm {
    profileName?: string;
    serverName?: string;
    databaseName?: string;
    publishTarget?: "existingServer" | "localContainer";
    sqlCmdVariables?: { [key: string]: string };
}

/**
 * Inner state (domain + form) analogous to ExecutionPlanState in executionPlan.ts
 * Extends generic FormState so form system works unchanged.
 */
export interface PublishDialogState
    extends FormState<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {
    projectFilePath: string;
    inProgress: boolean;
    lastPublishResult?: { success: boolean; details?: string };
}

/**
 * Form item specification for Publish dialog fields.
 */
export interface PublishDialogFormItemSpec
    extends FormItemSpec<IPublishForm, PublishDialogState, PublishDialogFormItemSpec> {
    // (Removed advanced option metadata: was isAdvancedOption/optionCategory/optionCategoryLabel)
    // Reintroduce when the Publish dialog gains an "Advanced" section with grouped fields.
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
    /** Bulk set form values (e.g., after loading a profile) */
    setPublishValues(values: {
        profileName?: string;
        serverName?: string;
        databaseName?: string;
        publishTarget?: "existingServer" | "localContainer";
        sqlCmdVariables?: { [key: string]: string };
        projectFilePath?: string;
    }): void;
}

/**
 * Example request pattern retained for future preview scenarios.
 */
export namespace GetPublishPreviewRequest {
    export const type = new RequestType<void, string, void>("getPublishPreview");
}
