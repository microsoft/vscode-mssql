/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared layout for the deployments dialog's views.
 *
 * The dialog has a fixed frame, so each view fills it the same way: the title
 * sits at the top, the body grows to take the remaining height with its content
 * centered in it, and the actions row stays pinned to the bottom. Without this
 * the shorter steps would leave their content hugging the title and their
 * buttons floating in the middle of the surface.
 */

import { DialogContent, DialogTitle, makeStyles, mergeClasses } from "@fluentui/react-components";
import { ReactNode } from "react";

const useStyles = makeStyles({
    content: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
    },
    /** Centers a short view's content in the space the frame gives it. */
    centered: {
        justifyContent: "center",
        alignItems: "center",
    },
    /** Caps the readable width of centered content in an 800px surface. */
    centeredInner: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
        width: "100%",
        maxWidth: "560px",
        textAlign: "center",
    },
    /** A view that manages its own scrolling, such as the deployments list. */
    filled: {
        justifyContent: "flex-start",
        alignItems: "stretch",
        gap: "12px",
    },
});

interface DabDialogContentProps {
    /**
     * When true the content is centered in the frame, which suits the short
     * steps. Views that fill the frame themselves pass false.
     */
    centered?: boolean;
    className?: string;
    children: ReactNode;
}

/** The dialog body between the title and the actions row. */
export const DabDialogContent = ({
    centered = true,
    className,
    children,
}: DabDialogContentProps) => {
    const classes = useStyles();

    return (
        <DialogContent
            className={mergeClasses(
                classes.content,
                centered ? classes.centered : classes.filled,
                className,
            )}>
            {centered ? <div className={classes.centeredInner}>{children}</div> : children}
        </DialogContent>
    );
};

/** The dialog title, kept as its own export so views read consistently. */
export const DabDialogTitle = ({ children }: { children: ReactNode }) => (
    <DialogTitle>{children}</DialogTitle>
);
