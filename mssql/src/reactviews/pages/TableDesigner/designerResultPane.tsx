/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DesignerIssue,
    DesignerResultPaneTabs,
    InputBoxProperties,
    TableProperties,
} from "../../../sharedInterfaces/tableDesigner";

import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useContext, useEffect, useState } from "react";
import {
    DesignerDefinitionPane,
    DesignerDefinitionTabs,
} from "../../common/designerDefinitionPane";

export const DesignerResultPane = () => {
    const context = useContext(TableDesignerContext);
    const state = context?.state;

    if (!state) {
        return undefined;
    }

    const openAndFocusIssueComponent = async (issue: DesignerIssue) => {
        const issuePath = issue.propertyPath ?? [];
        context?.log(`focusing on ${issuePath}`);

        if (!state?.view?.tabs) {
            return;
        }
        const containingTab = state.view.tabs.find((tab) => {
            return tab.components.find((c) => {
                return c.propertyName === issuePath[0];
            });
        });

        if (!containingTab) {
            return;
        } else {
            context.setTab(containingTab.id as any);
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
            tableModel = state.model![tableComponent.propertyName];
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
                elementToFocus =
                    context.elementRefs.current[context.getComponentId(issuePath as any)];
                break;
            case 2: // This is table row. Therefore focuing on the first property of the row
                if (!tableComponent) {
                    return;
                }
                const firstProperty = (tableComponent.componentProperties as TableProperties)
                    .itemProperties[0].propertyName;
                elementToFocus =
                    context.elementRefs.current[
                        context.getComponentId([...issuePath, firstProperty] as any)
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
                        context.getComponentId([...issuePath, firstPropertyInSubTable] as any)
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

    const [definitionTab, setDefinitionTab] = useState<DesignerDefinitionTabs>(
        DesignerDefinitionTabs.Script,
    );

    useEffect(() => {
        setDefinitionTab(
            state.tabStates!.resultPaneTab === DesignerResultPaneTabs.Script
                ? DesignerDefinitionTabs.Script
                : DesignerDefinitionTabs.Issues,
        );
    }, [state.tabStates!.resultPaneTab]);

    return (
        <DesignerDefinitionPane
            ref={context?.definitionPaneRef}
            copyToClipboard={context?.copyScriptAsCreateToClipboard}
            themeKind={context?.themeKind}
            openInEditor={context?.scriptAsCreate}
            script={(state?.model!["script"] as InputBoxProperties).value ?? ""}
            issues={state?.issues}
            activeTab={definitionTab}
            setActiveTab={setDefinitionTab}
            onIssueClick={openAndFocusIssueComponent}
        />
    );
};
