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
    Input,
    makeStyles,
    mergeClasses,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    tokens,
    Tooltip,
} from "@fluentui/react-components";
import {
    CheckmarkRegular,
    DeleteRegular,
    DismissRegular,
    EditRegular,
    InfoRegular,
    MoreHorizontalRegular,
    PinFilled,
    PinRegular,
} from "@fluentui/react-icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { KeyboardEvent, useRef, useState } from "react";
import { ObjectExplorerFilterPreset } from "../../../sharedInterfaces/objectExplorerFilter";
import { locConstants } from "../../common/locConstants";

const presetRowHeight = 48;
const groupHeadingHeight = 28;
const separatedGroupHeadingHeight = 44;
const maximumListHeight = 352;

interface PresetGroupRow {
    kind: "group";
    id: string;
    label: string;
    count: number;
    separated: boolean;
}

interface PresetItemRow {
    kind: "preset";
    id: string;
    preset: ObjectExplorerFilterPreset;
    position: number;
}

type PresetListRow = PresetGroupRow | PresetItemRow;

const useStyles = makeStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        height: "100%",
        boxSizing: "border-box",
        padding: `0 ${tokens.spacingHorizontalS} ${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
        borderLeft: "1px solid var(--vscode-editorGroup-border)",
        backgroundColor: "var(--vscode-editorWidget-background, var(--vscode-editor-background))",
        "@media (max-width: 760px)": {
            padding: `${tokens.spacingVerticalL} 0 0`,
            borderLeft: "none",
            borderTop: "1px solid var(--vscode-editorGroup-border)",
        },
    },
    heading: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        marginBottom: tokens.spacingVerticalS,
        color: "var(--vscode-foreground)",
    },
    infoButton: {
        minWidth: "22px",
        width: "22px",
        height: "22px",
    },
    emptyState: {
        paddingTop: tokens.spacingVerticalS,
        paddingBottom: tokens.spacingVerticalS,
        color: "var(--vscode-descriptionForeground)",
    },
    list: {
        position: "relative",
        overflowY: "auto",
    },
    listCanvas: {
        position: "relative",
        width: "100%",
    },
    groupRow: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: `${groupHeadingHeight}px`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXS,
        paddingLeft: tokens.spacingHorizontalS,
        paddingRight: tokens.spacingHorizontalS,
        color: "var(--vscode-descriptionForeground)",
        textTransform: "uppercase",
        letterSpacing: "0.3px",
    },
    separatedGroupRow: {
        height: `${separatedGroupHeadingHeight}px`,
        paddingTop: tokens.spacingVerticalM,
        borderTop: "1px solid var(--vscode-editorGroup-border)",
    },
    groupCount: {
        color: "var(--vscode-descriptionForeground)",
    },
    row: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: `${presetRowHeight}px`,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalXXS}`,
        borderRadius: tokens.borderRadiusSmall,
        ":hover": {
            backgroundColor: "var(--vscode-list-hoverBackground)",
        },
    },
    selectedRow: {
        backgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
        ":hover": {
            backgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
        },
    },
    presetButton: {
        flexGrow: 1,
        minWidth: 0,
        height: "100%",
        justifyContent: "flex-start",
        paddingLeft: tokens.spacingHorizontalS,
        paddingRight: tokens.spacingHorizontalS,
        color: "var(--vscode-foreground)",
    },
    presetText: {
        display: "flex",
        width: "100%",
        minWidth: 0,
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        textAlign: "left",
    },
    truncate: {
        display: "block",
        width: "100%",
        minWidth: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    presetTitle: {
        color: "var(--vscode-foreground)",
    },
    presetMetadata: {
        color: "var(--vscode-descriptionForeground)",
    },
    actions: {
        display: "flex",
        alignItems: "center",
        flexShrink: 0,
    },
    actionButton: {
        minWidth: "24px",
        width: "24px",
        height: "24px",
        color: "var(--vscode-descriptionForeground)",
    },
    renameEditor: {
        display: "flex",
        alignItems: "center",
        gap: tokens.spacingHorizontalXXS,
        width: "100%",
        minWidth: 0,
        paddingLeft: tokens.spacingHorizontalXS,
    },
    renameInput: {
        flexGrow: 1,
        minWidth: 0,
    },
    tooltip: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.spacingVerticalXS,
        maxWidth: "360px",
    },
    tooltipOptions: {
        display: "flex",
        flexDirection: "column",
        rowGap: tokens.spacingVerticalXXS,
    },
});

