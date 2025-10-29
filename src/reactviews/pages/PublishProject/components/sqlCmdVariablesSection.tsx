/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Input,
    Field,
    makeStyles,
} from "@fluentui/react-components";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { LocConstants } from "../../../common/locConstants";

const useStyles = makeStyles({
    table: {
        width: "100%",
        maxWidth: "640px",
    },
    nameCell: {
        width: "40%",
        fontWeight: "600",
    },
    valueCell: {
        width: "60%",
    },
});

export const SqlCmdVariablesSection: React.FC = () => {
    const styles = useStyles();
    const loc = LocConstants.getInstance().publishProject;
    const publishCtx = useContext(PublishProjectContext);
    const sqlCmdVariables = usePublishDialogSelector((s) => s.formState.sqlCmdVariables);
    const sqlCmdComponent = usePublishDialogSelector((s) => s.formComponents.sqlCmdVariables);

    if (!publishCtx || !sqlCmdVariables || !sqlCmdComponent || sqlCmdComponent.hidden) {
        return null;
    }

    const variableEntries = Object.entries(sqlCmdVariables);

    if (variableEntries.length === 0) {
        return null;
    }

    const handleValueChange = (varName: string, newValue: string) => {
        const updatedVariables = {
            ...sqlCmdVariables,
            [varName]: newValue,
        };
        publishCtx.formAction({
            propertyName: sqlCmdComponent.propertyName,
            isAction: false,
            value: JSON.stringify(updatedVariables), // FormEvent expects string or boolean
            updateValidation: false,
        });
    };

    return (
        <Field
            label={sqlCmdComponent.label}
            required={sqlCmdComponent.required}
            orientation="horizontal">
            <Table className={styles.table} size="small" aria-label={loc.SqlCmdVariablesLabel}>
                <TableHeader>
                    <TableRow>
                        <TableHeaderCell className={styles.nameCell}>
                            {loc.SqlCmdVariableNameColumn}
                        </TableHeaderCell>
                        <TableHeaderCell className={styles.valueCell}>
                            {loc.SqlCmdVariableValueColumn}
                        </TableHeaderCell>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {variableEntries.map(([varName, varValue]) => (
                        <TableRow key={varName}>
                            <TableCell className={styles.nameCell}>
                                <TableCellLayout>{varName}</TableCellLayout>
                            </TableCell>
                            <TableCell className={styles.valueCell}>
                                <Input
                                    size="small"
                                    value={varValue || ""}
                                    onChange={(_, data) => handleValueChange(varName, data.value)}
                                    aria-label={`Value for ${varName}`}
                                />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </Field>
    );
};
