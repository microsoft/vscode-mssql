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
} from "@fluentui/react-components";
import React from "react";
import { ErrorMessageDetails } from "./errorMessageDetails";

const useStyles = makeStyles({
    dialogSurface: {
        minWidth: "320px",
        width: "min(520px, calc(100vw - 32px))",
        maxWidth: "min(520px, calc(100vw - 32px))",
    },
    content: {
        marginBlock: "16px 0",
    },
});

export interface ErrorDialogProps {
    open: boolean;
    title: string;
    message: string;
    retryLabel: string;
    onRetry: () => void;
}

export const ErrorDialog: React.FC<ErrorDialogProps> = ({
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
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent className={classes.content}>
                        <ErrorMessageDetails message={message} />
                    </DialogContent>
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
