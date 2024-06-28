/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands } from "@fluentui/react-components";
import { TableDesignerContext } from "./TableDesignerStateProvider";
import { useContext } from "react";
import { CheckBoxProperties, DesignerTableProperties, DropDownProperties, InputBoxProperties } from "./tableDesignerInterfaces";
import { DesignerCheckbox } from "./DesignerCheckbox";
import { DesignerInputBox } from "./DesignerInputBox";
import { DesignerDropdown } from "./DesignerDropdown";
import { DesignerTable2 } from "./DesginerTable";

export interface DesignerMainPaneTabProps {
    tabId: string;
}

const useStyles = makeStyles({
    root: {
        width: '100%',
        height: '100%',
        overflowX: 'auto',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '10px',
        paddingLeft: '10px',
        ...shorthands.gap('10px'),
    },
});

export const DesignerMainPaneTab = ({ tabId }: DesignerMainPaneTabProps) => {
    const classes = useStyles();
    const state = useContext(TableDesignerContext);
    const metadata = state?.state;
	if(!metadata) {
		return null;
	}
    const components = metadata.view?.tabs.find(tab => tab.id === tabId)?.components;
    return <div className={classes.root}>
        {
            components?.filter(component => component.componentProperties.enabled === undefined || component.componentProperties.enabled).map(component => {
                switch (component.componentType) {
                    case 'input': {
						const modelInputProps = (metadata.model![component.propertyName]! as InputBoxProperties);
                        return <DesignerInputBox
                            component={component}
                            model={modelInputProps}
                            componentPath={[component.propertyName]}
                            UiArea={'TabsView'}
                        />;
					}
                    case 'textarea': {
						const modelTextAreaProps = (metadata.model![component.propertyName] as InputBoxProperties);
                        return <DesignerInputBox
                            component={component}
                            model={modelTextAreaProps}
                            componentPath={[component.propertyName]}
                            UiArea={'TabsView'}
                            multiline
                            autoAdjustHeight
                        />;
					}
                    case 'dropdown': {
						const modelProps = (metadata.model![component.propertyName] as DropDownProperties);
                        return <DesignerDropdown
                            component={component}
                            model={modelProps}
                            componentPath={[component.propertyName]}
                            UiArea={'TabsView'}
                        />;
					}
                    case 'checkbox': {
						const modelCheckboxProps = (metadata.model![component.propertyName] as CheckBoxProperties);
                        return <DesignerCheckbox
                            component={component}
                            model={modelCheckboxProps}
                            componentPath={[component.propertyName]}
                            UiArea={'TabsView'}
                        />;
					}
                    case 'table': {
						const modelTableProps = (metadata.model![component.propertyName] as DesignerTableProperties);
                        return <DesignerTable2
                            component={component}
                            model={modelTableProps}
                            componentPath={[component.propertyName]}
                            UiArea={'TabsView'}
                        />;
						return null;
					}
                    default:
                        return null;
                }
            })
        }
    </div>
}