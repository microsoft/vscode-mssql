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
    Spinner,
    makeStyles,
} from "@fluentui/react-components";
import { Copy16Regular } from "@fluentui/react-icons";
import { Suspense, lazy } from "react";
import { locConstants } from "../../common/locConstants";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

// Monaco loads the first time a value is opened, so plans that never open one don't pay for it.
const VscodeEditor = lazy(async () => {
    const module = await import("../../common/vscodeMonaco");
    return { default: module.VscodeEditor };
});

const useStyles = makeStyles({
    surface: {
        width: "min(800px, calc(100vw - 32px))",
        maxWidth: "min(800px, calc(100vw - 32px))",
    },
    titleText: {
        display: "block",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    editorContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "min(320px, 50vh)",
        border: "1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border, transparent))",
    },
});

interface PropertyValue {
    name: string;
    value: string;
}

interface PropertyValueDialogProps {
    /** The property to show, or undefined while the dialog is closed. */
    property: PropertyValue | undefined;
    onClose: () => void;
}

/**
 * Shows the full value of an execution plan property in a read-only SQL editor.
 */
export const PropertyValueDialog = ({ property, onClose }: PropertyValueDialogProps) => {
    const classes = useStyles();
    const { themeKind } = useVscodeWebview();
    const name = property?.name ?? "";
    const value = property?.value ?? "";

    return (
        <Dialog open={property !== undefined} onOpenChange={(_, data) => !data.open && onClose()}>
            <DialogSurface className={classes.surface}>
                <DialogBody>
                    <DialogTitle
                        action={
                            <Button
                                appearance="subtle"
                                size="small"
                                icon={<Copy16Regular />}
                                title={locConstants.common.copy}
                                aria-label={locConstants.common.copy}
                                onClick={() => {
                                    void navigator.clipboard
                                        .writeText(value)
                                        .catch(() => undefined);
                                }}
                            />
                        }>
                        <span className={classes.titleText} title={name}>
                            {name}
                        </span>
                    </DialogTitle>
                    <DialogContent>
                        <div className={classes.editorContainer}>
                            <Suspense fallback={<Spinner size="small" />}>
                                <VscodeEditor
                                    height="100%"
                                    width="100%"
                                    language="sql"
                                    themeKind={themeKind}
                                    value={value}
                                    onMount={(editor) => editor.focus()}
                                    options={{
                                        readOnly: true,
                                        domReadOnly: true,
                                        // Let Tab leave the editor so the dialog's buttons stay
                                        // reachable from the keyboard.
                                        tabFocusMode: true,
                                        wordWrap: "on",
                                        lineNumbers: "on",
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        automaticLayout: true,
                                        renderLineHighlight: "none",
                                        ariaLabel: name,
                                    }}
                                />
                            </Suspense>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {locConstants.common.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
