/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useRef } from "react";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import "./schemaDesigner.css";
import { SchemaDesignerToolbar } from "./toolbar/schemaDesignerToolbar";
import { SchemaDesignerEditorDrawer } from "./editor/schemaDesignerEditorDrawer";
import { SchemaDesignerDefinitionsPanel } from "./schemaDesignerDefinitionsPanel";
import { SchemaDesignerFlow } from "./graph/SchemaDiagramFlow";
import { SchemaDesignerFindTableWidget } from "./schemaDesignerFindTables";
import { makeStyles, Spinner } from "@fluentui/react-components";
import { locConstants } from "../../common/locConstants";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

const useStyles = makeStyles({
  resizeHandle: {
    height: "2px",
    backgroundColor: "var(--vscode-editorWidget-border)",
  },
});
export const SchemaDesignerPage = () => {
  const context = useContext(SchemaDesignerContext);
  const classes = useStyles();

  if (!context) {
    return undefined;
  }

  return (
    <>
      <SchemaDesignerEditorDrawer />
      <MainLayout>
        <PanelGroup direction="vertical">
          <Panel defaultSize={100}>
            <GraphContainer>
              <SchemaDesignerToolbar />
              <SchemaDesignerFlow />
            </GraphContainer>
          </Panel>
          <PanelResizeHandle className={classes.resizeHandle} />
          <SchemaDesignerDefinitionsPanel />
        </PanelGroup>
        {!context.isInitialized && <LoadingOverlay />}
      </MainLayout>
    </>
  );
};

// Layout components for better organization
const MainLayout = ({ children }: { children: React.ReactNode }) => {
  const divRef = useRef<HTMLDivElement>(null);
  return (
    <div
      tabIndex={0}
      ref={divRef}
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
      }}
    >
      <SchemaDesignerFindTableWidget parentRef={divRef} />
      {children}
    </div>
  );
};

const GraphContainer = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      flex: 1,
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      position: "relative",
    }}
  >
    {children}
  </div>
);

const LoadingOverlay = () => (
  <div
    style={{
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.4)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <Spinner
      label={locConstants.schemaDesigner.loadingSchemaDesigner}
      labelPosition="below"
    />
  </div>
);
