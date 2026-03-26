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
    Field,
} from "@fluentui/react-components";
import { DocumentRegular, FolderRegular } from "@fluentui/react-icons";
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
        alignItems: "center",
        padding: "18px 20px 12px",
        borderBottom: "1px solid var(--vscode-widget-border)",
    },
    dialogSurfaceDiv: {
        width: "min(560px, 94vw)",
        display: "flex",
        borderRadius: "6px",
        border: "1px solid var(--vscode-widget-border)",
        backgroundColor: "var(--vscode-editorWidget-background)",
    },
    dialogBodyDiv: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
    },
    titleText: {
        fontSize: "14px",
        fontWeight: 600,
        color: "var(--vscode-editor-foreground)",
    },
    contentDiv: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflow: "hidden",
        padding: "8px 20px 12px",
        width: "100%",
    },
    treeDiv: {
        minHeight: "340px",
        height: "340px",
        maxHeight: "340px",
        overflowY: "auto",
        paddingTop: "4px",
        paddingBottom: "4px",
    },
    formRow: {
        display: "grid",
        gridTemplateColumns: "110px 1fr",
        columnGap: "8px",
        alignItems: "start",
    },
    label: {
        fontSize: "12px",
        color: "var(--vscode-descriptionForeground)",
        paddingTop: "6px",
    },
    fieldControl: {
        "& .fui-Input, & .fui-Dropdown": {
            backgroundColor: "var(--vscode-input-background)",
            color: "var(--vscode-input-foreground)",
        },
    },
    actionsDiv: {
        borderTop: "1px solid var(--vscode-widget-border)",
        padding: "10px 20px 14px",
        justifyContent: "flex-start",
        gap: "8px",
    },
    loadingRow: {
        display: "flex",
        flexDirection: "row",
        gap: "5px",
    },
});

type FileBrowserDialogClasses = ReturnType<typeof useStyles>;

type FileSelectionInfo = {
    fullPath: string;
    isFile: boolean;
};

