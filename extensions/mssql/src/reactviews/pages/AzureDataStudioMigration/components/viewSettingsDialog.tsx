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
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Text,
    makeStyles,
} from "@fluentui/react-components";

import { AdsMigrationSetting } from "../../../../sharedInterfaces/azureDataStudioMigration";
import { locConstants as Loc } from "../../../common/locConstants";

const useStyles = makeStyles({
    tableScrollArea: {
        overflowY: "auto",
        maxHeight: "400px",
    },
    dataTable: {
        width: "100%",
        tableLayout: "fixed",
    },
    settingKeyColumn: {
        width: "50%",
    },
    settingValueColumn: {
        width: "50%",
    },
    valueCell: {
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
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    return JSON.stringify(value);
};

export const ViewSettingsDialog = ({ settings, onClose }: ViewSettingsDialogComponentProps) => {
    const styles = useStyles();
    const loc = Loc.azureDataStudioMigration;

    return (
        <Dialog open>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>{loc.viewSettingsDialogTitle}</DialogTitle>
                    <DialogContent>
                        {settings.length === 0 ? (
                            <Text>No settings found.</Text>
                        ) : (
                            <div className={styles.tableScrollArea}>
                                <Table role="grid" className={styles.dataTable}>
                                    <TableHeader>
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
                                        {settings.map((setting) => (
                                            <TableRow key={setting.key}>
                                                <TableCell className={styles.settingKeyColumn}>
                                                    {setting.key}
                                                </TableCell>
                                                <TableCell className={styles.valueCell}>
                                                    {formatValue(setting.value)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
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
