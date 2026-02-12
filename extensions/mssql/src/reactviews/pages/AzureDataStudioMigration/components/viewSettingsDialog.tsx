/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    Tooltip,
    makeStyles,
} from "@fluentui/react-components";

import { AdsMigrationSetting } from "../../../../sharedInterfaces/azureDataStudioMigration";
import { locConstants as Loc } from "../../../common/locConstants";

const MSSQL_PREFIX = "mssql.";

export const ViewSettingsDialog = ({ settings, onClose }: ViewSettingsDialogComponentProps) => {
    const styles = useStyles();
    const loc = Loc.azureDataStudioMigration;

    const sortedSettings = useMemo(
        () => [...settings].sort((a, b) => a.key.localeCompare(b.key)),
        [settings],
    );

    return (
        <Dialog open>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{loc.viewSettingsDialogTitle}</DialogTitle>
                    <DialogContent>
                        {sortedSettings.length === 0 ? (
                            <Text>{loc.noCustomizedSettingsFound}</Text>
                        ) : (
                            <div className={styles.tableScrollArea}>
                                <Table role="grid" className={styles.dataTable}>
                                    <TableHeader className={styles.stickyHeader}>
                                        <TableRow>
                                            <TableHeaderCell className={styles.settingKeyColumn}>
                                                {loc.settingsKeyColumn}
                                            </TableHeaderCell>
                                            <TableHeaderCell className={styles.settingValueColumn}>
                                                {loc.settingsValueColumn}
                                            </TableHeaderCell>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {sortedSettings.map((setting) => {
                                            const displayKey = stripPrefix(setting.key);
                                            const displayValue = formatValue(setting.value);
                                            return (
                                                <TableRow key={setting.key}>
                                                    <TableCell className={styles.settingKeyColumn}>
                                                        <Tooltip
                                                            content={setting.key}
                                                            relationship="description">
                                                            <span className={styles.truncatedCell}>
                                                                {displayKey}
                                                            </span>
                                                        </Tooltip>
                                                    </TableCell>
                                                    <TableCell
                                                        className={styles.settingValueColumn}>
                                                        <Tooltip
                                                            content={displayValue}
                                                            relationship="description">
                                                            <span className={styles.truncatedCell}>
                                                                {displayValue}
                                                            </span>
                                                        </Tooltip>
                                                    </TableCell>
                                                </TableRow>
                                            );
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="secondary" onClick={onClose}>
                            {Loc.common.close}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

const useStyles = makeStyles({
    tableScrollArea: {
        overflowY: "auto",
        maxHeight: "400px",
    },
    dataTable: {
        width: "100%",
        tableLayout: "fixed",
    },
    stickyHeader: {
        position: "sticky",
        top: "0",
        zIndex: 1,
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    settingKeyColumn: {
        width: "50%",
    },
    settingValueColumn: {
        width: "50%",
    },
    truncatedCell: {
        display: "block",
        width: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
});

interface ViewSettingsDialogComponentProps {
    settings: AdsMigrationSetting[];
    onClose: () => void;
}

const formatValue = (value: unknown): string => {
    // eslint-disable-next-line no-restricted-syntax
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value);
};

const stripPrefix = (key: string): string => {
    return key.startsWith(MSSQL_PREFIX) ? key.slice(MSSQL_PREFIX.length) : key;
};
