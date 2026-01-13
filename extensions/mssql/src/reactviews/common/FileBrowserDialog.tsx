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
    Dropdown,
    makeStyles,
    Input,
    Option,
    Spinner,
    Text,
    Tree,
    TreeItem,
    TreeItemLayout,
    Label,
} from "@fluentui/react-components";
import { locConstants as Loc } from "./locConstants";
import { KeyCode } from "./keys";
import {
    FileBrowserProvider,
    FileTree,
    FileTreeNode,
    FileTypeOption,
} from "../../sharedInterfaces/fileBrowser";
import { useState } from "react";

const useStyles = makeStyles({
    titleDiv: {
        display: "flex",
        flexDirection: "row",
        paddingLeft: "20px",
    },
    titleText: {
        marginLeft: "8px",
        fontSize: "20px",
        fontWeight: 600,
    },
    contentDiv: {
        display: "flex",
        flexDirection: "column",
        padding: "15px",
        height: "fit-content",
        marginBottom: "10px",
        paddingBottom: "10px",
    },
    contentItem: {
        padding: "10px",
    },
    treeDiv: {
        height: "500px",
        minHeight: "250px",
        overflowY: "scroll",
        marginBottom: "15px",
    },
    formRow: {
        display: "grid",
        gridTemplateColumns: "160px 1fr",
        columnGap: "8px",
        padding: "10px",
    },
});

export const FileBrowserDialog = ({
    ownerUri,
    defaultFilePath,
    fileTree,
    provider,
    fileTypeOptions,
    closeDialog,
    showFoldersOnly,
}: {
    ownerUri: string;
    defaultFilePath: string;
    fileTree: FileTree;
    provider: FileBrowserProvider;
    fileTypeOptions: FileTypeOption[];
    closeDialog: () => void;
    showFoldersOnly: boolean;
}) => {
    const classes = useStyles();

    const [selectedPath, setSelectedPath] = useState<string>(defaultFilePath);

    // get default expanded nodes for Tree component by spltting defaultFilePath
    const getDefaultExpandedNodes = (): string[] => {
        if (!defaultFilePath) return [];

        const expandedNodes: string[] = ["/"];

        const parts = defaultFilePath.split("/").filter(Boolean);

        let currentPath = defaultFilePath.startsWith("/") ? "/" : "";

        for (const part of parts) {
            currentPath = currentPath === "/" ? `/${part}` : `${currentPath}/${part}`;
            expandedNodes.push(currentPath);
        }

        return expandedNodes;
    };

    const defaultExpandedNodes = getDefaultExpandedNodes();
    const [openItems, setOpenItems] = useState<string[]>(defaultExpandedNodes);

    const handleExpandNode = async (node: FileTreeNode) => {
        await provider.expandNode(ownerUri, node.fullPath);
    };

    const handleNodeClick = (node: FileTreeNode) => {
        setSelectedPath(node.fullPath);
    };

    const handleFilterChange = (selectedFilter: string) => {
        const filterOption = fileTypeOptions.find(
            (option) => option.displayName === selectedFilter,
        );
        if (!filterOption) return;

        provider.openFileBrowser(
            ownerUri,
            defaultFilePath,
            filterOption.value,
            true,
            showFoldersOnly,
        );

        // reset expanded nodes to default in tree
        setOpenItems(defaultExpandedNodes);
        setSelectedPath(defaultFilePath);
    };

    const handleSubmit = async () => {
        await provider.submitFilePath(selectedPath);
        await handleDialogClose();
    };

    const handleDialogClose = async () => {
        await provider.closeFileBrowser(ownerUri);
        closeDialog();
    };

    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === KeyCode.Escape) {
                        closeDialog();
                    }
                }}>
                <DialogBody>
                    <DialogTitle className={classes.titleDiv}>
                        <Text className={classes.titleText}>
                            {Loc.fileBrowser.fileBrowserTitle}
                        </Text>
                    </DialogTitle>
                    <DialogContent className={classes.contentDiv}>
                        <Tree
                            className={classes.treeDiv}
                            openItems={openItems}
                            onOpenChange={(_e, data) => {
                                const openItemValues = Array.from(data.openItems, (item) =>
                                    item.toString(),
                                );
                                setOpenItems(openItemValues);
                            }}>
                            {renderTreeItem(
                                fileTree.rootNode.children[0],
                                handleExpandNode,
                                handleNodeClick,
                            )}
                        </Tree>
                        <div className={classes.formRow}>
                            <Label>{Loc.fileBrowser.selectedPath}</Label>
                            <Input
                                value={selectedPath}
                                onChange={(_event, data) => {
                                    setSelectedPath(data.value);
                                }}
                            />
                        </div>
                        {!showFoldersOnly && ( // only show file filter if showing files instead of just folders
                            <div className={classes.formRow}>
                                <Label>{Loc.fileBrowser.filesOfType}</Label>
                                <Dropdown
                                    defaultValue={fileTypeOptions[0].displayName}
                                    onOptionSelect={(_event, data) => {
                                        handleFilterChange(data.optionValue as string);
                                    }}>
                                    {fileTypeOptions.map((option) => (
                                        <Option key={option.displayName} text={option.displayName}>
                                            {option.displayName}
                                        </Option>
                                    ))}
                                </Dropdown>
                            </div>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button
                            appearance="primary"
                            onClick={async () => {
                                await handleSubmit();
                            }}>
                            {Loc.common.select}
                        </Button>
                        <Button
                            appearance="secondary"
                            onClick={async () => {
                                await handleDialogClose();
                            }}>
                            {Loc.common.cancel}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

function renderTreeItem(
    node: FileTreeNode,
    onNodeExpand: (node: FileTreeNode) => void,
    onNodeClick: (node: FileTreeNode) => void,
): JSX.Element {
    const isBranch = !node.isFile; // folders are branches
    const hasChildren = node.children && node.children.length > 0;

    return (
        <TreeItem
            value={node.fullPath}
            itemType={isBranch ? "branch" : "leaf"}
            data-node={node}
            onOpenChange={(_event, data) => {
                const isOpening = data.open;

                if (isBranch && isOpening && !node.isExpanded) {
                    onNodeExpand(node);
                }
            }}
            onClick={() => {
                onNodeClick(node);
            }}>
            <TreeItemLayout>{node.name}</TreeItemLayout>

            {isBranch && (
                <Tree>
                    {hasChildren ? (
                        node.children.map((child) =>
                            renderTreeItem(child, onNodeExpand, onNodeClick),
                        )
                    ) : !node.isExpanded ? (
                        // show loading only while expanding
                        <TreeItem
                            value={`${node.fullPath}_loadingChildren`}
                            itemType="leaf"
                            data-node={node}>
                            <TreeItemLayout>
                                <div
                                    style={{
                                        display: "flex",
                                        flexDirection: "row",
                                        gap: "5px",
                                    }}>
                                    <Spinner size="extra-tiny" />
                                    {`${Loc.common.loading}...`}
                                </div>
                            </TreeItemLayout>
                        </TreeItem>
                    ) : null}
                </Tree>
            )}
        </TreeItem>
    );
}
