/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { Copy16Regular } from "@fluentui/react-icons";
import { locConstants } from "./locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        alignItems: "flex-start",
        gap: "4px",
        width: "100%",
        minWidth: 0,
    },
    message: {
        flexGrow: 1,
        minWidth: 0,
        maxHeight: "72px",
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--vscode-scrollbarSlider-background) transparent",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        paddingRight: "4px",
    },
    copyButton: {
        flexShrink: 0,
    },
});

export interface ErrorMessageDetailsProps {
    message: string;
}

export const ErrorMessageDetails = ({ message }: ErrorMessageDetailsProps) => {
    const classes = useStyles();

    return (
        <div className={classes.root}>
            <div className={classes.message} tabIndex={0}>
                {message}
            </div>
            <Button
                className={classes.copyButton}
                appearance="subtle"
                size="small"
                icon={<Copy16Regular />}
                title={locConstants.common.copy}
                aria-label={locConstants.common.copy}
                onClick={() => {
                    void navigator.clipboard.writeText(message).catch(() => undefined);
                }}
            />
        </div>
    );
};
