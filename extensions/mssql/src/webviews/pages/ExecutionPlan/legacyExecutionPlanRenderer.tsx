/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azdataGraph from "azdataGraph";
import { useEffect, useRef } from "react";
import { ExecutionPlanNode } from "../../../sharedInterfaces/executionPlan";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { ExecutionPlanGraphController } from "./executionPlanGraphController";
import { ExecutionPlanView } from "./executionPlanView";
import * as utils from "./queryPlanSetup";

interface LegacyExecutionPlanRendererProps {
    root: ExecutionPlanNode;
    themeKind: ColorThemeKind;
    className?: string;
    onReady: (controller: ExecutionPlanGraphController | null) => void;
}

export function LegacyExecutionPlanRenderer({
    root,
    themeKind,
    className,
    onReady,
}: LegacyExecutionPlanRendererProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) {
            return;
        }

        const mxWindow = window as typeof window & {
            mxLoadResources?: boolean;
            mxForceIncludes?: boolean;
            mxResourceExtension?: string;
            mxLoadStylesheets?: boolean;
            mxBasePath?: string;
        };
        mxWindow.mxLoadResources = false;
        mxWindow.mxForceIncludes = false;
        mxWindow.mxResourceExtension = ".txt";
        mxWindow.mxLoadStylesheets = false;
        mxWindow.mxBasePath = "./src/webviews/pages/ExecutionPlan/mxgraph";

        const mxClient = azdataGraph.mx();
        const executionPlanView = new ExecutionPlanView(root);
        const executionPlanGraph = executionPlanView.populate();
        const pen = new mxClient.azdataQueryPlan({
            container: containerRef.current,
            queryPlanGraph: executionPlanGraph,
            iconPaths: utils.getIconPaths(),
            badgeIconPaths: utils.getBadgePaths(),
            expandCollapsePaths: utils.getCollapseExpandPaths(themeKind),
            // Keep the fallback's original azdataGraph tooltip implementation.
            showTooltipOnClick: true,
        });
        pen.setTextFontColor("var(--vscode-editor-foreground)");
        pen.setEdgeColor("var(--vscode-editor-foreground)");
        executionPlanView.setDiagram(pen);
        onReady(executionPlanView);

        return () => {
            onReady(null);
            const disposablePen = pen as unknown as { destroy?: () => void };
            disposablePen.destroy?.();
        };
    }, [onReady, root, themeKind]);

    return <div ref={containerRef} className={className} />;
}
