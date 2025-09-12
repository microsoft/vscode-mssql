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
import { ChevronRightFilled, ChevronLeftFilled, DismissRegular } from "@fluentui/react-icons";
import { locConstants } from "../../common/locConstants";
import { useAccordionStyles } from "../../common/styles";

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
        ...shorthands.flex(1),
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
    const accordionStyles = useAccordionStyles();
    const context = useContext(TableDesignerContext);
    if (!context) {
        return null;
    }
    const propertiesPaneData = context.state.propertiesPaneData!;
    const componentPath = propertiesPaneData.componentPath!;
    const tablePropertyName = componentPath[0] as string;
    const index = componentPath[componentPath.length - 1] as number;
    const parentTableProperties = context.state.propertiesPaneData?.component
        .componentProperties as DesignerTableProperties;
    const parentTablePropertiesModel = context.state.model![
        tablePropertyName
    ] as DesignerTableProperties;
    const data = parentTablePropertiesModel.data![index];

    const groups = Array.from(
        new Set(parentTableProperties.itemProperties?.filter((i) => i.group).map((i) => i.group)),
    );
    groups?.unshift("General");

    if (!data) {
        return undefined;
    }

    const renderAccordionItem = (
        group: string | undefined,
        groupItem: DesignerDataPropertyInfo[],
    ) => {
        if (!group) {
            return undefined;
        }
        return (
            <AccordionItem value={group} className={accordionStyles.accordionItem} key={group}>
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
                                            model={modelValue as CheckBoxProperties}
                                            componentPath={[
                                                ...propertiesPaneData!.componentPath,
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
                                            model={modelValue as InputBoxProperties}
                                            componentPath={[
                                                ...propertiesPaneData!.componentPath,
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
                                            model={modelValue as DropDownProperties}
                                            componentPath={[
                                                ...propertiesPaneData!.componentPath,
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
                                            model={modelValue as DesignerTableProperties}
                                            componentPath={[
                                                ...propertiesPaneData!.componentPath,
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

    const getAccordionGroups = () => {
        return groups
            ?.sort((a, b) => {
                if (!a || !b) {
                    return 0;
                }
                // Move all expanded groups to the top
                if (
                    parentTableProperties.expandedGroups?.includes(a) &&
                    !parentTableProperties.expandedGroups?.includes(b)
                ) {
                    return -1;
                }
                if (
                    parentTableProperties.expandedGroups?.includes(b) &&
                    !parentTableProperties.expandedGroups?.includes(a)
                ) {
                    return 1;
                }
                return 0;
            })
            .map((group) => {
                const groupItems = parentTableProperties
                    .itemProperties!.filter(
                        (i) => (group === "General" && !i.group) || group === i.group,
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
            });
    };

    const getExpandedGroups = () => {
        // If expanded groups are set, return them
        if (parentTableProperties.expandedGroups) {
            return parentTableProperties.expandedGroups;
        } else {
            // If expanded groups are not set, expand the first group
            if (getAccordionGroups().length > 0) {
                return [groups[0]];
            }
            // If there are no groups, return empty array
            return [];
        }
    };
    return (
        <div className={classes.root}>
            <div className={classes.title}>
                <Button
                    appearance="transparent"
                    onClick={() => {
                        if (context.propertiesPaneResizeInfo.isMaximized) {
                            context.propertiesPaneResizeInfo.setCurrentWidth(
                                context.propertiesPaneResizeInfo.originalWidth,
                            );
                        }
                        context.propertiesPaneResizeInfo.setIsMaximized(
                            !context.propertiesPaneResizeInfo.isMaximized,
                        );
                    }}
                    title={
                        context.propertiesPaneResizeInfo.isMaximized
                            ? locConstants.tableDesigner.restorePanelSize
                            : locConstants.tableDesigner.maximizePanelSize
                    }
                    icon={
                        context.propertiesPaneResizeInfo.isMaximized ? (
                            <ChevronRightFilled />
                        ) : (
                            <ChevronLeftFilled />
                        )
                    }
                    style={{
                        marginRight: "0px",
                    }}
                />
                <Text
                    size={500}
                    weight="semibold"
                    style={{
                        flex: 1,
                        lineHeight: "28px",
                    }}>
                    {locConstants.tableDesigner.propertiesPaneTitle(
                        parentTableProperties.objectTypeDisplayName ?? "",
                    )}
                </Text>
                <Button
                    appearance="transparent"
                    onClick={() => {
                        context.setPropertiesComponents(undefined);
                    }}
                    title={
                        context.propertiesPaneResizeInfo.isMaximized
                            ? locConstants.tableDesigner.restorePanelSize
                            : locConstants.tableDesigner.maximizePanelSize
                    }
                    icon={<DismissRegular />}
                />
            </div>
            <div className={classes.stack}>
                <Accordion multiple collapsible defaultOpenItems={getExpandedGroups()}>
                    {data && getAccordionGroups()}
                </Accordion>
            </div>
        </div>
    );
};
