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
import { Info20Regular } from "@fluentui/react-icons";
import { locConstants } from "../../../../common/locConstants";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "16px",
    },
    confirmationInfo: {
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "12px",
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: "4px",
    },
    infoIcon: {
        color: tokens.colorBrandForeground1,
        flexShrink: 0,
        marginTop: "2px",
    },
});

interface DabDeploymentConfirmationProps {
    onConfirm: () => void;
    onCancel: () => void;
}

export const DabDeploymentConfirmation = ({
    onConfirm,
    onCancel,
}: DabDeploymentConfirmationProps) => {
    const classes = useStyles();

    return (
        <>
            <DialogTitle>Deploy DAB Container</DialogTitle>
            <DialogContent className={classes.content}>
                <div className={classes.confirmationInfo}>
                    <Info20Regular className={classes.infoIcon} />
                    <div>
                        <Text weight="semibold">Local Container Deployment</Text>
                        <Text block style={{ marginTop: "8px" }}>
                            This will deploy a Data API Builder container locally using Docker. The
                            container will expose REST and GraphQL APIs based on your configuration.
                        </Text>
                        <Text block style={{ marginTop: "8px" }}>
                            <strong>Requirements:</strong> Docker Desktop must be installed and
                            running on your machine.
                        </Text>
                    </div>
                </div>
            </DialogContent>
            <DialogActions>
                <Button appearance="secondary" onClick={onCancel}>
                    {locConstants.common.cancel}
                </Button>
                <Button appearance="primary" onClick={onConfirm}>
                    {locConstants.common.next}
                </Button>
            </DialogActions>
        </>
    );
};
