/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import "azdataGraph/dist/index.css";
import "azdataGraph/src/css/common.css";
import "azdataGraph/src/css/explorer.css";
import "./schemaDesigner.css";
import { SchemaDesignerToolbar } from "./toolbar/schemaDesignerToolbar";
import { SchemaDiagramZoomControls } from "./schemaDiagramZoomControls";
import { SchemaDesignerEditorDrawer } from "./editor/schemaDesignerEditorDrawer";
import { SchemaDesignerCodeDrawer } from "./schemaDesignerCodeDrawer";
import { SchemaDiagramGraph } from "./schemaDesignerGraph";

export const SchemaDesignerPage = () => {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return null;
    }

    return (
        <>
            <SchemaDesignerEditorDrawer />
            <MainLayout>
                <GraphContainer>
                    <SchemaDesignerToolbar />
                    <SchemaDiagramGraph />
                    <SchemaDiagramZoomControls />
                </GraphContainer>
                <SchemaDesignerCodeDrawer />
            </MainLayout>
        </>
    );
};

// Layout components for better organization
const MainLayout = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            height: "100%",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
        }}
    >
        {children}
    </div>
);

const GraphContainer = ({ children }: { children: React.ReactNode }) => (
    <div
        style={{
            maxHeight: "100%",
            minHeight: "60%",
            flex: 1,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
        }}
    >
        {children}
    </div>
);
