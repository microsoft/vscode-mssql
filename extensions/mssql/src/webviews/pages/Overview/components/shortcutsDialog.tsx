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
    Text,
    makeStyles,
    tokens,
} from "@fluentui/react-components";
import { Fragment } from "react";

import {
    getShortcutGroupLabel,
    shortcutGroups,
} from "../../ShortcutsConfiguration/shortcutDefinitions";
import { formatShortcut } from "../../ShortcutsConfiguration/shortcutKeyboardUtils";
import { locConstants } from "../../../common/locConstants";
import { useOverviewActions } from "../useOverviewActions";
import { useOverviewSelector } from "../overviewSelector";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import {
    OverviewActionId,
    OverviewReducers,
    OverviewWebviewState,
} from "../../../../sharedInterfaces/overview";

const useStyles = makeStyles({
    surface: {
        maxWidth: "820px",
        width: "92vw",
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
 * Read-only summary of the extension's default shortcuts: contributed command keybindings
 * first, then the results-pane bindings resolved for this webview.
 */
export const ShortcutsDialog = ({ onDismiss }: ShortcutsDialogProps) => {
    const classes = useStyles();
    const loc = locConstants.overview;
    const { runAction } = useOverviewActions();
    const commandShortcuts = useOverviewSelector((state) => state.commandShortcuts);
    const { keyBindings } = useVscodeWebview<OverviewWebviewState, OverviewReducers>();

    const openConfiguration = () => {
        runAction(OverviewActionId.OpenShortcutsConfiguration);
        onDismiss();
    };

    return (
        <Dialog open onOpenChange={(_event, data) => !data.open && onDismiss()}>
            <DialogSurface className={classes.surface}>
                <DialogBody>
                    <DialogTitle>{loc.keyboardShortcutsTitle}</DialogTitle>
                    <DialogContent>
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

                                    {shortcutGroups.map((group) => {
                                        // Actions with no binding are skipped, so a group with
                                        // none left must not render a bare heading.
                                        const boundItems = group.items.filter(
                                            (item) => keyBindings?.[item.action]?.label,
                                        );
                                        if (boundItems.length === 0) {
                                            return undefined;
                                        }
                                        return (
                                            <Fragment key={group.id}>
                                                <tr>
                                                    <td className={classes.groupCell} colSpan={3}>
                                                        {getShortcutGroupLabel(
                                                            group.id,
                                                            locConstants.shortcutsConfiguration,
                                                        )}
                                                    </td>
                                                </tr>
                                                {boundItems.map((item) => {
                                                    // `label` is the already-formatted chord.
                                                    const chord = keyBindings[item.action].label;
                                                    return (
                                                        <tr key={item.action}>
                                                            <td className={classes.cell}>
                                                                {
                                                                    locConstants
                                                                        .shortcutsConfiguration
                                                                        .webviewShortcutLabels[
                                                                        item.action
                                                                    ]
                                                                }
                                                            </td>
                                                            <td
                                                                className={classes.cell}
                                                                colSpan={2}>
                                                                <KeyChips chord={chord} />
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </DialogContent>
                    <DialogActions>
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
