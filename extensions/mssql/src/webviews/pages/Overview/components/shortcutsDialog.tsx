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
    Link,
    MessageBar,
    MessageBarBody,
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { Keyboard20Regular } from "@fluentui/react-icons";
import { Fragment } from "react";

import { formatShortcut } from "../../ShortcutsConfiguration/shortcutKeyboardUtils";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";
import { OverviewActionId, OverviewExtensionId } from "../../../../sharedInterfaces/overview";
import { WebviewAction } from "../../../../sharedInterfaces/webview";

const useStyles = makeStyles({
    surface: {
        maxWidth: "820px",
        width: "92vw",
    },
    title: {
        paddingBottom: tokens.spacingVerticalM,
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    titleContent: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalM,
    },
    titleIcon: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "32px",
        height: "32px",
        borderRadius: tokens.borderRadiusMedium,
        color: tokens.colorBrandForeground1,
        backgroundColor: tokens.colorBrandBackground2,
    },
    intro: {
        fontSize: "13px",
        lineHeight: "1.5",
        color: tokens.colorNeutralForeground2,
    },
    tableWrapper: {
        marginTop: tokens.spacingVerticalM,
        maxHeight: "52vh",
        overflowY: "auto",
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        borderRadius: tokens.borderRadiusMedium,
    },
    table: {
        width: "100%",
        borderCollapse: "collapse",
        fontSize: "13px",
    },
    headCell: {
        position: "sticky",
        top: 0,
        textAlign: "left",
        padding: "10px 14px",
        fontSize: "11px",
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
        backgroundColor: tokens.colorNeutralBackground3,
    },
    groupCell: {
        padding: "8px 14px",
        fontSize: "11px",
        fontWeight: tokens.fontWeightSemibold,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        color: tokens.colorNeutralForeground3,
        backgroundColor: tokens.colorNeutralBackground2,
    },
    cell: {
        padding: "9px 14px",
        borderTopWidth: "1px",
        borderTopStyle: "solid",
        borderTopColor: tokens.colorNeutralStroke2,
        color: tokens.colorNeutralForeground1,
        verticalAlign: "middle",
    },
    keys: {
        display: "flex",
        alignItems: "center",
        gap: "4px",
        flexWrap: "wrap",
    },
    key: {
        padding: "2px 7px",
        borderRadius: tokens.borderRadiusSmall,
        border: `1px solid ${tokens.colorNeutralStroke2}`,
        backgroundColor: tokens.colorNeutralBackground3,
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: "11px",
        color: tokens.colorNeutralForeground2,
    },
    keymapNote: {
        marginBottom: tokens.spacingVerticalM,
    },
    actions: {
        paddingTop: tokens.spacingVerticalM,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
});

/** Splits a chord such as "ctrl+shift+e" into display keys. */
function toKeys(chord: string): string[] {
    return formatShortcut(chord)
        .split("+")
        .map((part) => part.trim())
        .filter(Boolean);
}

const KeyChips = ({ chord }: { chord: string }) => {
    const classes = useStyles();
    const keys = toKeys(chord);
    return (
        <span className={classes.keys}>
            {keys.map((key, index) => (
                <span key={`${key}-${index}`} className={classes.key}>
                    {key}
                </span>
            ))}
        </span>
    );
};

interface ShortcutsDialogProps {
    onDismiss: () => void;
}

/**
 * Read-only summary of the extension's default command shortcuts.
 */
