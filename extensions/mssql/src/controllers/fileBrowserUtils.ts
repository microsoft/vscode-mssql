/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { allFileTypes } from "../constants/constants";
import { FileBrowserService } from "../services/fileBrowserService";
import { FileBrowserReducers, FileBrowserWebviewState } from "../sharedInterfaces/fileBrowser";
import { ReactWebviewPanelController } from "./reactWebviewPanelController";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";

export function registerFileBrowserReducers<TResult>(
    controller: ReactWebviewPanelController<FileBrowserWebviewState, FileBrowserReducers, TResult>,
    fileBrowserService: FileBrowserService,
    fileBrowserFilters?: string[],
): void {
    controller.registerReducer("openFileBrowser", async (state, payload) => {
        const result = await fileBrowserService.openFileBrowser(
            payload.ownerUri,
            payload.expandPath,
            payload.fileFilters,
            payload.changeFilter,
            payload.showFoldersOnly,
        );
        if (result && result.succeeded) {
            state.fileBrowserState = fileBrowserService.fileBrowserState;
            sendActionEvent(TelemetryViews.FileBrowser, TelemetryActions.FileBrowserOpen);
        } else {
            sendErrorEvent(
                TelemetryViews.FileBrowser,
                TelemetryActions.FileBrowserOpen,
                new Error(result ? result.message : "Unknown error"),
                false, // includeErrorMessage
            );
        }
        return state;
    });
    controller.registerReducer("expandNode", async (state, payload) => {
        const result = await fileBrowserService.expandFilePath(payload.ownerUri, payload.nodePath);
        if (result && result.succeeded) {
            state.fileBrowserState = fileBrowserService.fileBrowserState;
            sendActionEvent(TelemetryViews.FileBrowser, TelemetryActions.FileBrowserExpand);
        } else {
            sendErrorEvent(
                TelemetryViews.FileBrowser,
                TelemetryActions.FileBrowserExpand,
                new Error(result ? result.message : "Unknown error"),
                false, // includeErrorMessage
            );
        }
        return state;
    });
    controller.registerReducer("submitFilePath", async (state, payload) => {
        state.fileBrowserState.selectedPath = payload.selectedPath;
        sendActionEvent(TelemetryViews.FileBrowser, TelemetryActions.FileBrowserSubmitFilePath);
        return state;
    });
    controller.registerReducer("closeFileBrowser", async (state, payload) => {
        const result = await fileBrowserService.closeFileBrowser(payload.ownerUri);
        if (result && result.succeeded) {
            state.fileBrowserState = fileBrowserService.fileBrowserState;
            sendActionEvent(TelemetryViews.FileBrowser, TelemetryActions.FileBrowserClose);
        } else {
            sendErrorEvent(
                TelemetryViews.FileBrowser,
                TelemetryActions.FileBrowserClose,
                new Error(result ? result.message : "Unknown error"),
                false, // includeErrorMessage
            );
        }
        return state;
    });
    controller.registerReducer("toggleFileBrowserDialog", async (state, payload) => {
        if (payload.shouldOpen) {
            if (!state.fileBrowserState) {
                // Initialize file browser state if not already done
                const result = await fileBrowserService.openFileBrowser(
                    state.ownerUri,
                    state.defaultFileBrowserExpandPath,
                    fileBrowserFilters || allFileTypes,
                    false, // changeFilter
                    payload.foldersOnly,
                );
                if (result && result.succeeded) {
                    sendActionEvent(
                        TelemetryViews.FileBrowser,
                        TelemetryActions.FileBrowserDialog,
                        { isOpen: "true" },
                    );
                } else {
                    sendErrorEvent(
                        TelemetryViews.FileBrowser,
                        TelemetryActions.FileBrowserDialog,
                        new Error(result ? result.message : "Unknown error"),
                        false, // includeErrorMessage
                        undefined,
                        undefined,
                        { isOpen: "true" },
                    );
                }
            }
            state.fileBrowserState = fileBrowserService.fileBrowserState;
            state.fileBrowserState.showFoldersOnly = payload.foldersOnly;

            // Open the file browser dialog with the current file browser state
            state.dialog = {
                type: "fileBrowser",
            };
        } else {
            // Close the file browser dialog
            state.dialog = undefined;
            sendActionEvent(TelemetryViews.FileBrowser, TelemetryActions.FileBrowserDialog, {
                isOpen: "false",
            });
        }
        return state;
    });
}
