/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared layout for the deployments dialog's views.
 *
 * The dialog has a fixed frame, so each view fills it the same way: the title
 * sits at the top, the body grows to take the remaining height, and the actions
 * row stays pinned to the bottom.
 *
 * Content starts at the top left, which is where a wizard step is read from.
 * Centering is opt-in and used only where there is a single short message to
 * present, such as the empty deployments list.
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
    /** Content reads from the top left, the default for a wizard step. */
    start: {
        justifyContent: "flex-start",
        alignItems: "stretch",
        gap: "16px",
        textAlign: "left",
    },
    /** Centers a single short message in the space the frame gives it. */
    centered: {
        justifyContent: "center",
        alignItems: "center",
        gap: "8px",
        textAlign: "center",
    },
});

interface DabDialogContentProps {
    /**
     * Centers the content instead of starting it at the top left. Reserved for
     * a view that shows one short message.
     */
    centered?: boolean;
    className?: string;
    children: ReactNode;
}

/** The dialog body between the title and the actions row. */
export const DabDialogContent = ({
    centered = false,
    className,
    children,
}: DabDialogContentProps) => {
    const classes = useStyles();

    return (
        <DialogContent
            className={mergeClasses(
                classes.content,
                centered ? classes.centered : classes.start,
                className,
            )}>
            {children}
        </DialogContent>
    );
};

/** The dialog title, kept as its own export so views read consistently. */
export const DabDialogTitle = ({ children }: { children: ReactNode }) => (
    <DialogTitle>{children}</DialogTitle>
);
