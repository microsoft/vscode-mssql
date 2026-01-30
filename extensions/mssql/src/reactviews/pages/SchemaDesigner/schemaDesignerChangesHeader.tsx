/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Text } from "@fluentui/react-components";
import { Dismiss12Regular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 12px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        backgroundColor: "var(--vscode-editor-background)",
        backgroundImage:
            "linear-gradient(180deg, var(--vscode-editorWidget-background) 0%, var(--vscode-editor-background) 100%)",
        flexShrink: 0,
    },
    headerTitle: {
        fontSize: "12px",
        letterSpacing: "0.2px",
        color: "var(--vscode-foreground)",
    },
    headerActions: {
        display: "flex",
        alignItems: "center",
        gap: "6px",
    },
});

type SchemaDesignerChangesHeaderProps = {
    title: string;
    onClose: () => void;
};

export const SchemaDesignerChangesHeader = ({
    title,
    onClose,
}: SchemaDesignerChangesHeaderProps): JSX.Element => {
    const classes = useStyles();

    return (
        <div className={classes.header}>
            <Text weight="semibold" className={classes.headerTitle}>
                {title}
            </Text>
            <div className={classes.headerActions}>
                <Button
                    size="small"
                    appearance="subtle"
                    icon={<Dismiss12Regular />}
                    title={locConstants.schemaDesigner.close}
                    aria-label={locConstants.schemaDesigner.close}
                    onClick={onClose}
                />
            </div>
        </div>
    );
};
