/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useTableDesignerSelector } from "./tableDesignerSelector";
import { useContext } from "react";
import {
    CheckBoxProperties,
    DesignerDataPropertyInfo,
    DesignerTab,
    DesignerTableProperties,
    DropDownProperties,
    InputBoxProperties,
} from "../../../sharedInterfaces/tableDesigner";
import { DesignerCheckbox } from "./designerCheckbox";
import { DesignerInputBox } from "./designerInputBox";
import { DesignerDropdown } from "./designerDropdown";
import { DesignerTable } from "./designerTable";

export interface DesignerMainPaneTabProps {
    tabId: string;
}

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
    },
});

export const DesignerMainPaneTab = ({ tabId }: DesignerMainPaneTabProps) => {
    const classes = useStyles();
    const context = useContext(TableDesignerContext);
    const view = useTableDesignerSelector((s) => s?.view);
    const model = useTableDesignerSelector((s) => s?.model);
    if (!context) {
        return null;
    }
    const components = view?.tabs.find((tab: DesignerTab) => tab.id === tabId)?.components;
    return (
        <div className={classes.root}>
            {components
                ?.filter(
                    (component: DesignerDataPropertyInfo) =>
                        component.componentProperties.enabled === undefined ||
                        component.componentProperties.enabled,
                )
                .map((component: DesignerDataPropertyInfo) => {
                    switch (component.componentType) {
                        case "input": {
                            const modelInputProps = model![
                                component.propertyName
                            ]! as InputBoxProperties;
                            return (
                                <DesignerInputBox
                                    component={component}
                                    model={modelInputProps}
                                    componentPath={[component.propertyName]}
                                    UiArea={"TabsView"}
                                    key={component.propertyName}
                                />
                            );
                        }
                        case "textarea": {
                            const modelTextAreaProps = model![
                                component.propertyName
                            ] as InputBoxProperties;
                            return (
                                <DesignerInputBox
                                    component={component}
                                    model={modelTextAreaProps}
                                    componentPath={[component.propertyName]}
                                    UiArea={"TabsView"}
                                    multiline
                                    autoAdjustHeight
                                    key={component.propertyName}
                                />
                            );
                        }
                        case "dropdown": {
                            const modelProps = model![
                                component.propertyName
                            ] as DropDownProperties;
                            return (
                                <DesignerDropdown
                                    component={component}
                                    model={modelProps}
                                    componentPath={[component.propertyName]}
                                    UiArea={"TabsView"}
                                    key={component.propertyName}
                                />
                            );
                        }
                        case "checkbox": {
                            const modelCheckboxProps = model![
                                component.propertyName
                            ] as CheckBoxProperties;
                            return (
                                <DesignerCheckbox
                                    component={component}
                                    model={modelCheckboxProps}
                                    componentPath={[component.propertyName]}
                                    UiArea={"TabsView"}
                                    key={component.propertyName}
                                />
                            );
                        }
                        case "table": {
                            const modelTableProps = model![
                                component.propertyName
                            ] as DesignerTableProperties;
                            return (
                                <DesignerTable
                                    component={component}
                                    model={modelTableProps}
                                    componentPath={[component.propertyName]}
                                    UiArea={"TabsView"}
                                    key={component.propertyName}
                                />
                            );
                            return null;
                        }
                        default:
                            return null;
                    }
                })}
        </div>
    );
};
