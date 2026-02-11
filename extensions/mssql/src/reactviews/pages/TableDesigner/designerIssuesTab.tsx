/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { List, ListItem, makeStyles } from "@fluentui/react-components";
import { ErrorCircleRegular, InfoRegular, WarningRegular } from "@fluentui/react-icons";
import { DesignerIssue } from "../../../sharedInterfaces/tableDesigner";

const useStyles = makeStyles({
    issuesContainer: {
        width: "100%",
        height: "calc( 100% - 10px )", // Subtracting 10px to account for padding and hiding double scrollbars
        flexDirection: "column",
        "> *": {
            marginBottom: "10px",
        },
        backgroundColor: "var(--vscode-editor-background)",
        padding: "5px",
        overflow: "hidden auto",
    },
    issuesRows: {
        display: "flex",
        lineHeight: "20px",
        padding: "5px",
        "> *": {
            marginRight: "10px",
        },
        ":hover": {
            backgroundColor: "var(--vscode-editor-selectionHighlightBackground)",
        },
        width: "100%",
    },
});

interface DesignerIssuesTabProps {
    issues: DesignerIssue[];
    onIssueAction: (issue: DesignerIssue) => void | Promise<void>;
}

export const DesignerIssuesTab = ({ issues, onIssueAction }: DesignerIssuesTabProps) => {
    const classes = useStyles();

    return (
        <div className={classes.issuesContainer}>
            <List navigationMode="items">
                {issues.map((item, index) => (
                    <ListItem key={`issue-${index}`} onAction={() => void onIssueAction(item)}>
                        <div className={classes.issuesRows}>
                            {item.severity === "error" && (
                                <ErrorCircleRegular
                                    fontSize={20}
                                    color="var(--vscode-errorForeground)"
                                />
                            )}
                            {item.severity === "warning" && (
                                <WarningRegular fontSize={20} color="yellow" />
                            )}
                            {item.severity === "information" && (
                                <InfoRegular fontSize={20} color="blue" />
                            )}
                            {item.description}
                        </div>
                    </ListItem>
                ))}
            </List>
        </div>
    );
};
