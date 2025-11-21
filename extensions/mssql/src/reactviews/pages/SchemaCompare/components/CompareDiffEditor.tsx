/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useRef, forwardRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { resolveVscodeThemeType } from "../../../common/utils";
import { Divider, makeStyles, tokens } from "@fluentui/react-components";
import { locConstants as loc } from "../../../common/locConstants";
import * as mssql from "vscode-mssql";
import "./compareDiffEditor.css";

const useStyles = makeStyles({
  dividerContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyItems: "center",
    minHeight: "36px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  dividerFont: {
    fontSize: "14px",
    fontWeight: "bold",
  },
  editorContainer: {
    height: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
});

const getAggregatedScript = (
  diff: mssql.DiffEntry,
  getSourceScript: boolean,
): string => {
  let script = "";
  if (diff !== null) {
    let diffScript = getSourceScript
      ? formatScript(diff.sourceScript)
      : formatScript(diff.targetScript);
    if (diffScript) {
      script += diffScript + "\n\n";
    }

    diff.children.forEach((child) => {
      let childScript = getAggregatedScript(child, getSourceScript);
      script += childScript;
    });
  }

  return script;
};

const formatScript = (script: string): string => {
  if (!script) {
    return "";
  }

  return script;
};

interface Props {
  selectedDiffId: number;
  renderSideBySide?: boolean;
}

const CompareDiffEditor = forwardRef<HTMLDivElement, Props>(
  ({ selectedDiffId, renderSideBySide }, ref) => {
    const classes = useStyles();
    const context = useContext(schemaCompareContext);
    const compareResult = context.state.schemaCompareResult;
    const diff = compareResult?.differences[selectedDiffId];
    const editorRef = useRef<any>(null);

    const original = diff?.sourceScript ? getAggregatedScript(diff, true) : "";
    const modified = diff?.targetScript ? getAggregatedScript(diff, false) : "";

    // Handle editor mount to store the reference
    const handleEditorDidMount = (editor: any) => {
      editorRef.current = editor;
    };

    // Update the editor layout when the container size changes
    useEffect(() => {
      const handleResize = () => {
        if (editorRef.current) {
          editorRef.current.layout();
        }
      };

      window.addEventListener("resize", handleResize);

      // Clean up event listener on component unmount
      return () => {
        window.removeEventListener("resize", handleResize);
      };
    }, []);

    return (
      <div ref={ref} className={classes.editorContainer}>
        <div className={classes.dividerContainer}>
          <Divider className={classes.dividerFont} alignContent="start">
            {loc.schemaCompare.compareDetails}
          </Divider>
        </div>
        <DiffEditor
          height="100%"
          language="sql"
          original={modified}
          modified={original}
          theme={resolveVscodeThemeType(context.themeKind)}
          options={{
            renderSideBySide: renderSideBySide ?? true,
            renderOverviewRuler: true,
            OverviewRulerLane: 0,
            readOnly: true,
          }}
          onMount={handleEditorDidMount}
        />
      </div>
    );
  },
);

export default CompareDiffEditor;
