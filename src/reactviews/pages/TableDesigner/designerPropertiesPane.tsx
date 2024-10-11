/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Button,
    Text,
    makeStyles,
    shorthands,
} from "@fluentui/react-components";
import { useContext } from "react";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { DesignerCheckbox } from "./designerCheckbox";
import { DesignerInputBox } from "./designerInputBox";
import { DesignerDropdown } from "./designerDropdown";
import { DesignerTable } from "./designerTable";
import {
    CheckBoxProperties,
    DesignerDataPropertyInfo,
    DesignerTableProperties,
    DropDownProperties,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import {
    ChevronRightFilled,
    ChevronLeftFilled,
    DismissRegular,
} from "@fluentui/react-icons";
import * as l10n from "@vscode/l10n";
import { locConstants } from "../../common/locConstants";

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflowX: "hidden",
        ...shorthands.overflow("hidden"),
    },
    title: {
        display: "flex",
        height: "30px",
        paddingTop: "10px",
        paddingBottom: "10px",
        borderBottom: "1px solid var(--vscode-editorWidget-border)",
        "> *": {
            marginRight: "10px",
        },
        lineHeight: "30px",
    },
    stack: {
        marginBottom: "10px",
        flexDirection: "column",
        // gap between children
        "> *": {
            marginBottom: "10px",
        },
        overflowY: "auto",
        backgroundColor: "var(--vscode-editor-background)",
    },
    group: {
        overflowX: "auto",
        overflowY: "hidden",
        "> *": {
            marginBottom: "10px",
        },
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

    const renderAccordionItem = (
        group: string | undefined,
        groupItem: DesignerDataPropertyInfo[],
    ) => {
        if (!group) {
            return undefined;
        }
        return (
            <AccordionItem value={group} key={group}>
                <AccordionHeader>{group}</AccordionHeader>
                <AccordionPanel>
                    <div className={classes.group}>
                        {groupItem.map((item) => {
                            if (!data) {
                                return undefined;
                            }
                            const modelValue = data![item.propertyName];
                            switch (item.componentType) {
                                case "checkbox":
                                    return (
                                        <DesignerCheckbox
                                            UiArea="PropertiesView"
                                            component={item}
                                            model={
                                                modelValue as CheckBoxProperties
                                            }
                                            componentPath={[
                                                ...propertiesPaneData!
                                                    .componentPath,
                                                item.propertyName,
                                            ]}
                                            key={`${group}-${item.propertyName}`}
                                        />
                                    );
                                case "input":
                                    return (
                                        <DesignerInputBox
                                            UiArea="PropertiesView"
                                            component={item}
                                            model={
                                                modelValue as InputBoxProperties
                                            }
                                            componentPath={[
                                                ...propertiesPaneData!
                                                    .componentPath,
                                                item.propertyName,
                                            ]}
                                            horizontal
                                            key={`${group}-${item.propertyName}`}
                                        />
                                    );
                                case "dropdown":
                                    return (
                                        <DesignerDropdown
                                            UiArea="PropertiesView"
                                            component={item}
                                            model={
                                                modelValue as DropDownProperties
                                            }
                                            componentPath={[
                                                ...propertiesPaneData!
                                                    .componentPath,
                                                item.propertyName,
                                            ]}
                                            horizontal
                                            key={`${group}-${item.propertyName}`}
                                        />
                                    );
                                case "table":
                                    return (
                                        <DesignerTable
                                            UiArea="PropertiesView"
                                            component={item}
                                            model={
                                                modelValue as DesignerTableProperties
                                            }
                                            componentPath={[
                                                ...propertiesPaneData!
                                                    .componentPath,
                                                item.propertyName,
                                            ]}
                                            loadPropertiesTabData={false}
                                            key={`${group}-${item.propertyName}`}
                                        />
                                    );
                            }
                        })}
                    </div>
                </AccordionPanel>
            </AccordionItem>
        );
    };

    return (
        <div className={classes.root}>
            <div className={classes.title}>
                <Button
                    appearance="transparent"
                    onClick={() => {
                        if (state.propertiesPaneResizeInfo.isMaximized) {
                            state.propertiesPaneResizeInfo.setCurrentWidth(
                                state.propertiesPaneResizeInfo.originalWidth,
                            );
                        }
                        state.propertiesPaneResizeInfo.setIsMaximized(
                            !state.propertiesPaneResizeInfo.isMaximized,
                        );
                    }}
                    title={
                        state.propertiesPaneResizeInfo.isMaximized
                            ? locConstants.tableDesigner.restorePanelSize
                            : locConstants.tableDesigner.maximizePanelSize
                    }
                    icon={
                        state.propertiesPaneResizeInfo.isMaximized ? (
                            <ChevronRightFilled />
                        ) : (
                            <ChevronLeftFilled />
                        )
                    }
                />
                <Text
                    size={500}
                    style={{
                        fontWeight: "bold",
                        flex: 1,
                    }}
                >
                    {locConstants.tableDesigner.propertiesPaneTitle(
                        parentTableProperties.objectTypeDisplayName ?? "",
                    )}
                </Text>
                <Button
                    appearance="outline"
                    onClick={() => {
                        state.provider.setPropertiesComponents(undefined);
                    }}
                    title={
                        state.propertiesPaneResizeInfo.isMaximized
                            ? locConstants.tableDesigner.restorePanelSize
                            : locConstants.tableDesigner.maximizePanelSize
                    }
                    icon={<DismissRegular />}
                />
            </div>
            <div className={classes.stack}>
                <Accordion multiple collapsible defaultOpenItems={[groups[0]]}>
                    {data &&
                        groups?.map((group) => {
                            const groupItems = parentTableProperties
                                .itemProperties!.filter(
                                    (i) =>
                                        (group === "General" && !i.group) ||
                                        group === i.group,
                                )
                                .filter((item) => {
                                    if (item.showInPropertiesView === false) {
                                        return false;
                                    }
                                    const modelValue = data![item.propertyName];
                                    if (!modelValue) {
                                        return false;
                                    }
                                    if (
                                        (
                                            modelValue as
                                                | InputBoxProperties
                                                | CheckBoxProperties
                                                | DropDownProperties
                                        )?.enabled === false
                                    ) {
                                        return false;
                                    }
                                    return true;
                                });
                            if (groupItems.length === 0) {
                                return undefined;
                            }
                            return renderAccordionItem(group, groupItems);
                        })}
                </Accordion>
            </div>
        </div>
    );
};
