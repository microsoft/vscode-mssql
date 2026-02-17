/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    DesignerResultPaneTabs,
    InputBoxProperties,
    TableDesignerReducers,
    TableDesignerWebviewState,
} from "../../../sharedInterfaces/tableDesigner";

import { TableDesignerContext } from "./tableDesignerStateProvider";
import { useTableDesignerSelector } from "./tableDesignerSelector";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import { useContext, useEffect, useState } from "react";
import {
    DefinitionPanel,
    DefinitionTabIdentifier,
    DesignerDefinitionTabs,
} from "../../common/definitionPanel";
import { createDesignerIssuesTab, ISSUES_TAB_ID } from "./designerIssuesTab";

export const DesignerResultPane = () => {
    const context = useContext(TableDesignerContext);
    const model = useTableDesignerSelector((s) => s?.model);
    const tabStates = useTableDesignerSelector((s) => s?.tabStates);
    const issues = useTableDesignerSelector((s) => s?.issues);
    const { themeKind } = useVscodeWebview<TableDesignerWebviewState, TableDesignerReducers>();

    if (!context) {
        return undefined;
    }

    const [definitionTab, setDefinitionTab] = useState<
        DefinitionTabIdentifier<typeof ISSUES_TAB_ID>
    >(DesignerDefinitionTabs.Script);

    useEffect(() => {
        setDefinitionTab(
            tabStates!.resultPaneTab === DesignerResultPaneTabs.Script
                ? DesignerDefinitionTabs.Script
                : ISSUES_TAB_ID,
        );
    }, [tabStates!.resultPaneTab]);

    const issuesTab = createDesignerIssuesTab(issues ?? []);

    return (
        <DefinitionPanel
            ref={context?.definitionPaneRef}
            scriptTab={{
                value: (model!["script"] as InputBoxProperties).value ?? "",
                language: "sql",
                themeKind,
                openInEditor: context?.scriptAsCreate,
                copyToClipboard: context?.copyScriptAsCreateToClipboard,
            }}
            customTabs={issues && issues.length > 0 ? [issuesTab] : []}
            activeTab={definitionTab}
            setActiveTab={setDefinitionTab}
        />
    );
};
