/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    DialogTrigger,
    Tab,
    TabList,
    Tree,
    TreeItem,
    TreeItemLayout,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { locConstants } from "../../../common/locConstants";
import { SchemaDesignerContext } from "../schemaDesignerStateProvider";
import { useContext, useEffect, useState } from "react";
import Markdown from "react-markdown";
import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";
import { Editor } from "@monaco-editor/react";
import { resolveVscodeThemeType } from "../../../common/utils";

export function PublishChangesDialogButton() {
    const context = useContext(SchemaDesignerContext);

    const [selectedReport, setSelectedReport] = useState<number>(-1);

    function getReportIcon(report: SchemaDesigner.SchemaDesignerReport) {
        switch (report.tableState) {
            case SchemaDesigner.SchemaDesignerReportTableState.Created:
                return <FluentIcons.AddFilled />;
            case SchemaDesigner.SchemaDesignerReportTableState.Dropped:
                return <FluentIcons.SubtractRegular />;
            case SchemaDesigner.SchemaDesignerReportTableState.Updated:
                return <FluentIcons.EditRegular />;
        }
    }

    useEffect(() => {
        if (context?.report?.reports?.length > 0) {
            setSelectedReport(0);
        } else {
            setSelectedReport(-1);
        }
    }, [context.report]);

    return (
        <Dialog>
            <DialogTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    icon={<FluentIcons.DatabaseArrowUp16Filled />}
                    title={locConstants.schemaDesigner.publishChanges}
                    appearance="subtle"
                    disabled={context.isPublishChangesEnabled === false}
                    onClick={() => {
                        context.getReport();
                        context.setSelectedReportTab("report");
                    }}
                >
                    {locConstants.schemaDesigner.publishChanges}
                </Button>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Publish changes</DialogTitle>
                    <DialogContent>
                        {context.report.reports?.length === 0 && (
                            <div>No changes detected</div>
                        )}
                        {context.report.reports?.length > 0 && (
                            <>
                                <TabList
                                    selectedValue={context.selectedReportTab}
                                    onTabSelect={(_e, data) =>
                                        context.setSelectedReportTab(
                                            data.value as string,
                                        )
                                    }
                                >
                                    <Tab value={"report"}>Report</Tab>
                                    <Tab value={"publishScript"}>
                                        Publish Script
                                    </Tab>
                                </TabList>
                                {context.selectedReportTab === "report" && (
                                    <>
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                flexDirection: "row",
                                                minHeight: "500px",
                                                maxHeight: "500px",
                                                overflow: "hidden",
                                            }}
                                        >
                                            <Tree
                                                size="small"
                                                aria-label="Small Size Tree"
                                                defaultOpenItems={["root"]}
                                                style={{
                                                    minWidth: "180px",
                                                    overflow: "hidden",
                                                    overflowY: "auto",
                                                }}
                                            >
                                                {context.report.reports?.map(
                                                    (report, index) => {
                                                        return (
                                                            <TreeItem
                                                                key={
                                                                    report.tableId
                                                                }
                                                                value={
                                                                    report.tableId
                                                                }
                                                                itemType="leaf"
                                                                onClick={() => {
                                                                    setSelectedReport(
                                                                        index,
                                                                    );
                                                                }}
                                                                style={{
                                                                    backgroundColor:
                                                                        index ===
                                                                        selectedReport
                                                                            ? "var(--vscode-list-activeSelectionBackground)"
                                                                            : "",
                                                                }}
                                                            >
                                                                <TreeItemLayout
                                                                    iconBefore={getReportIcon(
                                                                        report,
                                                                    )}
                                                                >
                                                                    {
                                                                        report.tableName
                                                                    }
                                                                </TreeItemLayout>
                                                            </TreeItem>
                                                        );
                                                    },
                                                )}
                                            </Tree>
                                            <div
                                                style={{
                                                    width: "100%",
                                                    flexGrow: 1,
                                                    height: "100%",
                                                    overflow: "auto",
                                                }}
                                            >
                                                <Markdown>
                                                    {}
                                                    {selectedReport !== -1
                                                        ? context.report.reports[
                                                              selectedReport
                                                          ]?.actionsPerformed
                                                              .map(
                                                                  (item) =>
                                                                      `- ${item}`,
                                                              )
                                                              .join("\n")
                                                        : ""}
                                                </Markdown>
                                            </div>
                                        </div>
                                    </>
                                )}
                                {context.selectedReportTab ===
                                    "publishScript" && (
                                    <Editor
                                        height="500px"
                                        defaultLanguage="sql"
                                        defaultValue={
                                            context.report.updateScript
                                        }
                                        theme={resolveVscodeThemeType(
                                            context?.themeKind,
                                        )}
                                        options={{
                                            readOnly: true,
                                            minimap: { enabled: false },
                                            wordWrap: "on",
                                        }}
                                    />
                                )}
                            </>
                        )}
                    </DialogContent>
                    <DialogActions>
                        {/* <Button appearance="primary">Publish</Button> */}
                        <Button
                            appearance="secondary"
                            onClick={() => {
                                context.openInEditor(
                                    context.report.updateScript,
                                );
                            }}
                            disabled={context.report.updateScript === ""}
                        >
                            Open Publish Script
                        </Button>
                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="secondary">Close</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
