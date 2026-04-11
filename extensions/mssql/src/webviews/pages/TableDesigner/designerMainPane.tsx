/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList } from "@fluentui/react-tabs";
import { CounterBadge, Field, Input, Text, makeStyles } from "@fluentui/react-components";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useTableDesignerSelector } from "./tableDesignerSelector";
import { useContext, useEffect, useState } from "react";
import {
    DesignerEditType,
    DesignerMainPaneTabs,
    DesignerTab,
    DropDownProperties,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { DesignerMainPaneTab } from "./designerMainPaneTab";
import * as l10n from "@vscode/l10n";
import { locConstants } from "../../common/locConstants";
import { SearchableDropdown } from "../../common/searchableDropdown.component";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        paddingTop: "10px",
        paddingLeft: "10px",
        paddingRight: "10px",
        boxSizing: "border-box",
        overflow: "auto",
    },
    content: {
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        flex: 1,
        gap: "10px",
    },
    title: {
        width: "400px",
        maxWidth: "100%",
        padding: "10px",
    },
    tabButtonContainer: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
});

export const DesignerMainPane = () => {
    const classes = useStyles();
    const context = useContext(TableDesignerContext);
    const model = useTableDesignerSelector((s) => s?.model);
    const view = useTableDesignerSelector((s) => s?.view);
    const tabStates = useTableDesignerSelector((s) => s?.tabStates);
    const issues = useTableDesignerSelector((s) => s?.issues);
    if (!context) {
        return null;
    }
    const [tableName, setTableName] = useState((model!["name"] as InputBoxProperties).value);
    const [schema, setSchema] = useState((model!["schema"] as InputBoxProperties).value);

    useEffect(() => {
        setTableName((model!["name"] as InputBoxProperties).value);
        setSchema((model!["schema"] as InputBoxProperties).value);
    }, [model]);

    const getCurrentTabIssuesCount = (tabId: string) => {
        const tabComponents = view?.tabs.find((tab: DesignerTab) => tab.id === tabId)?.components;
        if (!tabComponents) {
            return 0;
        }
        if (issues?.length === 0) {
            return 0;
        }
        let count = 0;
        for (let i = 0; i < issues!.length; i++) {
            const issue = issues![i];
            if (issue.propertyPath && issue.propertyPath.length > 0) {
                if (
                    tabComponents.find(
                        (c: { propertyName: string }) => c.propertyName === issue.propertyPath![0],
                    )
                ) {
                    count++;
                }
            }
        }
        return count;
    };

    function getTableIssuesCountLabel(id: string) {
        const issues = getCurrentTabIssuesCount(id);
        if (issues === 1) {
            return l10n.t({
                message: "{0} issue",
                args: [issues],
                comment: ["{0} is the number of issues"],
            });
        } else if (issues > 1 || issues === 0) {
            return l10n.t({
                message: "{0} issues",
                args: [issues],
                comment: ["{0} is the number of issues"],
            });
        }
    }

    function getTabAriaLabel(tabId: string) {
        const issues = getCurrentTabIssuesCount(tabId);
        if (issues === 0) {
            return tabId;
        } else if (issues === 1) {
            return l10n.t({
                message: "{0} {1} issue",
                args: [tabId, issues],
                comment: ["{0} is the tab name", "{1} is the number of issues"],
            });
        } else {
            return l10n.t({
                message: "{0} {1} issues",
                args: [tabId, issues],
                comment: ["{0} is the tab name", "{1} is the number of issues"],
            });
        }
    }

    function getSortedSchemaValues() {
        const schemas = (model?.["schema"] as DropDownProperties).values;
        const systemSchemas = new Set([
            "db_accessadmin",
            "db_backupoperator",
            "db_datareader",
            "db_datawriter",
            "db_ddladmin",
            "db_denydatareader",
            "db_denydatawriter",
            "db_owner",
            "db_securityadmin",
        ]);

        // Separate system schemas and user-defined schemas
        const userSchemas: string[] = [];
        const sysSchemas: string[] = [];

        for (const schema of schemas) {
            if (systemSchemas.has(schema)) {
                sysSchemas.push(schema);
            } else {
                userSchemas.push(schema);
            }
        }

        // Sort both arrays alphabetically
        userSchemas.sort((a, b) => a.localeCompare(b));
        sysSchemas.sort((a, b) => a.localeCompare(b));

        // Concatenate user-defined schemas with system schemas at the end
        return [...userSchemas, ...sysSchemas];
    }

    return (
        <div className={classes.root}>
            <div className={classes.content}>
                <Field
                    size="small"
                    label={locConstants.tableDesigner.tableName}
                    orientation="horizontal"
                    style={{ width: "300px" }}>
                    <Input
                        size="small"
                        value={tableName}
                        onChange={(_event, data) => {
                            setTableName(data.value);
                        }}
                        autoFocus // initial focus
                        onBlur={(_event) => {
                            context.processTableEdit({
                                source: "TabsView",
                                type: DesignerEditType.Update,
                                path: ["name"],
                                value: tableName,
                            });
                        }}
                    />
                </Field>
                <Field
                    size="small"
                    label={locConstants.tableDesigner.schema}
                    orientation="horizontal"
                    style={{ width: "300px" }}>
                    <SearchableDropdown
                        size="small"
                        options={getSortedSchemaValues().map((option) => ({
                            value: option,
                        }))}
                        onSelect={(option) => {
                            context.processTableEdit({
                                source: "TabsView",
                                type: DesignerEditType.Update,
                                path: ["schema"],
                                value: option.value,
                            });
                        }}
                        selectedOption={{
                            value: schema,
                        }}
                        ariaLabel={locConstants.tableDesigner.schema}
                    />
                </Field>
                <TabList
                    size="small"
                    selectedValue={tabStates?.mainPaneTab}
                    onTabSelect={(_event, data) => {
                        context.setTab(data.value as DesignerMainPaneTabs);
                        context.setPropertiesComponents(undefined);
                    }}>
                    {view?.tabs.map((tab) => {
                        const ariaLabel = getTabAriaLabel(tab.id);
                        return (
                            <Tab title={ariaLabel} value={tab.id} key={tab.id}>
                                <div className={classes.tabButtonContainer}>
                                    <Text>{tab.title}</Text>
                                    {getCurrentTabIssuesCount(tab.id) > 0 && (
                                        <CounterBadge
                                            color="important"
                                            size="small"
                                            title={getTableIssuesCountLabel(tab.id)}
                                            count={getCurrentTabIssuesCount(tab.id)}
                                            style={{ marginLeft: "6px" }}
                                        />
                                    )}
                                </div>
                            </Tab>
                        );
                    })}
                </TabList>

                {view?.tabs.map((tab) => {
                    return (
                        <div
                            style={{
                                display: tabStates?.mainPaneTab === tab.id ? "" : "none",
                                width: "100%",
                                height: "100%",
                            }}
                            key={tab.id}>
                            <DesignerMainPaneTab tabId={tab.id} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