export interface ObjectExplorerFilterPresetsProps {
    presets: ObjectExplorerFilterPreset[];
    selectedPresetId?: string;
    getDetails: (preset: ObjectExplorerFilterPreset) => string[];
    onSelect: (preset: ObjectExplorerFilterPreset) => void;
    onSetPinned: (presetId: string, isPinned: boolean) => void;
    onDelete: (presetId: string) => void;
    onRename: (presetId: string, name: string) => void;
}

export const ObjectExplorerFilterPresets = ({
    presets,
    selectedPresetId,
    getDetails,
    onSelect,
    onSetPinned,
    onDelete,
    onRename,
}: ObjectExplorerFilterPresetsProps) => {
    const classes = useStyles();
    const listRef = useRef<HTMLDivElement>(null);
    const [openMenuPresetId, setOpenMenuPresetId] = useState<string>();
    const [renamingPresetId, setRenamingPresetId] = useState<string>();
    const [renameValue, setRenameValue] = useState("");
    const [pendingDelete, setPendingDelete] = useState<ObjectExplorerFilterPreset>();
    const savedPresets = presets.filter((preset) => preset.isPinned);
    const recentPresets = presets.filter((preset) => !preset.isPinned);
    const rows: PresetListRow[] = [];
    let presetPosition = 0;

    const addGroup = (
        id: string,
        label: string,
        groupPresets: ObjectExplorerFilterPreset[],
        separated: boolean,
    ) => {
        if (groupPresets.length === 0) {
            return;
        }

        rows.push({
            kind: "group",
            id: `${id}-heading`,
            label,
            count: groupPresets.length,
            separated,
        });
        for (const preset of groupPresets) {
            rows.push({ kind: "preset", id: preset.id, preset, position: presetPosition++ });
        }
    };

    addGroup("saved", locConstants.objectExplorerFiltering.savedFilters, savedPresets, false);
    addGroup(
        "recent",
        locConstants.objectExplorerFiltering.recentFilters,
        recentPresets,
        savedPresets.length > 0,
    );

    const presetRows = rows
        .map((row, rowIndex) => ({ row, rowIndex }))
        .filter((entry): entry is { row: PresetItemRow; rowIndex: number } => {
            return entry.row.kind === "preset";
        });
    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => listRef.current,
        estimateSize: (index) => {
            const row = rows[index];
            return row.kind === "group"
                ? row.separated
                    ? separatedGroupHeadingHeight
                    : groupHeadingHeight
                : presetRowHeight;
        },
        getItemKey: (index) => rows[index].id,
        overscan: 3,
    });

    const focusPreset = (rowIndex: number) => {
        virtualizer.scrollToIndex(rowIndex, { align: "auto" });
        requestAnimationFrame(() => {
            listRef.current
                ?.querySelector<HTMLButtonElement>(`[data-preset-row-index="${rowIndex}"]`)
                ?.focus();
        });
    };

    const handlePresetKeyDown = (event: KeyboardEvent<HTMLButtonElement>, rowIndex: number) => {
        const currentPosition = presetRows.findIndex((entry) => entry.rowIndex === rowIndex);
        let nextPosition: number | undefined;
        switch (event.key) {
            case "ArrowDown":
                nextPosition = (currentPosition + 1) % presetRows.length;
                break;
            case "ArrowUp":
                nextPosition = (currentPosition - 1 + presetRows.length) % presetRows.length;
                break;
            case "Home":
                nextPosition = 0;
                break;
            case "End":
                nextPosition = presetRows.length - 1;
                break;
            default:
                return;
        }

        event.preventDefault();
        focusPreset(presetRows[nextPosition].rowIndex);
    };

    const beginRename = (preset: ObjectExplorerFilterPreset) => {
        setRenamingPresetId(preset.id);
        setRenameValue(preset.name ?? "");
    };

    const finishRename = (preset: ObjectExplorerFilterPreset, rowIndex: number) => {
        const normalizedName = renameValue.trim();
        const hasConflictingName = presets.some(
            (candidate) =>
                candidate.id !== preset.id &&
                candidate.isPinned &&
                candidate.name?.localeCompare(normalizedName, undefined, {
                    sensitivity: "accent",
                }) === 0,
        );
        if (!normalizedName || hasConflictingName) {
            return;
        }

        onRename(preset.id, normalizedName);
        setRenamingPresetId(undefined);
        focusPreset(rowIndex);
    };

    const cancelRename = (rowIndex: number) => {
        setRenamingPresetId(undefined);
        focusPreset(rowIndex);
    };

    const confirmDelete = () => {
        if (!pendingDelete) {
            return;
        }

        onDelete(pendingDelete.id);
        setPendingDelete(undefined);
    };

    const listHeight = Math.min(
        rows.reduce(
            (height, row) =>
                height +
                (row.kind === "group"
                    ? row.separated
                        ? separatedGroupHeadingHeight
                        : groupHeadingHeight
                    : presetRowHeight),
            0,
        ),
        maximumListHeight,
    );

    return (
        <section className={classes.root} aria-labelledby="reusable-filter-heading">
            <div className={classes.heading}>
                <Text id="reusable-filter-heading" weight="semibold">
                    {locConstants.objectExplorerFiltering.reusableFilters}
                </Text>
                <Tooltip
                    content={locConstants.objectExplorerFiltering.reusableFiltersDescription}
                    relationship="label">
                    <Button
                        type="button"
                        appearance="transparent"
                        size="small"
                        className={classes.infoButton}
                        icon={<InfoRegular />}
                        aria-label={locConstants.objectExplorerFiltering.reusableFiltersDescription}
                    />
                </Tooltip>
            </div>
            {presets.length === 0 ? (
                <Text className={classes.emptyState} size={200}>
                    {locConstants.objectExplorerFiltering.noReusableFilters}
                </Text>
            ) : (
                <div
                    ref={listRef}
                    className={classes.list}
                    style={{ height: `${listHeight}px` }}
                    role="list"
                    aria-label={locConstants.objectExplorerFiltering.reusableFilters}>
                    <div
                        className={classes.listCanvas}
                        style={{ height: `${virtualizer.getTotalSize()}px` }}>
                        {virtualizer.getVirtualItems().map((virtualRow) => {
                            const row = rows[virtualRow.index];
                            if (row.kind === "group") {
                                return (
                                    <div
                                        key={row.id}
                                        className={mergeClasses(
                                            classes.groupRow,
                                            row.separated && classes.separatedGroupRow,
                                        )}
                                        role="presentation"
                                        style={{
                                            transform: `translateY(${virtualRow.start}px)`,
                                        }}>
                                        <Text size={200} weight="semibold">
                                            {row.label}
                                        </Text>
                                        <Text className={classes.groupCount} size={100}>
                                            {row.count}
                                        </Text>
                                    </div>
                                );
                            }

                            const details = getDetails(row.preset);
                            const summary = details.join(" · ");
                            const displayName =
                                row.preset.isPinned && row.preset.name ? row.preset.name : summary;
                            const showSummary =
                                row.preset.isPinned &&
                                !!row.preset.name &&
                                row.preset.name.localeCompare(summary, undefined, {
                                    sensitivity: "accent",
                                }) !== 0;
                            const isSelected = selectedPresetId === row.preset.id;
                            const normalizedRenameValue = renameValue.trim();
                            const renameHasConflict = presets.some(
                                (preset) =>
                                    preset.id !== row.preset.id &&
                                    preset.isPinned &&
                                    preset.name?.localeCompare(normalizedRenameValue, undefined, {
                                        sensitivity: "accent",
                                    }) === 0,
                            );
                            const canSaveRename =
                                normalizedRenameValue.length > 0 && !renameHasConflict;

                            return (
                                <div
                                    key={row.id}
                                    className={mergeClasses(
                                        classes.row,
                                        isSelected && classes.selectedRow,
                                    )}
                                    role="listitem"
                                    aria-posinset={row.position + 1}
                                    aria-setsize={presets.length}
                                    style={{ transform: `translateY(${virtualRow.start}px)` }}>
                                    {renamingPresetId === row.preset.id ? (
                                        <div className={classes.renameEditor}>
                                            <Input
                                                autoFocus
                                                size="small"
                                                className={classes.renameInput}
                                                value={renameValue}
                                                aria-label={
                                                    locConstants.objectExplorerFiltering.filterName
                                                }
                                                aria-invalid={renameHasConflict}
                                                title={
                                                    renameHasConflict
                                                        ? locConstants.objectExplorerFiltering
                                                              .filterNameAlreadyExists
                                                        : undefined
                                                }
                                                onChange={(_event, data) =>
                                                    setRenameValue(data.value)
                                                }
                                                onKeyDown={(event) => {
                                                    event.stopPropagation();
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        finishRename(row.preset, virtualRow.index);
                                                    } else if (event.key === "Escape") {
                                                        event.preventDefault();
                                                        cancelRename(virtualRow.index);
                                                    }
                                                }}
                                            />
                                            <Tooltip
                                                content={
                                                    renameHasConflict
                                                        ? locConstants.objectExplorerFiltering
                                                              .filterNameAlreadyExists
                                                        : locConstants.common.save
                                                }
                                                relationship="label">
                                                <Button
                                                    type="button"
                                                    appearance="subtle"
                                                    size="small"
                                                    className={classes.actionButton}
                                                    icon={<CheckmarkRegular />}
                                                    disabled={!canSaveRename}
                                                    onClick={() =>
                                                        finishRename(row.preset, virtualRow.index)
                                                    }
                                                />
                                            </Tooltip>
                                            <Tooltip
                                                content={locConstants.common.cancel}
                                                relationship="label">
                                                <Button
                                                    type="button"
                                                    appearance="subtle"
                                                    size="small"
                                                    className={classes.actionButton}
                                                    icon={<DismissRegular />}
                                                    onClick={() => cancelRename(virtualRow.index)}
                                                />
                                            </Tooltip>
                                        </div>
                                    ) : (
                                        <>
                                            <Tooltip
                                                content={
                                                    <div className={classes.tooltip}>
                                                        <Text weight="semibold">{displayName}</Text>
                                                        <div className={classes.tooltipOptions}>
                                                            {details.map((detail, index) => (
                                                                <Text key={index} size={200}>
                                                                    {detail}
                                                                </Text>
                                                            ))}
                                                        </div>
                                                    </div>
                                                }
                                                relationship="description">
                                                <Button
                                                    type="button"
                                                    appearance="subtle"
                                                    className={classes.presetButton}
                                                    data-preset-row-index={virtualRow.index}
                                                    aria-label={locConstants.objectExplorerFiltering.useFilter(
                                                        displayName,
                                                    )}
                                                    aria-pressed={isSelected}
                                                    onKeyDown={(event) =>
                                                        handlePresetKeyDown(event, virtualRow.index)
                                                    }
                                                    onClick={() => onSelect(row.preset)}>
                                                    <span className={classes.presetText}>
                                                        <Text
                                                            className={mergeClasses(
                                                                classes.truncate,
                                                                classes.presetTitle,
                                                            )}
                                                            weight={
                                                                row.preset.isPinned &&
                                                                row.preset.name
                                                                    ? "semibold"
                                                                    : "regular"
                                                            }>
                                                            {displayName}
                                                        </Text>
                                                        {showSummary && (
                                                            <Text
                                                                className={mergeClasses(
                                                                    classes.truncate,
                                                                    classes.presetMetadata,
                                                                )}
                                                                size={200}>
                                                                {summary}
                                                            </Text>
                                                        )}
                                                    </span>
                                                </Button>
                                            </Tooltip>
                                            <div className={classes.actions}>
                                                <Tooltip
                                                    content={
                                                        row.preset.isPinned
                                                            ? locConstants.objectExplorerFiltering
                                                                  .unpinFilter
                                                            : locConstants.objectExplorerFiltering
                                                                  .pinFilter
                                                    }
                                                    relationship="label">
                                                    <Button
                                                        type="button"
                                                        appearance="subtle"
                                                        size="small"
                                                        className={classes.actionButton}
                                                        icon={
                                                            row.preset.isPinned ? (
                                                                <PinFilled />
                                                            ) : (
                                                                <PinRegular />
                                                            )
                                                        }
                                                        onClick={() =>
                                                            onSetPinned(
                                                                row.preset.id,
                                                                !row.preset.isPinned,
                                                            )
                                                        }
                                                    />
                                                </Tooltip>
                                                {row.preset.isPinned && (
                                                    <Menu
                                                        open={openMenuPresetId === row.preset.id}
                                                        onOpenChange={(_event, data) =>
                                                            setOpenMenuPresetId(
                                                                data.open
                                                                    ? row.preset.id
                                                                    : undefined,
                                                            )
                                                        }>
                                                        <MenuTrigger disableButtonEnhancement>
                                                            <Button
                                                                type="button"
                                                                appearance="subtle"
                                                                size="small"
                                                                className={classes.actionButton}
                                                                icon={<MoreHorizontalRegular />}
                                                                aria-label={locConstants.objectExplorerFiltering.moreFilterActions(
                                                                    displayName,
                                                                )}
                                                            />
                                                        </MenuTrigger>
                                                        <MenuPopover>
                                                            <MenuList>
                                                                <MenuItem
                                                                    icon={<EditRegular />}
                                                                    onClick={() =>
                                                                        beginRename(row.preset)
                                                                    }>
                                                                    {
                                                                        locConstants
                                                                            .objectExplorerFiltering
                                                                            .renameFilter
                                                                    }
                                                                </MenuItem>
                                                            </MenuList>
                                                        </MenuPopover>
                                                    </Menu>
                                                )}
                                                <Tooltip
                                                    content={
                                                        locConstants.objectExplorerFiltering
                                                            .deleteFilter
                                                    }
                                                    relationship="label">
                                                    <Button
                                                        type="button"
                                                        appearance="subtle"
                                                        size="small"
                                                        className={classes.actionButton}
                                                        icon={<DeleteRegular />}
                                                        onClick={() => setPendingDelete(row.preset)}
                                                    />
                                                </Tooltip>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            <Dialog
                open={pendingDelete !== undefined}
                modalType="alert"
                onOpenChange={(_event, data) => {
                    if (!data.open) {
                        setPendingDelete(undefined);
                    }
                }}>
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {locConstants.objectExplorerFiltering.confirmDeleteFilterTitle}
                        </DialogTitle>
                        <DialogContent>
                            {pendingDelete &&
                                locConstants.objectExplorerFiltering.confirmDeleteFilterMessage(
                                    pendingDelete.name ?? getDetails(pendingDelete).join(" · "),
                                )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                type="button"
                                appearance="secondary"
                                onClick={() => setPendingDelete(undefined)}>
                                {locConstants.common.cancel}
                            </Button>
                            <Button type="button" appearance="primary" onClick={confirmDelete}>
                                {locConstants.objectExplorerFiltering.deleteFilter}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </section>
    );
};
