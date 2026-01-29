/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React from "react";
import { makeStyles } from "@fluentui/react-components";
import { VscodeWebviewProvider2, useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import {
    ProfilerDetailsPanelState,
    ProfilerDetailsPanelReducers,
} from "../../../sharedInterfaces/profiler";
import { ProfilerDetailsPanel } from "./profilerDetailsPanel";
import {
    ProfilerDetailsPanelStateProvider,
    useProfilerDetailsPanelContext,
} from "./profilerDetailsPanelStateProvider";
import { useProfilerDetailsPanelSelector } from "./profilerDetailsPanelSelector";

/**
 * Main entry point for the Profiler Details Panel page.
 * This is rendered in a VS Code Panel view (bottom area).
 */
export const ProfilerDetailsPanelPage: React.FC = () => {
    return (
        <VscodeWebviewProvider2<ProfilerDetailsPanelState, ProfilerDetailsPanelReducers>>
            <ProfilerDetailsPanelStateProvider>
                <ProfilerDetailsPanelContent />
            </ProfilerDetailsPanelStateProvider>
        </VscodeWebviewProvider2>
    );
};

/**
 * Content component that uses the selector pattern for state and context for actions
 */
const ProfilerDetailsPanelContent: React.FC = () => {
    const classes = useStyles();
    const { themeKind } = useVscodeWebview2<
        ProfilerDetailsPanelState,
        ProfilerDetailsPanelReducers
    >();

    // Use selector for efficient state access
    const selectedEvent = useProfilerDetailsPanelSelector((state) => state.selectedEvent);

    // Use context for RPC actions
    const { openInEditor, copyToClipboard } = useProfilerDetailsPanelContext();

    // Handle Open in Editor
    const handleOpenInEditor = React.useCallback(
        (textData: string, eventName?: string) => {
            openInEditor(textData, eventName);
        },
        [openInEditor],
    );

    // Handle Copy
    const handleCopy = React.useCallback(
        (text: string) => {
            copyToClipboard(text);
        },
        [copyToClipboard],
    );

    // No close/maximize for a panel view - it's managed by VS Code
    const handleToggleMaximize = React.useCallback(() => {
        // Panel views don't support maximize within the panel - VS Code manages this
    }, []);

    const handleClose = React.useCallback(() => {
        // Panel views are closed by VS Code UI, not by the content
    }, []);

    return (
        <div className={classes.panelPage}>
            <ProfilerDetailsPanel
                selectedEvent={selectedEvent}
                themeKind={themeKind}
                isMaximized={false}
                onOpenInEditor={handleOpenInEditor}
                onCopy={handleCopy}
                onToggleMaximize={handleToggleMaximize}
                onClose={handleClose}
                isPanelView={true}
            />
        </div>
    );
};

// #region Styles

const useStyles = makeStyles({
    panelPage: {
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflowX: "hidden",
        overflowY: "hidden",
        backgroundColor: "var(--vscode-editor-background)",
        // Child panels fill available space
        "> div": {
            flex: "1",
            minHeight: 0,
        },
        // Remove border-top for panel view since it's already bordered by VS Code
        ".profiler-details-panel-container": {
            borderTop: "none",
        },
        // Monaco editor container in panel view
        ".monaco-editor": {
            height: "100% !important",
        },
        // Properties list scrolling in panel view
        ".profiler-properties-container": {
            overflowX: "auto",
            overflowY: "auto",
            maxHeight: "100%",
        },
    },
});

// #endregion

export default ProfilerDetailsPanelPage;
