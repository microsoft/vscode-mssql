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
    Divider,
    Spinner,
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
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { scriptUtils } from "../schemaDesignerUtils";

export function PublishChangesDialogButton() {
    const context = useContext(SchemaDesignerContext);
    if (!context) {
        return undefined;
    }

    const [report, setReport] = useState<SchemaDesigner.GetReportResponse | undefined>(undefined);
    const [loading, setLoading] = useState<ApiStatus>(ApiStatus.NotStarted);

    const [selectedReportId, setSelectedReportId] = useState<string>("");

    const [isPublishChangesEnabled, setIsPublishChangesEnabled] = useState<boolean>(false);

    const [reportTab, setReportTab] = useState<string>("report");

    function getReportIcon(state: SchemaDesigner.SchemaDesignerReportTableState) {
        switch (state) {
            case SchemaDesigner.SchemaDesignerReportTableState.Created:
                return <FluentIcons.AddFilled />;
            case SchemaDesigner.SchemaDesignerReportTableState.Dropped:
                return <FluentIcons.SubtractRegular />;
            case SchemaDesigner.SchemaDesignerReportTableState.Updated:
                return <FluentIcons.EditRegular />;
        }
    }

    useEffect(() => {
        context.extensionRpc.subscribe(
            "schemaDesignerStateProvider",
            "isModelReady",
            (payload: unknown) => {
                const typedPayload = payload as {
                    isModelReady: boolean;
                };
                setIsPublishChangesEnabled(typedPayload.isModelReady);
            },
        );
    }, []);

    useEffect(() => {
        if (!report) {
            return;
        }
        if (report?.reports?.length > 0) {
            setSelectedReportId(report.reports[0].tableId);
        } else {
            setSelectedReportId("");
        }
    }, [report]);

    const renderTreeNode = (
        text: string,
        filterTableState: SchemaDesigner.SchemaDesignerReportTableState,
    ) => {
        if (!report) {
            return undefined;
        }
        if (
            report.reports?.filter((report) => report.tableState === filterTableState).length === 0
        ) {
            return undefined;
        }
        return (
            <TreeItem value={text} itemType="branch">
                <TreeItemLayout>{text}</TreeItemLayout>
                <Tree
                    size="small"
                    aria-label="Small Size Tree"
                    defaultOpenItems={["root"]}
                    style={{
                        minWidth: "180px",
                        overflow: "hidden",
                        overflowY: "auto",
                    }}>
                    {report.reports
                        ?.filter((report) => report.tableState === filterTableState)
                        .map((report) => {
                            return (
                                <TreeItem
                                    key={report.tableId}
                                    value={report.tableId}
                                    itemType="leaf"
                                    onClick={() => {
                                        setSelectedReportId(report.tableId);
                                    }}
                                    style={{
                                        backgroundColor:
                                            report.tableId === selectedReportId
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : "",
                                    }}>
                                    <TreeItemLayout iconBefore={getReportIcon(filterTableState)}>
                                        {report.tableName}
                                    </TreeItemLayout>
                                </TreeItem>
                            );
                        })}
                </Tree>
            </TreeItem>
        );
    };

    const getSelectedReportMarkdown = () => {
        if (!report) {
            return "";
        }
        const selectedReport = report.reports?.find(
            (report) => report.tableId === selectedReportId,
        );
        if (selectedReport) {
            const reportMarkdown = `### ${selectedReport.tableName}\n\n`;

            const actions = selectedReport.actionsPerformed?.map((item) => `- ${item}`).join("\n");

            return (
                reportMarkdown + "#### Actions performed\n\n" + (actions ? actions : "") + "\n\n"
            );
        }
        return "";
    };

    return (
        <Dialog>
            <DialogTrigger disableButtonEnhancement>
                <Button
                    size="small"
                    icon={<FluentIcons.DatabaseArrowUp16Filled />}
                    title={locConstants.schemaDesigner.publishChanges}
                    appearance="subtle"
                    disabled={!isPublishChangesEnabled}
                    onClick={async () => {
                        setLoading(ApiStatus.Loading);
                        setReportTab("report");
                        const report = await context.getReport();
                        if (report) {
                            setReport(report);
                        }
                        setLoading(ApiStatus.Loaded);
                    }}>
                    {locConstants.schemaDesigner.publishChanges}
                </Button>
            </DialogTrigger>
            <DialogSurface
                style={{
                    width: "100%",
                    maxWidth: "800px",
                }}>
                <DialogBody>
                    <DialogTitle>Publish changes</DialogTitle>
                    <DialogContent>
                        {loading === ApiStatus.Loading && (
                            <Spinner
                                size="large"
                                style={{
                                    marginBottom: "10px",
                                    marginTop: "10px",
                                }}
                            />
                        )}
                        {loading === ApiStatus.Loaded && report?.reports?.length === 0 && (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    minHeight: "200px",
                                }}>
                                <FluentIcons.BranchFilled
                                    style={{
                                        marginRight: "10px",
                                        width: "50px",
                                        height: "50px",
                                    }}
                                />
                                {locConstants.schemaDesigner.noChangesDetected}
                            </div>
                        )}
                        {loading === ApiStatus.Loaded && report && report?.reports?.length > 0 && (
                            <>
                                <TabList
                                    selectedValue={reportTab}
                                    onTabSelect={(_e, data) => setReportTab(data.value as string)}>
                                    <Tab value={"report"}>
                                        {locConstants.schemaDesigner.details}
                                    </Tab>
                                    <Tab value={"publishScript"}>
                                        {locConstants.schemaDesigner.script}
                                    </Tab>
                                </TabList>
                                <Divider
                                    style={{
                                        marginTop: "10px",
                                        marginBottom: "10px",
                                    }}
                                />
                                {reportTab === "report" && (
                                    <>
                                        <div
                                            style={{
                                                width: "100%",
                                                display: "flex",
                                                flexDirection: "row",
                                                minHeight: "500px",
                                                maxHeight: "500px",
                                                overflow: "hidden",
                                            }}>
                                            <Tree
                                                size="small"
                                                aria-label="Small Size Tree"
                                                defaultOpenItems={[
                                                    "Added Tables",
                                                    "Modified Tables",
                                                    "Dropped Tables",
                                                ]}
                                                style={{
                                                    minWidth: "250px",
                                                    overflow: "hidden",
                                                    overflowY: "auto",
                                                }}>
                                                {renderTreeNode(
                                                    "Added Tables",
                                                    SchemaDesigner.SchemaDesignerReportTableState
                                                        .Created,
                                                )}
                                                {renderTreeNode(
                                                    "Modified Tables",
                                                    SchemaDesigner.SchemaDesignerReportTableState
                                                        .Updated,
                                                )}
                                                {renderTreeNode(
                                                    "Dropped Tables",
                                                    SchemaDesigner.SchemaDesignerReportTableState
                                                        .Dropped,
                                                )}
                                            </Tree>
                                            <Divider
                                                vertical
                                                style={{
                                                    marginLeft: "10px",
                                                    marginRight: "10px",
                                                }}
                                            />
                                            <div
                                                style={{
                                                    width: "100%",
                                                    flexGrow: 1,
                                                    height: "100%",
                                                    overflow: "auto",
                                                }}>
                                                <Markdown>{getSelectedReportMarkdown()}</Markdown>
                                            </div>
                                        </div>
                                    </>
                                )}
                                {reportTab === "publishScript" && (
                                    <Editor
                                        height="500px"
                                        defaultLanguage="sql"
                                        defaultValue={scriptUtils.addWarningToSQLScript(
                                            report?.updateScript ?? "",
                                        )}
                                        theme={resolveVscodeThemeType(context?.themeKind)}
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
                                context.openInEditorWithConnection(
                                    scriptUtils.addWarningToSQLScript(report?.updateScript ?? ""),
                                );
                            }}
                            disabled={report?.updateScript === ""}>
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
