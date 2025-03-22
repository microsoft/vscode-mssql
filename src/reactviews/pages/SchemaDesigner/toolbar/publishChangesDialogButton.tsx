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
import { addWarningToSQLScript } from "../schemaDesignerUtils";

export function PublishChangesDialogButton() {
    const context = useContext(SchemaDesignerContext);

    const [selectedReportId, setSelectedReportId] = useState<string>("");

    function getReportIcon(
        state: SchemaDesigner.SchemaDesignerReportTableState,
    ) {
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
        if (context?.report?.reports?.length > 0) {
            setSelectedReportId(context.report.reports[0].tableId);
        } else {
            setSelectedReportId("");
        }
    }, [context.report]);

    const renderTreeNode = (
        text: string,
        filterTableState: SchemaDesigner.SchemaDesignerReportTableState,
    ) => {
        if (
            context.report.reports?.filter(
                (report) => report.tableState === filterTableState,
            ).length === 0
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
                    }}
                >
                    {context.report.reports
                        ?.filter(
                            (report) => report.tableState === filterTableState,
                        )
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
                                    }}
                                >
                                    <TreeItemLayout
                                        iconBefore={getReportIcon(
                                            filterTableState,
                                        )}
                                    >
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
        const selectedReport = context.report.reports?.find(
            (report) => report.tableId === selectedReportId,
        );
        if (selectedReport) {
            const reportMarkdown = `### ${selectedReport.tableName}\n\n`;

            const actions = selectedReport.actionsPerformed
                ?.map((item) => `- ${item}`)
                .join("\n");

            return (
                reportMarkdown +
                "#### Actions performed\n\n" +
                (actions ? actions : "") +
                "\n\n"
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
                    disabled={context.isPublishChangesEnabled === false}
                    onClick={() => {
                        context.getReport();
                        context.setSelectedReportTab("report");
                    }}
                >
                    {locConstants.schemaDesigner.publishChanges}
                </Button>
            </DialogTrigger>
            <DialogSurface
                style={{
                    width: "100%",
                    maxWidth: "800px",
                }}
            >
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
                                                defaultOpenItems={[
                                                    "Added Tables",
                                                    "Modified Tables",
                                                    "Dropped Tables",
                                                ]}
                                                style={{
                                                    minWidth: "250px",
                                                    overflow: "hidden",
                                                    overflowY: "auto",
                                                }}
                                            >
                                                {renderTreeNode(
                                                    "Added Tables",
                                                    SchemaDesigner
                                                        .SchemaDesignerReportTableState
                                                        .Created,
                                                )}
                                                {renderTreeNode(
                                                    "Modified Tables",
                                                    SchemaDesigner
                                                        .SchemaDesignerReportTableState
                                                        .Updated,
                                                )}
                                                {renderTreeNode(
                                                    "Dropped Tables",
                                                    SchemaDesigner
                                                        .SchemaDesignerReportTableState
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
                                                }}
                                            >
                                                <Markdown>
                                                    {getSelectedReportMarkdown()}
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
                                        defaultValue={addWarningToSQLScript(
                                            context.report.updateScript,
                                        )}
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
                                context.openInEditorWithConnection(
                                    addWarningToSQLScript(
                                        context.report.updateScript,
                                    ),
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
