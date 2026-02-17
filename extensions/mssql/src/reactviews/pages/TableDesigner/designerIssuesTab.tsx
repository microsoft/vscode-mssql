/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DesignerIssue,
    DesignerMainPaneTabs,
    DesignerPropertyPath,
    TableProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { locConstants } from "../../common/locConstants";
import { DefinitionPanelCustomTab } from "../../common/definitionPanel";
import { List, ListItem, makeStyles } from "@fluentui/react-components";
import { ErrorCircleRegular, InfoRegular, WarningRegular } from "@fluentui/react-icons";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useTableDesignerSelector } from "./tableDesignerSelector";

export const ISSUES_TAB_ID = "issues" as const;

function isDesignerMainPaneTabId(tabId: string): tabId is DesignerMainPaneTabs {
    return Object.values(DesignerMainPaneTabs).includes(tabId as DesignerMainPaneTabs);
}

function getIssueIconColor(severity: DesignerIssue["severity"]): string {
    switch (severity) {
        case "error":
            return "var(--vscode-errorForeground)";
        case "warning":
            return "var(--vscode-editorWarning-foreground)";
        case "information":
            return "var(--vscode-editorInfo-foreground)";
        default:
            return "var(--vscode-foreground)";
    }
}

const useStyles = makeStyles({
    issuesContainer: {
        width: "100%",
        height: "calc( 100% - 10px )",
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
}

function useOpenAndFocusIssueComponent(): (issue: DesignerIssue) => Promise<void> {
    const context = useContext(TableDesignerContext);
    const view = useTableDesignerSelector((s) => s?.view);
    const model = useTableDesignerSelector((s) => s?.model);

    return async (issue: DesignerIssue): Promise<void> => {
        if (!context) {
            return;
        }
        const issuePath: DesignerPropertyPath = issue.propertyPath ?? [];
        if (!view?.tabs) {
            return;
        }
        const containingTab = view.tabs.find((tab) => {
            return tab.components.find((c) => {
                return c.propertyName === issuePath[0];
            });
        });

        if (!containingTab || !isDesignerMainPaneTabId(containingTab.id)) {
            return;
        } else {
            context.setTab(containingTab.id);
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        let tableComponent;
        let tableModel;
        if (issuePath.length > 1) {
            // error is found in a table row. Load properties for the row
            tableComponent = containingTab.components.find((c) => c.propertyName === issuePath[0]);
            if (!tableComponent) {
                return;
            }
            tableModel = model![tableComponent.propertyName];
            if (!tableModel) {
                return;
            }
            context.setPropertiesComponents({
                componentPath: [issuePath[0], issuePath[1]],
                component: tableComponent,
                model: tableModel,
            });
        }

        let elementToFocus: HTMLElement | undefined = undefined;
        switch (issuePath.length) {
            case 1: // This is a component in the main tab area. Therefore we can directly focus on the component
            case 3: // This is a component in the properties pane. Since we have already loaded the properties pane, we can directly focus on the component
            case 5: // This is a component in the table inside the properties pane. Since we have already loaded the properties pane, we can directly focus on the component
                elementToFocus = context.elementRefs.current[context.getComponentId(issuePath)];
                break;
            case 2: // This is table row. Therefore focuing on the first property of the row
                if (!tableComponent) {
                    return;
                }
                const firstProperty = (tableComponent.componentProperties as TableProperties)
                    .itemProperties[0].propertyName;
                elementToFocus =
                    context.elementRefs.current[
                        context.getComponentId([...issuePath, firstProperty])
                    ];
                break;
            case 4: // This is table row in properties pane. Therefore focuing on the first property of the row
                if (!tableComponent) {
                    return;
                }
                const subTableName = issuePath[2];
                const subTableComponent = (
                    tableComponent.componentProperties as TableProperties
                ).itemProperties.find((c) => c.propertyName === subTableName);
                if (!subTableComponent) {
                    return;
                }
                const firstPropertyInSubTable = (
                    subTableComponent.componentProperties as TableProperties
                ).itemProperties[0].propertyName;
                elementToFocus =
                    context.elementRefs.current[
                        context.getComponentId([...issuePath, firstPropertyInSubTable])
                    ];
                break;
            default:
                break;
        }

        if (elementToFocus) {
            elementToFocus.scrollIntoView({
                behavior: "smooth",
                block: "center",
                inline: "center",
            });
            elementToFocus.focus();
        }
    };
}

const DesignerIssuesTab = ({ issues }: DesignerIssuesTabProps) => {
    const classes = useStyles();
    const onIssueClick = useOpenAndFocusIssueComponent();

    return (
        <div className={classes.issuesContainer}>
            <List navigationMode="items">
                {issues.map((item, index) => (
                    <ListItem
                        key={`issue-${index}`}
                        aria-label={`${item.severity}: ${item.description}`}
                        title={item.description}
                        onAction={() => onIssueClick(item)}>
                        <div className={classes.issuesRows}>
                            {item.severity === "error" && (
                                <ErrorCircleRegular
                                    fontSize={20}
                                    color={getIssueIconColor(item.severity)}
                                />
                            )}
                            {item.severity === "warning" && (
                                <WarningRegular
                                    fontSize={20}
                                    color={getIssueIconColor(item.severity)}
                                />
                            )}
                            {item.severity === "information" && (
                                <InfoRegular
                                    fontSize={20}
                                    color={getIssueIconColor(item.severity)}
                                />
                            )}
                            {item.description}
                        </div>
                    </ListItem>
                ))}
            </List>
        </div>
    );
};

export function createDesignerIssuesTab(
    issues: DesignerIssue[],
): DefinitionPanelCustomTab<typeof ISSUES_TAB_ID> {
    return {
        id: ISSUES_TAB_ID,
        label: locConstants.tableDesigner.issuesTabHeader(issues.length),
        content: <DesignerIssuesTab issues={issues} />,
    };
}
