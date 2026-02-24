/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    makeStyles,
    Text,
    tokens,
} from "@fluentui/react-components";
import {
    Add16Regular,
    Checkmark16Regular,
    Checkmark20Regular,
    Copy16Regular,
    Warning20Regular,
} from "@fluentui/react-icons";
import { useCallback, useMemo, useState } from "react";
import { locConstants } from "../../../../common/locConstants";
import { Dab } from "../../../../../sharedInterfaces/dab";
import { useDabContext } from "../dabContext";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    completionContainer: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
        padding: "24px",
    },
    successIcon: {
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        backgroundColor: tokens.colorStatusSuccessBackground3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    errorIcon: {
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        backgroundColor: tokens.colorStatusDangerBackground3,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
    apiUrlList: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "100%",
    },
    apiUrlRow: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 12px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: "4px",
    },
    apiLabel: {
        fontWeight: 600,
        minWidth: "80px",
    },
    apiUrl: {
        flex: 1,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    actionButton: {
        minWidth: "auto",
        flexShrink: 0,
    },
    errorText: {
        color: tokens.colorStatusDangerForeground1,
    },
});

interface DabDeploymentCompleteProps {
    apiUrl?: string;
    error?: string;
    onRetry: () => void;
    onFinish: () => void;
}

interface ApiEndpoint {
    type: Dab.ApiType;
    label: string;
    url: string;
    action: "copy" | "addToVSCode";
}

export const DabDeploymentComplete = ({
    apiUrl,
    error,
    onRetry,
    onFinish,
}: DabDeploymentCompleteProps) => {
    const classes = useStyles();
    const { dabConfig, copyToClipboard, addDabMcpServer } = useDabContext();
    const isSuccess = !error && apiUrl;
    const [mcpAdded, setMcpAdded] = useState(false);
    const [mcpError, setMcpError] = useState<string | null>(null);

    const endpoints = useMemo<ApiEndpoint[]>(() => {
        if (!apiUrl || !dabConfig) {
            return [];
        }
        const enabledTypes = dabConfig.apiTypes;
        const result: ApiEndpoint[] = [];
        if (enabledTypes.includes(Dab.ApiType.Rest)) {
            result.push({
                type: Dab.ApiType.Rest,
                label: locConstants.schemaDesigner.restApi,
                url: `${apiUrl}/api`,
                action: "copy",
            });
        }
        if (enabledTypes.includes(Dab.ApiType.GraphQL)) {
            result.push({
                type: Dab.ApiType.GraphQL,
                label: locConstants.schemaDesigner.graphql,
                url: `${apiUrl}/graphql`,
                action: "copy",
            });
        }
        if (enabledTypes.includes(Dab.ApiType.Mcp)) {
            result.push({
                type: Dab.ApiType.Mcp,
                label: locConstants.schemaDesigner.mcp,
                url: `${apiUrl}/mcp`,
                action: "addToVSCode",
            });
        }
        return result;
    }, [apiUrl, dabConfig]);

    const handleAddMcpServer = useCallback(
        async (serverUrl: string) => {
            setMcpError(null);
            const result = await addDabMcpServer(serverUrl);
            if (result.success) {
                setMcpAdded(true);
            } else if (result.error) {
                setMcpError(result.error);
            }
        },
        [addDabMcpServer],
    );

    const renderEndpointAction = useCallback(
        (ep: ApiEndpoint) => {
            if (ep.action === "copy") {
                return (
                    <Button
                        appearance="subtle"
                        icon={<Copy16Regular />}
                        size="small"
                        className={classes.actionButton}
                        onClick={() => copyToClipboard(ep.url)}
                        aria-label={locConstants.schemaDesigner.copyUrl(ep.label)}
                        title={locConstants.schemaDesigner.copyUrl(ep.label)}
                    />
                );
            }
            if (ep.action === "addToVSCode") {
                return (
                    <Button
                        appearance="subtle"
                        icon={mcpAdded ? <Checkmark16Regular /> : <Add16Regular />}
                        size="small"
                        className={classes.actionButton}
                        disabled={mcpAdded}
                        onClick={() => void handleAddMcpServer(ep.url)}
                        aria-label={locConstants.schemaDesigner.addMcpServerToWorkspace}
                        title={locConstants.schemaDesigner.addMcpServerToWorkspace}>
                        {mcpAdded
                            ? locConstants.schemaDesigner.mcpServerAdded
                            : locConstants.schemaDesigner.addToVSCode}
                    </Button>
                );
            }
            return null;
        },
        [classes.actionButton, copyToClipboard, mcpAdded, handleAddMcpServer],
    );

    return (
        <>
            <DialogTitle>
                {isSuccess
                    ? locConstants.schemaDesigner.deploymentComplete
                    : locConstants.schemaDesigner.deploymentFailed}
            </DialogTitle>
            <DialogContent className={classes.content}>
                <div className={classes.completionContainer}>
                    {isSuccess ? (
                        <>
                            <div className={classes.successIcon}>
                                <Checkmark20Regular
                                    style={{ color: "white", width: "24px", height: "24px" }}
                                />
                            </div>
                            <Text weight="semibold" size={400}>
                                {locConstants.schemaDesigner.dabContainerRunning}
                            </Text>
                            <Text>{locConstants.schemaDesigner.apisAvailableAt}</Text>
                            <div className={classes.apiUrlList}>
                                {endpoints.map((ep) => (
                                    <div key={ep.type} className={classes.apiUrlRow}>
                                        <Text className={classes.apiLabel}>{ep.label}</Text>
                                        <Text className={classes.apiUrl}>{ep.url}</Text>
                                        {renderEndpointAction(ep)}
                                    </div>
                                ))}
                            </div>
                            {mcpError && <Text className={classes.errorText}>{mcpError}</Text>}
                        </>
                    ) : (
                        <>
                            <div className={classes.errorIcon}>
                                <Warning20Regular
                                    style={{ color: "white", width: "24px", height: "24px" }}
                                />
                            </div>
                            <Text weight="semibold" size={400} className={classes.errorText}>
                                {locConstants.schemaDesigner.deploymentFailed}
                            </Text>
                            <Text>{error}</Text>
                        </>
                    )}
                </div>
            </DialogContent>
            <DialogActions>
                {!isSuccess && (
                    <Button appearance="secondary" onClick={onRetry}>
                        {locConstants.common.retry}
                    </Button>
                )}
                <Button appearance="primary" onClick={onFinish}>
                    {locConstants.common.finish}
                </Button>
            </DialogActions>
        </>
    );
};