export const ShortcutsDialog = ({ onDismiss }: ShortcutsDialogProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { openExtension, runAction } = useOverviewActions();
    const commandShortcuts = useOverviewSelector((state) => state.commandShortcuts);
    const shortcutLabels = locConstants.shortcutsConfiguration.webviewShortcutLabels;
    const resultPaneShortcuts = [
        {
            label: shortcutLabels[WebviewAction.QueryResultSwitchToResultsTab],
            windows: ["ctrl+alt+r"],
            mac: ["ctrl+alt+r"],
        },
        {
            label: shortcutLabels[WebviewAction.QueryResultSwitchToMessagesTab],
            windows: ["ctrl+alt+y"],
            mac: ["ctrl+alt+y"],
        },
        {
            label: shortcutLabels[WebviewAction.QueryResultSwitchToQueryPlanTab],
            windows: ["ctrl+alt+e"],
            mac: ["ctrl+alt+e"],
        },
        {
            label: loc.shortcutsNavigateResultGrids,
            windows: ["ctrl+up", "ctrl+down"],
            mac: ["cmd+up", "cmd+down"],
        },
        {
            label: shortcutLabels[WebviewAction.ResultGridCopySelection],
            windows: ["ctrl+c"],
            mac: ["cmd+c"],
        },
        {
            label: shortcutLabels[WebviewAction.ResultGridSelectAll],
            windows: ["ctrl+a"],
            mac: ["cmd+a"],
        },
        {
            label: shortcutLabels[WebviewAction.ResultGridToggleSort],
            windows: ["alt+shift+o"],
            mac: ["alt+shift+o"],
        },
    ];

    const openConfiguration = () => {
        runAction(OverviewActionId.OpenShortcutsConfiguration);
        onDismiss();
    };

    return (
        <Dialog open onOpenChange={(_event, data) => !data.open && onDismiss()}>
            <DialogSurface className={classes.surface}>
                <DialogBody>
                    <DialogTitle className={classes.title}>
                        <span className={classes.titleContent}>
                            <span className={classes.titleIcon}>
                                <Keyboard20Regular aria-hidden="true" />
                            </span>
                            {loc.keyboardShortcutsTitle}
                        </span>
                    </DialogTitle>
                    <DialogContent>
                        <MessageBar className={classes.keymapNote} intent="info">
                            <MessageBarBody>
                                {loc.shortcutsKeymapPrefix}{" "}
                                {/* No href: the webview host opens any http link it sees clicked,
                                    preventDefault or not, which put the Marketplace in a browser
                                    beside the extension's page in the Extensions view. */}
                                <Link onClick={() => openExtension(OverviewExtensionId.Keymap)}>
                                    {loc.shortcutsKeymapLink}
                                </Link>
                            </MessageBarBody>
                        </MessageBar>
                        <Text className={classes.intro}>{loc.shortcutsIntro}</Text>
                        <div className={classes.tableWrapper}>
                            <table className={classes.table}>
                                <thead>
                                    <tr>
                                        <th className={classes.headCell}>{loc.shortcutsCommand}</th>
                                        <th className={classes.headCell}>
                                            {loc.shortcutsWindowsLinux}
                                        </th>
                                        <th className={classes.headCell}>{loc.shortcutsMacOs}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {commandShortcuts.map((shortcut) => (
                                        <tr key={shortcut.label}>
                                            <td className={classes.cell}>{shortcut.label}</td>
                                            <td className={classes.cell}>
                                                <KeyChips chord={shortcut.windows} />
                                            </td>
                                            <td className={classes.cell}>
                                                <KeyChips chord={shortcut.mac} />
                                            </td>
                                        </tr>
                                    ))}

                                    <tr>
                                        <td className={classes.groupCell} colSpan={3}>
                                            {loc.shortcutsQueryResultsPane}
                                        </td>
                                    </tr>
                                    {resultPaneShortcuts.map((shortcut) => (
                                        <tr key={shortcut.label}>
                                            <td className={classes.cell}>{shortcut.label}</td>
                                            <td className={classes.cell}>
                                                <span className={classes.keys}>
                                                    {shortcut.windows.map((chord, index) => (
                                                        <Fragment key={chord}>
                                                            {index > 0 && <span>/</span>}
                                                            <KeyChips chord={chord} />
                                                        </Fragment>
                                                    ))}
                                                </span>
                                            </td>
                                            <td className={classes.cell}>
                                                <span className={classes.keys}>
                                                    {shortcut.mac.map((chord, index) => (
                                                        <Fragment key={chord}>
                                                            {index > 0 && <span>/</span>}
                                                            <KeyChips chord={chord} />
                                                        </Fragment>
                                                    ))}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </DialogContent>
                    <DialogActions className={classes.actions}>
                        <Button appearance="secondary" onClick={onDismiss}>
                            {locConstants.common.close}
                        </Button>
                        <Button appearance="primary" onClick={openConfiguration}>
                            {loc.openShortcutsConfiguration}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};
