/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Apply Changes dialog (SV-R8c) — legacy publish-dialog parity over the
 * v1 handoff machine. Opening the dialog requests a PREVIEW (this is when
 * the classic connection resolves and the v1/DacFx session is created —
 * command-time, D3/§8.1); the DacFx report renders with honest data-loss
 * and table-recreation warnings; Publish spends the preview token
 * (§8.4). Closing without publishing cancels the preview so the v1
 * session never outlives the dialog (§8.5 disposal rules).
 */

import { useContext, useEffect, useRef, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    MessageBar,
    MessageBarBody,
    Spinner,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { VscodeWebviewContext } from "../../common/vscodeWebviewProvider";
import { SchemaVisualizer } from "../../../sharedInterfaces/schemaVisualizer";
import { SchemaVisualizerEditOp } from "../../../schemaVisualizer/model/schemaVisualizerEdit";

const useStyles = makeStyles({
    report: {
        maxHeight: "40vh",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        fontSize: "12px",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: "4px",
        padding: "8px",
    },
    stack: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
    },
});

type DialogPhase =
    | { phase: "previewing" }
    | { phase: "previewFailed"; code: string; message: string }
    | { phase: "ready"; token: SchemaVisualizer.PreviewToken }
    | { phase: "publishing"; token: SchemaVisualizer.PreviewToken }
    | { phase: "publishFailed"; token: SchemaVisualizer.PreviewToken; message: string };

export interface SchemaVisualizerPublishDialogProps {
    operations: SchemaVisualizerEditOp[];
    /** Publish succeeded: clear the op log and reload the model. */
    onPublished: (refreshFailed: boolean) => void;
    onClose: () => void;
}

export const SchemaVisualizerPublishDialog = (props: SchemaVisualizerPublishDialogProps) => {
    const styles = useStyles();
    const webview = useContext(VscodeWebviewContext);
    const rpc = webview!.extensionRpc;
    const [phase, setPhase] = useState<DialogPhase>({ phase: "previewing" });
    const publishedRef = useRef(false);

    useEffect(() => {
        let disposed = false;
        void rpc
            .sendRequest(SchemaVisualizer.PreviewChangesRequest.type, {
                operations: props.operations,
            })
            .then((result) => {
                if (disposed) {
                    return;
                }
                if (result.ok === false) {
                    setPhase({
                        phase: "previewFailed",
                        code: result.code,
                        message: result.message,
                    });
                } else {
                    setPhase({ phase: "ready", token: result.token });
                }
            })
            .catch((error) => {
                if (!disposed) {
                    setPhase({
                        phase: "previewFailed",
                        code: "previewFailed",
                        message: error instanceof Error ? error.message : String(error),
                    });
                }
            });
        return () => {
            disposed = true;
            // Leaving the dialog without publishing releases the v1 session.
            if (!publishedRef.current) {
                void rpc
                    .sendRequest(SchemaVisualizer.CancelPreviewRequest.type, {})
                    .catch(() => undefined);
            }
        };
        // Mount-only: the op set is frozen for the dialog's lifetime.
    }, []);

    const publish = async (token: SchemaVisualizer.PreviewToken) => {
        setPhase({ phase: "publishing", token });
        try {
            const result = await rpc.sendRequest(SchemaVisualizer.PublishRequest.type, { token });
            if (result.ok === false) {
                setPhase({ phase: "publishFailed", token, message: result.message });
                return;
            }
            publishedRef.current = true;
            props.onPublished(result.refreshFailed === true);
        } catch (error) {
            setPhase({
                phase: "publishFailed",
                token,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const report =
        phase.phase === "ready" || phase.phase === "publishing" || phase.phase === "publishFailed"
            ? phase.token.report
            : undefined;

    return (
        <Dialog open modalType="modal" onOpenChange={(_e, data) => !data.open && props.onClose()}>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Apply Changes</DialogTitle>
                    <DialogContent className={styles.stack}>
                        {phase.phase === "previewing" && (
                            <Spinner label="Creating change report (connecting to the database via DacFx)…" />
                        )}
                        {phase.phase === "previewFailed" && (
                            <MessageBar intent="error">
                                <MessageBarBody>
                                    Preview failed ({phase.code}): {phase.message}
                                </MessageBarBody>
                            </MessageBar>
                        )}
                        {report !== undefined && (
                            <>
                                {report.dacReport.possibleDataLoss && (
                                    <MessageBar intent="error">
                                        <MessageBarBody>
                                            These changes may cause DATA LOSS.
                                        </MessageBarBody>
                                    </MessageBar>
                                )}
                                {report.dacReport.requireTableRecreation && (
                                    <MessageBar intent="warning">
                                        <MessageBarBody>
                                            One or more tables will be dropped and recreated.
                                        </MessageBarBody>
                                    </MessageBar>
                                )}
                                {report.dacReport.hasWarnings &&
                                    !report.dacReport.possibleDataLoss && (
                                        <MessageBar intent="warning">
                                            <MessageBarBody>
                                                The report contains warnings — review before
                                                publishing.
                                            </MessageBarBody>
                                        </MessageBar>
                                    )}
                                {!report.hasSchemaChanged && (
                                    <MessageBar intent="info">
                                        <MessageBarBody>
                                            DacFx reports no effective schema change.
                                        </MessageBarBody>
                                    </MessageBar>
                                )}
                                <div className={styles.report}>
                                    {report.dacReport.report.length > 0
                                        ? report.dacReport.report
                                        : "No report details."}
                                </div>
                            </>
                        )}
                        {phase.phase === "publishFailed" && (
                            <MessageBar intent="error">
                                <MessageBarBody>Publish failed: {phase.message}</MessageBarBody>
                            </MessageBar>
                        )}
                    </DialogContent>
                    <DialogActions>
                        {(phase.phase === "ready" || phase.phase === "publishFailed") && (
                            <Button appearance="primary" onClick={() => void publish(phase.token)}>
                                Publish
                            </Button>
                        )}
                        {phase.phase === "publishing" && (
                            <Button appearance="primary" disabled>
                                Publishing…
                            </Button>
                        )}
                        <Button onClick={props.onClose}>Cancel</Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
