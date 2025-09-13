/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useContext } from "react";
import {
    CheckBoxProperties,
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
    const state = context?.state;
    if (!state) {
        return null;
    }
    const components = state.view?.tabs.find((tab) => tab.id === tabId)?.components;
    return (
        <div className={classes.root}>
            {components
                ?.filter(
                    (component) =>
                        component.componentProperties.enabled === undefined ||
                        component.componentProperties.enabled,
                )
                .map((component) => {
                    switch (component.componentType) {
                        case "input": {
                            const modelInputProps = state.model![
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
                            const modelTextAreaProps = state.model![
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
                            const modelProps = state.model![
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
                            const modelCheckboxProps = state.model![
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
                            const modelTableProps = state.model![
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
