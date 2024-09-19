/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Text, makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { DesignerCheckbox } from "./designerCheckbox";
import { DesignerInputBox } from "./designerInputBox";
import { DesignerDropdown } from "./designerDropdown";
import { DesignerTable } from "./designerTable";
import {
    CheckBoxProperties,
    DesignerTableProperties,
    DropDownProperties,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { DesignerCollapsibleDiv } from "./designerCollapsibleDiv";
import * as l10n from "@vscode/l10n";

const useStyles = makeStyles({
    root: {
        ...shorthands.padding("10px"),
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowX: "hidden",
        ...shorthands.overflow("hidden"),
    },
    title: {
        marginLeft: "10px",
        marginBottom: "10px",
        height: "30px",
    },
    stack: {
        marginBottom: "10px",
        flexDirection: "column",
        // gap between children
        "> *": {
            marginBottom: "10px",
        },
        overflowY: "auto",
    },
    group: {
        marginTop: "10px",
        overflowX: "auto",
        overflowY: "hidden",
    },
});
export const DesignerPropertiesPane = () => {
    const classes = useStyles();
    const state = useContext(TableDesignerContext);
    if (!state) {
        return null;
    }
    const propertiesPaneData = state.state.propertiesPaneData!;
    const componentPath = propertiesPaneData.componentPath!;
    const tablePropertyName = componentPath[0] as string;
    const index = componentPath[componentPath.length - 1] as number;
    const parentTableProperties = state.state.propertiesPaneData?.component
        .componentProperties as DesignerTableProperties;
    const parentTablePropertiesModel = state.state.model![
        tablePropertyName
    ] as DesignerTableProperties;
    const data = parentTablePropertiesModel.data![index];

    const groups = Array.from(
        new Set(
            parentTableProperties.itemProperties
                ?.filter((i) => i.group)
                .map((i) => i.group),
        ),
    );
    groups?.unshift("General");

    const PROPERTIES = l10n.t("Properties");
    const NO_DATA = l10n.t("No data");

    if (!data) {
        return (
            <div className={classes.root}>
                <Text className={classes.title} size={500}>
                    {PROPERTIES}
                </Text>
                <div className={classes.stack}>
                    <Text>{NO_DATA}</Text>
                </div>
            </div>
        );
    }

    return (
        <div className={classes.root}>
            <Text className={classes.title} size={500}>
                {PROPERTIES}
            </Text>
            <div className={classes.stack}>
                {data &&
                    groups?.map((group) => {
                        return (
                            <DesignerCollapsibleDiv
                                header={{
                                    title: group!,
                                    icon: undefined,
                                }}
                                key={group}
                                div={
                                    <div className={classes.group}>
                                        {parentTableProperties.itemProperties
                                            ?.filter(
                                                (i) =>
                                                    (group === "General" &&
                                                        !i.group) ||
                                                    group === i.group,
                                            )
                                            .map((item) => {
                                                if (!data) {
                                                    return undefined;
                                                }
                                                const modelValue =
                                                    data![item.propertyName];
                                                if (!modelValue) {
                                                    return undefined;
                                                }
                                                switch (item.componentType) {
                                                    case "checkbox":
                                                        return (
                                                            <div
                                                                key={`${item.propertyName}`}
                                                            >
                                                                <DesignerCheckbox
                                                                    UiArea="PropertiesView"
                                                                    component={
                                                                        item
                                                                    }
                                                                    model={
                                                                        modelValue as CheckBoxProperties
                                                                    }
                                                                    componentPath={[
                                                                        ...propertiesPaneData!
                                                                            .componentPath,
                                                                        item.propertyName,
                                                                    ]}
                                                                />
                                                            </div>
                                                        );
                                                    case "input":
                                                        return (
                                                            <div
                                                                key={`${item.propertyName}`}
                                                            >
                                                                <DesignerInputBox
                                                                    UiArea="PropertiesView"
                                                                    component={
                                                                        item
                                                                    }
                                                                    model={
                                                                        modelValue as InputBoxProperties
                                                                    }
                                                                    componentPath={[
                                                                        ...propertiesPaneData!
                                                                            .componentPath,
                                                                        item.propertyName,
                                                                    ]}
                                                                />
                                                            </div>
                                                        );
                                                    case "dropdown":
                                                        return (
                                                            <div
                                                                key={`${item.propertyName}`}
                                                            >
                                                                <DesignerDropdown
                                                                    UiArea="PropertiesView"
                                                                    component={
                                                                        item
                                                                    }
                                                                    model={
                                                                        modelValue as DropDownProperties
                                                                    }
                                                                    componentPath={[
                                                                        ...propertiesPaneData!
                                                                            .componentPath,
                                                                        item.propertyName,
                                                                    ]}
                                                                />
                                                            </div>
                                                        );
                                                    case "table":
                                                        return (
                                                            <div
                                                                key={`${item.propertyName}`}
                                                            >
                                                                <DesignerTable
                                                                    UiArea="PropertiesView"
                                                                    component={
                                                                        item
                                                                    }
                                                                    model={
                                                                        modelValue as DesignerTableProperties
                                                                    }
                                                                    componentPath={[
                                                                        ...propertiesPaneData!
                                                                            .componentPath,
                                                                        item.propertyName,
                                                                    ]}
                                                                    loadPropertiesTabData={
                                                                        false
                                                                    }
                                                                />
                                                            </div>
                                                        );
                                                }
                                            })}
                                    </div>
                                }
                            ></DesignerCollapsibleDiv>
                        );
                    })}
            </div>
        </div>
    );
};
