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

export function PublishChangesDialogButton() {
    const context = useContext(SchemaDesignerContext);

    const [selectedReport, setSelectedReport] = useState<number>(-1);
    function getTableDisplayNameForReport(
        report: SchemaDesigner.SchemaDesignerReport,
    ) {
        const table = context.schema.tables.find(
            (table) => table.id === report.tableId,
        );
        if (table) {
            return `${table.schema}.${table.name}`;
        }
        return "";
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
                    }}
                >
                    {locConstants.schemaDesigner.publishChanges}
                </Button>
            </DialogTrigger>
            <DialogSurface>
                <DialogBody>
                    <DialogTitle>Publish changes</DialogTitle>
                    <DialogContent>
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
                                <TreeItem itemType="branch" value={"root"}>
                                    <TreeItemLayout>
                                        {
                                            locConstants.schemaDesigner
                                                .changedTables
                                        }
                                    </TreeItemLayout>
                                    <Tree>
                                        {context.report.reports?.map(
                                            (report, index) => {
                                                return (
                                                    <TreeItem
                                                        key={getTableDisplayNameForReport(
                                                            report,
                                                        )}
                                                        itemType="leaf"
                                                        onClick={() => {
                                                            setSelectedReport(
                                                                index,
                                                            );
                                                        }}
                                                    >
                                                        <TreeItemLayout>
                                                            {getTableDisplayNameForReport(
                                                                report,
                                                            )}
                                                        </TreeItemLayout>
                                                    </TreeItem>
                                                );
                                            },
                                        )}
                                    </Tree>
                                </TreeItem>
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
                                          ]?.actionsPerformed.join(" \n")
                                        : ""}
                                </Markdown>
                            </div>
                        </div>
                    </DialogContent>
                    <DialogActions>
                        <Button appearance="primary">Publish</Button>
                        <Button appearance="secondary">Script</Button>
                        <DialogTrigger disableButtonEnhancement>
                            <Button appearance="secondary">Close</Button>
                        </DialogTrigger>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
}
