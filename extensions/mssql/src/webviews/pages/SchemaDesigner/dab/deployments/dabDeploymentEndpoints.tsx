/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text, tokens } from "@fluentui/react-components";
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
    list: {
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        width: "100%",
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "6px 10px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: "4px",
    },
    label: {
        fontWeight: 600,
        minWidth: "80px",
    },
    url: {
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    actionButton: {
        minWidth: "auto",
        flexShrink: 0,
    },
    note: {
        fontSize: "12px",
        color: tokens.colorNeutralForeground3,
    },
    errorText: {
        fontSize: "12px",
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
                    return (
                        <Button
                            key={action}
                            appearance="subtle"
                            icon={<Copy16Regular />}
                            size="small"
                            className={classes.actionButton}
                            onClick={() => copyToClipboard(endpoint.url, Dab.CopyTextType.Url)}
                            aria-label={locConstants.schemaDesigner.copyUrl(endpoint.label)}
                            title={locConstants.schemaDesigner.copyUrl(endpoint.label)}
                        />
                    );
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
        <div className={classes.list}>
            {isDisabled && (
                <Text className={classes.note}>
                    {locConstants.schemaDesigner.endpointsUnavailableWhenStopped}
                </Text>
            )}
            {endpoints.map((endpoint) => (
                <div key={endpoint.type} className={classes.row}>
                    <Text className={classes.label}>{endpoint.label}</Text>
                    <Text className={classes.url}>{endpoint.url}</Text>
                    {endpoint.actions.map((action) => renderAction(endpoint, action))}
                </div>
            ))}
            {mcpError && <Text className={classes.errorText}>{mcpError}</Text>}
        </div>
    );
};
