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
import { Checkmark20Regular, Warning20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../../common/locConstants";

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
    apiUrlContainer: {
        padding: "12px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: "4px",
        width: "100%",
        textAlign: "center",
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

export const DabDeploymentComplete = ({
    apiUrl,
    error,
    onRetry,
    onFinish,
}: DabDeploymentCompleteProps) => {
    const classes = useStyles();
    const isSuccess = !error && apiUrl;

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
                            <Text>{locConstants.schemaDesigner.apiAvailableAt}</Text>
                            <div className={classes.apiUrlContainer}>
                                <Text weight="semibold">{apiUrl}</Text>
                            </div>
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
