/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Label, makeStyles, type InputProps } from "@fluentui/react-components";
import {
    Database16Regular,
    DocumentDatabase20Regular,
    MoreHorizontal16Regular,
} from "@fluentui/react-icons";
import { SchemaCompareEndpointType } from "../../../../sharedInterfaces/schemaCompare";
import { DatabaseProjectIcon } from "./DatabaseProjectIcon";

const useStyles = makeStyles({
    root: {
        flex: "1 1 220px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "5px",
    },
    label: {
        color: "var(--vscode-descriptionForeground)",
        fontSize: "11.5px",
        fontWeight: 400,
    },
    inputRow: {
        display: "flex",
        gap: "6px",
        minWidth: 0,
    },
    input: {
        flex: "1 1 auto",
        minWidth: 0,
        height: "28px",
    },
    endpointIcon: {
        width: "16px",
        height: "16px",
    },
    browseButton: {
        flex: "0 0 28px",
        minWidth: "28px",
        width: "28px",
        height: "28px",
    },
});

interface Props extends InputProps {
    label: string;
    buttonAriaLabel: string;
    disableBrowseButton: boolean;
    selectFile: () => void;
    endpointType?: SchemaCompareEndpointType;
}

const SelectSchemaInput = (props: Props) => {
    const classes = useStyles();
    const endpointIcon =
        Number(props.endpointType) === SchemaCompareEndpointType.Project ? (
            <DatabaseProjectIcon className={classes.endpointIcon} />
        ) : Number(props.endpointType) === SchemaCompareEndpointType.Dacpac ? (
            <DocumentDatabase20Regular className={classes.endpointIcon} />
        ) : (
            <Database16Regular className={classes.endpointIcon} />
        );

    return (
        <div className={`${classes.root} ${props.className ?? ""}`}>
            <Label
                className={classes.label}
                htmlFor={props.id}
                size="small"
                disabled={props.disabled}>
                {props.label}
            </Label>
            <div className={classes.inputRow}>
                <Input
                    id={props.id}
                    className={classes.input}
                    value={props.value}
                    readOnly
                    size="small"
                    contentBefore={endpointIcon}
                />
                <Button
                    size="small"
                    appearance="secondary"
                    className={classes.browseButton}
                    disabled={props.disableBrowseButton}
                    onClick={props.selectFile}
                    aria-label={props.buttonAriaLabel}
                    title={props.buttonAriaLabel}
                    icon={<MoreHorizontal16Regular />}
                />
            </div>
        </div>
    );
};

export default SelectSchemaInput;
