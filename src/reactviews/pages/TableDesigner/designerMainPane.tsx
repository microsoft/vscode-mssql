/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList } from "@fluentui/react-tabs";
import {
    CounterBadge,
    Dropdown,
    Field,
    Input,
    Option,
    Text,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useContext, useEffect, useState } from "react";
import {
    DesignerEditType,
    DesignerMainPaneTabs,
    DropDownProperties,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { DesignerMainPaneTab } from "./designerMainPaneTab";
import * as l10n from "@vscode/l10n";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
    },
    title: {
        ...shorthands.margin("10px", "5px", "5px", "5px"),
        gap: "10px",
        width: "400px",
        maxWidth: "100%",
        padding: "10px",
        "> *": {
            marginBottom: "10px",
        },
    },
    separator: {
        ...shorthands.margin("0px", "-20px", "0px", "0px"),
        ...shorthands.padding("0px"),
        fontSize: "5px",
    },
    form: {
        height: "100%",
        maxWidth: "100%",
        overflow: "hidden",
    },
    tabButtonContainer: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        "> *": {
            marginRight: "5px",
        },
    },
});

export const DesignerMainPane = () => {
    const classes = useStyles();
    const state = useContext(TableDesignerContext);
    const metadata = state?.state;
    if (!metadata) {
        return null;
    }
    const [tableName, setTableName] = useState(
        (metadata.model!["name"] as InputBoxProperties).value,
    );
    const [schema, setSchema] = useState(
        (metadata.model!["schema"] as InputBoxProperties).value,
    );

    useEffect(() => {
        setTableName((metadata.model!["name"] as InputBoxProperties).value);
        setSchema((metadata.model!["schema"] as InputBoxProperties).value);
    }, [metadata.model]);

    const getCurrentTabIssuesCount = (tabId: string) => {
        const tabComponents = metadata.view?.tabs.find(
            (tab) => tab.id === tabId,
        )?.components;
        if (!tabComponents) {
            return 0;
        }
        if (metadata.issues?.length === 0) {
            return 0;
        }
        let count = 0;
        for (let i = 0; i < metadata?.issues!.length; i++) {
            const issue = metadata.issues![i];
            if (issue.propertyPath && issue.propertyPath.length > 0) {
                if (
                    tabComponents.find(
                        (c) => c.propertyName === issue.propertyPath![0],
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

    return (
        <div className={classes.root}>
            <div className={classes.title}>
                <Field
                    label={locConstants.tableDesigner.tableName}
                    orientation="horizontal"
                >
                    <Input
                        size="medium"
                        value={tableName}
                        onChange={(_event, data) => {
                            setTableName(data.value);
                        }}
                        autoFocus // initial focus
                        onBlur={(_event) => {
                            state.provider.processTableEdit({
                                source: "TabsView",
                                type: DesignerEditType.Update,
                                path: ["name"],
                                value: tableName,
                            });
                        }}
                    />
                </Field>
                <Field
                    label={locConstants.tableDesigner.schema}
                    orientation="horizontal"
                >
                    <Dropdown
                        size="medium"
                        value={schema}
                        onOptionSelect={(_event, data) => {
                            if (!data.optionValue) {
                                return;
                            }
                            setSchema(data?.optionValue);
                            state.provider.processTableEdit({
                                source: "TabsView",
                                type: DesignerEditType.Update,
                                path: ["schema"],
                                value: data.optionValue,
                            });
                        }}
                    >
                        {(
                            metadata.model?.["schema"] as DropDownProperties
                        )?.values.map((option) => {
                            return <Option>{option}</Option>;
                        })}
                    </Dropdown>
                </Field>
            </div>
            <TabList
                size="small"
                selectedValue={metadata.tabStates?.mainPaneTab}
                onTabSelect={(_event, data) => {
                    state.provider.setTab(data.value as DesignerMainPaneTabs);
                    state.provider.setPropertiesComponents(undefined);
                }}
            >
                {metadata.view?.tabs.map((tab) => {
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
                                    />
                                )}
                            </div>
                        </Tab>
                    );
                })}
            </TabList>
            <div className={classes.form}>
                {metadata.view?.tabs.map((tab) => {
                    return (
                        <div
                            style={{
                                display:
                                    metadata.tabStates?.mainPaneTab === tab.id
                                        ? ""
                                        : "none",
                                width: "100%",
                                height: "100%",
                            }}
                            key={tab.id}
                        >
                            <DesignerMainPaneTab tabId={tab.id} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
