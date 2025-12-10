/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { ErrorCircleRegular } from "@fluentui/react-icons";
import React from "react";

const useStyles = makeStyles({
    dialogSurface: {
        minWidth: "320px",
        maxWidth: "420px",
    },
    title: {
        display: "flex",
        alignItems: "center",
        columnGap: "8px",
    },
    icon: {
        fontSize: "32px",
    },
    content: {
        ...shorthands.marginBlock("16px", "0"),
    },
});

export interface InitializationErrorDialogProps {
    open: boolean;
    title: string;
    message: string;
    retryLabel: string;
    onRetry: () => void;
}

export const InitializationErrorDialog: React.FC<InitializationErrorDialogProps> = ({
    open,
    title,
    message,
    retryLabel,
    onRetry,
}) => {
    const classes = useStyles();
    return (
        <Dialog open={open} modalType="modal" inertTrapFocus>
            <DialogSurface className={classes.dialogSurface}>
                <DialogBody>
                    <DialogTitle className={classes.title}>
                        <ErrorCircleRegular className={classes.icon} />
                        {title}
                    </DialogTitle>
                    <DialogContent className={classes.content}>{message}</DialogContent>
                    <DialogActions>
                        <Button appearance="primary" onClick={onRetry}>
                            {retryLabel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
