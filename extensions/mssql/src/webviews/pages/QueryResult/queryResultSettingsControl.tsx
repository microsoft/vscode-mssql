/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Switch,
    makeStyles,
} from "@fluentui/react-components";
import { Dismiss20Regular, Settings20Regular } from "@fluentui/react-icons";
import { useContext, useEffect, useState } from "react";
import * as qr from "../../../sharedInterfaces/queryResult";
import { ExecuteCommandRequest } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";
import { QueryResultCommandsContext } from "./queryResultStateProvider";

const useStyles = makeStyles({
    ribbonIconButton: {
        width: "28px",
        height: "28px",
        minWidth: "28px",
        padding: 0,
    },
    settingsPopoverSurface: {
        padding: 0,
        minWidth: "300px",
        maxWidth: "400px",
        borderRadius: "8px",
        border: "1px solid var(--vscode-widget-border)",
        backgroundColor: "var(--vscode-editorWidget-background)",
        color: "var(--vscode-foreground)",
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.35)",
    },
    settingsPopoverHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        borderBottom: "1px solid var(--vscode-widget-border)",
    },
    settingsPopoverTitleGroup: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "14px",
        fontWeight: 600,
    },
    settingsPopoverOption: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        padding: "10px",
    },
    settingsPopoverOptionText: {
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
    },
    settingsPopoverOptionTitle: {
        fontSize: "13px",
        lineHeight: "18px",
        color: "var(--vscode-foreground)",
    },
    settingsPopoverOptionDescription: {
        fontSize: "12px",
        lineHeight: "16px",
        color: "var(--vscode-descriptionForeground)",
    },
});

export interface QueryResultSettingsControlProps {
    uri?: string;
    webviewLocation: qr.QueryResultWebviewLocation;
}

export const QueryResultSettingsControl = ({
    uri,
    webviewLocation,
}: QueryResultSettingsControlProps) => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
    const [openResultsInEditorTabByDefault, setOpenResultsInEditorTabByDefault] =
        useState<boolean>(false);

    useEffect(() => {
        if (!context) {
            return;
        }

        context.extensionRpc
            .sendRequest(qr.GetOpenQueryResultsInTabByDefaultRequest.type)
            .then((isEnabled) => {
                setOpenResultsInEditorTabByDefault(isEnabled);
            })
            .catch((e) => {
                console.error(e);
            });
    }, [context]);

    if (!context) {
        return <></>;
    }

    const setDefaultResultLocation = async (enabled: boolean): Promise<void> => {
        const previousValue = openResultsInEditorTabByDefault;
        setOpenResultsInEditorTabByDefault(enabled);

        try {
            await context.extensionRpc.sendRequest(
                qr.SetOpenQueryResultsInTabByDefaultRequest.type,
                {
                    enabled,
                },
            );

            if (
                enabled &&
                webviewLocation === qr.QueryResultWebviewLocation.Panel &&
                Boolean(uri)
            ) {
                await context.extensionRpc.sendRequest(qr.OpenInNewTabRequest.type, {
                    uri: uri!,
                });
                await context.extensionRpc.sendRequest(ExecuteCommandRequest.type, {
                    command: "workbench.action.closePanel",
                });
            }
        } catch (e) {
            console.error(e);
            setOpenResultsInEditorTabByDefault(previousValue);
        }
    };

    return (
        <Popover
            open={isSettingsOpen}
            withArrow
            positioning="below-end"
            onOpenChange={(_event, data) => {
                setIsSettingsOpen(data.open);
            }}>
            <PopoverTrigger disableButtonEnhancement>
                <Button
                    appearance="subtle"
                    icon={<Settings20Regular />}
                    className={classes.ribbonIconButton}
                    aria-label={locConstants.queryResult.resultsSettings}
                    title={locConstants.queryResult.resultsSettings}
                />
            </PopoverTrigger>
            <PopoverSurface className={classes.settingsPopoverSurface}>
                <div className={classes.settingsPopoverHeader}>
                    <div className={classes.settingsPopoverTitleGroup}>
                        <Settings20Regular />
                        <span>{locConstants.queryResult.resultsSettings}</span>
                    </div>
                    <Button
                        appearance="subtle"
                        icon={<Dismiss20Regular />}
                        className={classes.ribbonIconButton}
                        aria-label={locConstants.queryResult.closeResultsSettings}
                        title={locConstants.queryResult.closeResultsSettings}
                        onClick={() => {
                            setIsSettingsOpen(false);
                        }}
                    />
                </div>
                <div className={classes.settingsPopoverOption}>
                    <div className={classes.settingsPopoverOptionText}>
                        <span className={classes.settingsPopoverOptionTitle}>
                            {locConstants.queryResult.showResultsInEditorTab}
                        </span>
                        <span className={classes.settingsPopoverOptionDescription}>
                            {locConstants.queryResult.showResultsInEditorTabDescription}
                        </span>
                    </div>
                    <Switch
                        checked={openResultsInEditorTabByDefault}
                        onChange={(_event, data) => {
                            void setDefaultResultLocation(data.checked);
                        }}
                    />
                </div>
            </PopoverSurface>
        </Popover>
    );
};
