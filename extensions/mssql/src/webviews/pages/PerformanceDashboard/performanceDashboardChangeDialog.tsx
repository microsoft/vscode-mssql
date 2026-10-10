/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Caption1,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    makeStyles,
    MessageBar,
    MessageBarBody,
    Spinner,
    tokens,
} from "@fluentui/react-components";
import { DocumentText16Regular } from "@fluentui/react-icons";
import {
    OpenSqlScriptRequest,
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { locConstants as loc } from "../../common/locConstants";
import { VscodeEditor } from "../../common/vscodeMonaco";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

/** The script height: its lines, up to a limit, so a short script makes a short dialog. */
const lineHeight = 18;
const minScriptHeight = 72;
const maxScriptHeight = 320;

const useStyles = makeStyles({
    surface: {
        width: "min(680px, 92vw)",
        maxWidth: "92vw",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
    },
    description: {
        color: tokens.colorNeutralForeground3,
    },
    script: {
        border: "1px solid var(--vscode-panel-border)",
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
    },
    // Open in query editor is apart from Cancel and Apply.
    openAction: {
        marginRight: "auto",
    },
});

export interface ChangeDialogProps {
    readonly title: string;
    /** What the change does, above the script. Default: that Apply runs the script. */
    readonly description?: string;
    /** The T-SQL that Apply runs. */
    readonly sql: string;
    /** Why the change can't be applied. Apply is off while there are any. */
    readonly blockers?: readonly string[];
    readonly warnings?: readonly string[];
    /** An error from the last Apply, for example when the state changed. */
    readonly error?: string;
    /** True while the change is applied. */
    readonly busy?: boolean;
    readonly onApply: () => void;
    readonly onCancel: () => void;
}

/**
 * The confirmation of a change to the database, such as a Query Store setting or a forced plan:
 * the reasons it can't run, its warnings, and the T-SQL that Apply runs. The script can also be
 * opened in a query editor, to run it there.
 */
export const ChangeDialog = ({
    title,
    description,
    sql,
    blockers = [],
    warnings = [],
    error,
    busy = false,
    onApply,
    onCancel,
}: ChangeDialogProps) => {
    const classes = useStyles();
    const text = loc.performanceDashboard;
    const { extensionRpc, themeKind } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const lines = sql.split(/\r?\n/).length;
    const scriptHeight = Math.min(
        maxScriptHeight,
        Math.max(minScriptHeight, lines * lineHeight + 16),
    );

    return (
        <Dialog
            open
            modalType="modal"
            onOpenChange={(_event, data) => !data.open && !busy && onCancel()}>
            <DialogSurface className={classes.surface}>
                <DialogBody>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogContent className={classes.content}>
                        <Caption1 className={classes.description}>
                            {description ?? text.reviewDescription}
                        </Caption1>
                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}
                        {blockers.map((blocker) => (
                            <MessageBar key={blocker} intent="error">
                                <MessageBarBody>{blocker}</MessageBarBody>
                            </MessageBar>
                        ))}
                        {warnings.map((warning) => (
                            <MessageBar key={warning} intent="warning">
                                <MessageBarBody>{warning}</MessageBarBody>
                            </MessageBar>
                        ))}
                        <div className={classes.script} style={{ height: scriptHeight }}>
                            <VscodeEditor
                                height="100%"
                                width="100%"
                                language="sql"
                                themeKind={themeKind}
                                value={sql}
                                options={{
                                    readOnly: true,
                                    domReadOnly: true,
                                    lineNumbers: "on",
                                    minimap: { enabled: false },
                                    scrollBeyondLastLine: false,
                                    wordWrap: "on",
                                    automaticLayout: true,
                                    folding: false,
                                    renderLineHighlight: "none",
                                    lineDecorationsWidth: 8,
                                    fontSize: 12,
                                    ariaLabel: text.changeScript,
                                }}
                            />
                        </div>
                    </DialogContent>
                    <DialogActions fluid>
                        <Button
                            className={classes.openAction}
                            icon={<DocumentText16Regular />}
                            onClick={() =>
                                void extensionRpc.sendRequest(OpenSqlScriptRequest.type, { sql })
                            }>
                            {text.openInQueryEditor}
                        </Button>
                        <Button disabled={busy} onClick={onCancel}>
                            {loc.common.cancel}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={busy || blockers.length > 0}
                            onClick={onApply}>
                            {busy ? <Spinner size="tiny" /> : loc.common.apply}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
