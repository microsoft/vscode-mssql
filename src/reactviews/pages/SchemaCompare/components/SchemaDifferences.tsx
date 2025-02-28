/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import {
    Checkbox,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
} from "@fluentui/react-components";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { SchemaUpdateAction } from "../../../../sharedInterfaces/schemaCompare";

const columns = [
    { columnKey: "type", label: "Type" },
    { columnKey: "sourceName", label: "Source Name" },
    { columnKey: "include", label: "Include" },
    { columnKey: "action", label: "Action" },
    { columnKey: "targetName", label: "Target Name" },
];

const SchemaDifferences = () => {
    const context = useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;

    const formatName = (nameParts: string[]): string => {
        if (!nameParts || nameParts.length === 0) {
            return "";
        }

        return nameParts.join(".");
    };

    const getLabelForAction = (action: SchemaUpdateAction): string => {
        let actionLabel = "";
        switch (action) {
            case SchemaUpdateAction.Add:
                actionLabel = "Add";
                break;
            case SchemaUpdateAction.Change:
                actionLabel = "Change";
                break;
            case SchemaUpdateAction.Delete:
                actionLabel = "Delete";
                break;
        }

        return actionLabel;
    };

    debugger;
    return (
        <>
            {compareResult && compareResult.differences && (
                <Table>
                    <TableHeader>
                        <TableRow>
                            {columns.map((column) => (
                                <TableHeaderCell key={column.columnKey}>
                                    {column.label}
                                </TableHeaderCell>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {compareResult.differences.map((diff, index) => (
                            <TableRow key={index}>
                                <TableCell>{diff.name}</TableCell>
                                <TableCell>
                                    {formatName(diff.sourceValue)}
                                </TableCell>
                                <TableCell>
                                    <Checkbox checked />
                                </TableCell>
                                <TableCell>
                                    {getLabelForAction(
                                        diff.updateAction as number,
                                    )}
                                </TableCell>
                                <TableCell>
                                    {formatName(diff.targetValue)}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </>
    );
};

export default SchemaDifferences;
