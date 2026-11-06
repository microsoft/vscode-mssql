/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Link, makeStyles, mergeClasses, Text, tokens } from "@fluentui/react-components";
import {
    Add16Regular,
    Checkmark16Regular,
    Copy16Regular,
    Open16Regular,
} from "@fluentui/react-icons";
import { useCallback, useMemo, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { useDabContext } from "../dabContext";
import { DabEndpoint, DabEndpointAction, getDabEndpoints } from "./dabEndpoints";

const useStyles = makeStyles({
    wrapper: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
    },
    table: {
        display: "flex",
        flexDirection: "column",
        borderRadius: tokens.borderRadiusXLarge,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground2,
        overflow: "hidden",
    },
    row: {
        display: "grid",
        gridTemplateColumns: "120px minmax(0, 1fr) auto",
        alignItems: "center",
        columnGap: "16px",
        padding: "10px 12px 10px 16px",
        ":not(:last-child)": {
            borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        },
    },
    label: {
        fontWeight: tokens.fontWeightSemibold,
    },
    url: {
        fontFamily: "var(--vscode-editor-font-family)",
        fontSize: tokens.fontSizeBase300,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        justifySelf: "start",
        maxWidth: "100%",
    },
    // Holds the link, which keeps its own role inside the cell.
    urlCell: {
        display: "flex",
        minWidth: 0,
    },
    urlDisabled: {
        color: tokens.colorNeutralForeground3,
    },
    actions: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
    },
    actionButton: {
        minWidth: "auto",
        flexShrink: 0,
    },
    note: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorNeutralForeground3,
    },
    errorText: {
        fontSize: tokens.fontSizeBase200,
        color: tokens.colorStatusDangerForeground1,
    },
});

interface DabDeploymentEndpointsProps {
    apiUrl?: string;
    apiTypes?: Dab.ApiType[];
    /**
     * True when the container is not running, so the URLs are shown for
     * reference but nothing can be opened or registered from them.
     */
    isDisabled?: boolean;
}

/**
 * The REST, GraphQL, and MCP endpoints a deployed container exposes, with the
 * actions each one supports.
 */
export const DabDeploymentEndpoints = ({
    apiUrl,
    apiTypes,
    isDisabled = false,
}: DabDeploymentEndpointsProps) => {
    const classes = useStyles();
    const { copyToClipboard, openUrl, addDabMcpServer } = useDabContext();
    const [mcpAdded, setMcpAdded] = useState(false);
    const [mcpError, setMcpError] = useState<string | undefined>();

    const endpoints = useMemo(() => getDabEndpoints(apiUrl, apiTypes), [apiUrl, apiTypes]);

    const handleAddMcpServer = useCallback(
        async (serverUrl: string) => {
            setMcpError(undefined);
            const result = await addDabMcpServer(serverUrl);
            if (result.success) {
                setMcpAdded(true);
            } else {
                setMcpError(result.error);
            }
        },
        [addDabMcpServer],
    );

    const renderAction = useCallback(
        (endpoint: DabEndpoint, action: DabEndpointAction) => {
            switch (action) {
                case "copy":
                    // Every row ends with a copy button, added below.
                    return null;
                case "openUrl":
                    if (!endpoint.openUrlConfig) {
                        return null;
                    }
                    return (
                        <Button
                            key={action}
                            appearance="subtle"
                            icon={<Open16Regular />}
                            size="small"
                            className={classes.actionButton}
                            disabled={isDisabled}
                            onClick={() => openUrl(endpoint.openUrlConfig!.url, endpoint.type)}
                            aria-label={endpoint.openUrlConfig.label}
                            title={endpoint.openUrlConfig.label}>
                            {endpoint.openUrlConfig.label}
                        </Button>
                    );
                case "addToVSCode":
                    return (
                        <Button
                            key={action}
                            appearance="subtle"
                            icon={mcpAdded ? <Checkmark16Regular /> : <Add16Regular />}
                            size="small"
                            className={classes.actionButton}
                            disabled={mcpAdded || isDisabled}
                            onClick={() => void handleAddMcpServer(endpoint.url)}
                            aria-label={locConstants.schemaDesigner.addMcpServerToWorkspace}
                            title={locConstants.schemaDesigner.addMcpServerToWorkspace}>
                            {mcpAdded
                                ? locConstants.schemaDesigner.mcpServerAdded
                                : locConstants.schemaDesigner.addToVSCode}
                        </Button>
                    );
            }
        },
        [classes.actionButton, copyToClipboard, openUrl, mcpAdded, isDisabled, handleAddMcpServer],
    );

    if (endpoints.length === 0) {
        return null;
    }

    return (
        <div className={classes.wrapper}>
            {isDisabled && (
                <Text className={classes.note}>
                    {locConstants.schemaDesigner.endpointsUnavailableWhenStopped}
                </Text>
            )}
            <div className={classes.table} role="table">
                {endpoints.map((endpoint) => (
                    <div key={endpoint.type} className={classes.row} role="row">
                        <Text className={classes.label} role="cell">
                            {endpoint.label}
                        </Text>
                        {isDisabled ? (
                            <Text
                                className={mergeClasses(classes.url, classes.urlDisabled)}
                                role="cell">
                                {endpoint.url}
                            </Text>
                        ) : (
                            <div className={classes.urlCell} role="cell">
                                <Link
                                    className={classes.url}
                                    onClick={() => openUrl(endpoint.url, endpoint.type)}>
                                    {endpoint.url}
                                </Link>
                            </div>
                        )}
                        <div className={classes.actions} role="cell">
                            {endpoint.actions.map((action) => renderAction(endpoint, action))}
                            <Button
                                appearance="subtle"
                                icon={<Copy16Regular />}
                                size="small"
                                className={classes.actionButton}
                                onClick={() => copyToClipboard(endpoint.url, Dab.CopyTextType.Url)}
                                aria-label={locConstants.schemaDesigner.copyUrl(endpoint.label)}
                                title={locConstants.schemaDesigner.copyUrl(endpoint.label)}
                            />
                        </div>
                    </div>
                ))}
            </div>
            {mcpError && <Text className={classes.errorText}>{mcpError}</Text>}
        </div>
    );
};
