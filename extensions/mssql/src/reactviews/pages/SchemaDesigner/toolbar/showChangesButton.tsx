/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from "@fluentui/react-components";
import { DocumentBulletListRegular } from "@fluentui/react-icons";
import * as React from "react";
import { useDiffViewerOptional } from "../diffViewer/diffViewerContext";
import { locConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    button: {
        minWidth: "auto",
    },
});

/**
 * Toolbar button that shows/hides the diff viewer drawer.
 * Displays a live count of pending changes.
 *
 * Uses useDiffViewerOptional() for safe context access - when rendered
 * outside of DiffViewerProvider (e.g., feature disabled), it shows
 * a disabled button with "No changes" label instead of throwing.
 */
export function ShowChangesButton() {
    const classes = useStyles();
    const diffViewerContext = useDiffViewerOptional();

    // If context is not available (outside provider), show a disabled fallback
    if (!diffViewerContext) {
        const fallbackLabel =
            locConstants.schemaDesigner.diffViewer?.showChanges(0) ?? "No changes";

        return (
            <Button
                className={classes.button}
                appearance="subtle"
                icon={<DocumentBulletListRegular />}
                onClick={() => {}}
                size="small"
                title={fallbackLabel}
                disabled={true}
                aria-label={fallbackLabel}>
                {fallbackLabel}
            </Button>
        );
    }

    const { toggleDrawer, state } = diffViewerContext;
    const changeCounts = state.changeCounts;

    const handleClick = React.useCallback(() => {
        toggleDrawer();
    }, [toggleDrawer]);

    const buttonLabel =
        locConstants.schemaDesigner.diffViewer?.showChanges(changeCounts.total) ??
        `Show Changes (${changeCounts.total})`;

    return (
        <Button
            className={classes.button}
            appearance="subtle"
            icon={<DocumentBulletListRegular />}
            onClick={handleClick}
            size="small"
            title={buttonLabel}
            aria-pressed={state.isDrawerOpen}
            aria-label={buttonLabel}>
            {buttonLabel}
        </Button>
    );
}

export default ShowChangesButton;