export const FileBrowserDialog = ({
    ownerUri,
    defaultFileBrowserExpandPath,
    fileTree,
    provider,
    fileTypeOptions,
    closeDialog,
    showFoldersOnly,
    propertyName,
    defaultSelectedPath,
}: {
    ownerUri: string;
    defaultFileBrowserExpandPath: string;
    fileTree: FileTree;
    provider: FileBrowserProvider;
    fileTypeOptions: FileTypeOption[];
    closeDialog: () => void;
    showFoldersOnly: boolean;
    propertyName?: string;
    defaultSelectedPath?: string;
}) => {
    const classes = useStyles();

    const [selectedFileInfo, setSelectedFileInfo] = useState<FileSelectionInfo>({
        fullPath: defaultSelectedPath || "",
        isFile: !showFoldersOnly, // if we're showing folders only, default selection is not a file
    });

    // get default expanded nodes for Tree component by splitting defaultFilePath
    const getDefaultExpandedNodes = (): string[] => {
        if (!defaultFileBrowserExpandPath) return [];

        const expandedNodes: string[] = ["/"];

        const parts = defaultFileBrowserExpandPath.split("/").filter(Boolean);

        let currentPath = defaultFileBrowserExpandPath.startsWith("/") ? "/" : "";

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
        setSelectedFileInfo({
            fullPath: node.fullPath,
            isFile: node.isFile,
        });
    };

    const handleNodeDoubleClick = async (node: FileTreeNode) => {
        handleNodeClick(node);
        await handleSubmit(node);
    };

    const handleFilterChange = (selectedFilter: string) => {
        const filterOption = fileTypeOptions.find(
            (option) => option.displayName === selectedFilter,
        );
        if (!filterOption) return;

        provider.openFileBrowser(
            ownerUri,
            defaultFileBrowserExpandPath,
            filterOption.value,
            true,
            showFoldersOnly,
        );

        // reset expanded nodes to default in tree
        setOpenItems(defaultExpandedNodes);
        setSelectedFileInfo({
            fullPath: "",
            isFile: !showFoldersOnly,
        });
    };

    const handleSubmit = async (node?: FileTreeNode) => {
        if (selectedNodeValidationMessage() !== "") {
            // if the user tries to submit an invalid selection, do nothing
            return;
        }
        const path = node ? node.fullPath : selectedFileInfo.fullPath;
        await provider.submitFilePath(path, propertyName);
        await handleDialogClose();
    };

    const handleDialogClose = async () => {
        await provider.closeFileBrowser(ownerUri);
        closeDialog();
    };

    const selectedNodeValidationMessage = (): string => {
        if (!selectedFileInfo.fullPath) {
            if (showFoldersOnly) {
                return Loc.fileBrowser.folderRequired;
            }
            return Loc.fileBrowser.fileRequired;
        }
        // if we need a file input, validate the selected node is a file
        if (!showFoldersOnly && !selectedFileInfo.isFile) {
            return Loc.fileBrowser.pleaseSelectAFile;
        }
        return "";
    };

    return (
        <Dialog open={true /* standalone dialog always open*/}>
            <DialogSurface
                className={classes.dialogSurfaceDiv}
                onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === KeyCode.Escape) {
                        closeDialog();
                    }
                }}>
                <DialogBody className={classes.dialogBodyDiv}>
                    <DialogTitle className={classes.titleDiv}>
                        <Text className={classes.titleText}>
                            {showFoldersOnly
                                ? Loc.fileBrowser.fileBrowserFolderTitle
                                : Loc.fileBrowser.fileBrowserFileTitle}
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
                                handleNodeDoubleClick,
                                classes,
                            )}
                        </Tree>
                        <div className={classes.formRow}>
                            <Label className={classes.label}>{Loc.fileBrowser.selectedPath}</Label>
                            <Field
                                className={classes.fieldControl}
                                validationState={
                                    selectedNodeValidationMessage() ? "error" : undefined
                                }
                                validationMessage={selectedNodeValidationMessage()}>
                                <Input
                                    size="small"
                                    placeholder={
                                        showFoldersOnly
                                            ? Loc.fileBrowser.folderPath
                                            : Loc.fileBrowser.filePath
                                    }
                                    value={selectedFileInfo.fullPath}
                                    onChange={(_event, data) => {
                                        setSelectedFileInfo({
                                            fullPath: data.value,
                                            isFile: !showFoldersOnly,
                                        });
                                    }}
                                />
                            </Field>
                        </div>
                        {!showFoldersOnly && ( // only show file filter if showing files instead of just folders
                            <div className={classes.formRow}>
                                <Label className={classes.label}>
                                    {Loc.fileBrowser.filesOfType}
                                </Label>
                                <Dropdown
                                    className={classes.fieldControl}
                                    size="small"
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
                    <DialogActions className={classes.actionsDiv}>
                        <Button
                            appearance="primary"
                            onClick={async () => {
                                await handleSubmit();
                            }}
                            disabled={selectedNodeValidationMessage() !== ""}>
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
    onNodeDoubleClick: (node: FileTreeNode) => void,
    classes: FileBrowserDialogClasses,
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
            }}
            onDoubleClick={(e: React.MouseEvent) => {
                e.stopPropagation(); // prevent parent TreeItems from also triggering
                onNodeDoubleClick(node);
            }}>
            <TreeItemLayout iconBefore={isBranch ? <FolderRegular /> : <DocumentRegular />}>
                {node.name}
            </TreeItemLayout>

            {isBranch && (
                <Tree>
                    {hasChildren ? (
                        node.children.map((child) =>
                            renderTreeItem(
                                child,
                                onNodeExpand,
                                onNodeClick,
                                onNodeDoubleClick,
                                classes,
                            ),
                        )
                    ) : !node.isExpanded ? (
                        // show loading only while expanding
                        <TreeItem
                            value={`${node.fullPath}_loadingChildren`}
                            itemType="leaf"
                            data-node={node}>
                            <TreeItemLayout>
                                <div className={classes.loadingRow}>
                                    <Spinner size="extra-tiny" />
                                    {`${Loc.common.loading}...`}
                                </div>
                            </TreeItemLayout>
                        </TreeItem>
                    ) : undefined}
                </Tree>
            )}
        </TreeItem>
    );
}
