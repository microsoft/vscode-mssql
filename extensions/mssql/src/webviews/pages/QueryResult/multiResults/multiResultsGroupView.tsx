/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from "@fluentui/react-components";
import debounce from "lodash/debounce";
import {
    type ComponentType,
    type DragEvent,
    Fragment,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { MultiResultsEntry, MultiResultsGroup } from "../../../../sharedInterfaces/multiResults";
import { MultiResultsStore } from "./multiResultsStore";
import { MultiResultsPane } from "./multiResultsPane";
import {
    getDroppedMultiResult,
    isMultiResultDrag,
    useMultiResultsActions,
} from "./multiResultsActions";

export type MultiResultsOrientation = "horizontal" | "vertical";

const useStyles = makeStyles({
    panelGroup: {
        width: "100%",
        height: "100%",
    },
    paneSlot: {
        position: "relative",
        width: "100%",
        height: "100%",
    },
    resizeHandle: {
        position: "relative",
        flexShrink: 0,
        backgroundColor: "var(--vscode-panel-border)",
        outline: "none",
        transitionProperty: "background-color",
        transitionDuration: "0.1s",
        ":hover": {
            backgroundColor: "var(--vscode-sash-hoverBorder)",
        },
        "&[data-resize-handle-state='drag']": {
            backgroundColor: "var(--vscode-sash-hoverBorder)",
        },
        ":focus-visible": {
            backgroundColor: "var(--vscode-focusBorder)",
        },
    },
    resizeHandleHorizontal: {
        width: "1px",
        cursor: "ew-resize",
        // Widen the grab area without widening the visible line.
        "::after": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "-2px",
            right: "-2px",
        },
    },
    resizeHandleVertical: {
        height: "1px",
        cursor: "ns-resize",
        "::after": {
            content: '""',
            position: "absolute",
            left: 0,
            right: 0,
            top: "-2px",
            bottom: "-2px",
        },
    },
    dropOverlay: {
        position: "absolute",
        zIndex: 10,
        pointerEvents: "none",
        backgroundColor: "var(--vscode-editorGroup-dropBackground)",
    },
    dropBeforeHorizontal: { top: 0, bottom: 0, left: 0, width: "50%" },
    dropAfterHorizontal: { top: 0, bottom: 0, right: 0, width: "50%" },
    dropBeforeVertical: { left: 0, right: 0, top: 0, height: "50%" },
    dropAfterVertical: { left: 0, right: 0, bottom: 0, height: "50%" },
});

type DropSide = "before" | "after";

interface MultiResultsGroupViewProps {
    group: MultiResultsGroup;
    groups: readonly MultiResultsGroup[];
    entries: Record<string, MultiResultsEntry>;
    orientation: MultiResultsOrientation;
    store: MultiResultsStore;
    GridView: ComponentType;
    isBetaResultsGridEnabled: boolean;
}

/**
 * Shows the results of a group side by side. Remount it when the group or its results change,
 * so its panes start from the group's saved sizes.
 */
export const MultiResultsGroupView = ({
    group,
    groups,
    entries,
    orientation,
    store,
    GridView,
    isBetaResultsGridEnabled,
}: MultiResultsGroupViewProps) => {
    const classes = useStyles();
    const actions = useMultiResultsActions();
    const [dropIndicator, setDropIndicator] = useState<{ uri: string; side: DropSide } | undefined>(
        undefined,
    );

    const groupId = group.id;
    const saveSizes = useMemo(
        () => debounce((sizes: number[]) => actions.setGroupSizes(groupId, sizes), 300),
        [actions, groupId],
    );
    useEffect(() => () => saveSizes.flush(), [saveSizes]);

    // The first layout is the one the group was opened with, so only later ones are saved.
    const hasInitialLayoutRef = useRef(false);
    const onLayout = (sizes: number[]) => {
        if (!hasInitialLayoutRef.current) {
            hasInitialLayoutRef.current = true;
            return;
        }
        saveSizes(sizes);
    };

    useEffect(() => {
        const clearDropIndicator = () => setDropIndicator(undefined);
        window.addEventListener("dragend", clearDropIndicator);
        window.addEventListener("drop", clearDropIndicator);
        return () => {
            window.removeEventListener("dragend", clearDropIndicator);
            window.removeEventListener("drop", clearDropIndicator);
        };
    }, []);

    const getDropSide = (event: DragEvent<HTMLElement>): DropSide => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (orientation === "horizontal") {
            return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
        }
        return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    };

    const onDragOver = (event: DragEvent<HTMLElement>, uri: string) => {
        if (!isMultiResultDrag(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const side = getDropSide(event);
        setDropIndicator((current) =>
            current?.uri === uri && current.side === side ? current : { uri, side },
        );
    };

    const onDragLeave = (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropIndicator(undefined);
        }
    };

    const onDrop = (event: DragEvent<HTMLElement>, uri: string) => {
        const droppedUri = getDroppedMultiResult(event);
        setDropIndicator(undefined);
        if (!droppedUri) {
            return;
        }
        event.preventDefault();
        const index = group.uris.indexOf(uri) + (getDropSide(event) === "after" ? 1 : 0);
        actions.move(droppedUri, { kind: "joinGroup", groupId: group.id, index });
    };

    const getDropOverlayClass = (side: DropSide) => {
        if (orientation === "horizontal") {
            return side === "before" ? classes.dropBeforeHorizontal : classes.dropAfterHorizontal;
        }
        return side === "before" ? classes.dropBeforeVertical : classes.dropAfterVertical;
    };

    const savedSizes = group.sizes?.length === group.uris.length ? group.sizes : undefined;
    return (
        <PanelGroup direction={orientation} className={classes.panelGroup} onLayout={onLayout}>
            {group.uris.map((uri, index) => (
                <Fragment key={uri}>
                    {index > 0 && (
                        <PanelResizeHandle
                            className={mergeClasses(
                                classes.resizeHandle,
                                orientation === "horizontal"
                                    ? classes.resizeHandleHorizontal
                                    : classes.resizeHandleVertical,
                            )}
                        />
                    )}
                    <Panel id={uri} order={index} defaultSize={savedSizes?.[index]} minSize={10}>
                        <div
                            className={classes.paneSlot}
                            onDragOver={(event) => onDragOver(event, uri)}
                            onDragLeave={onDragLeave}
                            onDrop={(event) => onDrop(event, uri)}>
                            <MultiResultsPane
                                uri={uri}
                                entry={entries[uri]}
                                group={group}
                                groups={groups}
                                isFocused={group.focusedUri === uri}
                                store={store}
                                GridView={GridView}
                                isBetaResultsGridEnabled={isBetaResultsGridEnabled}
                            />
                            {dropIndicator?.uri === uri && (
                                <div
                                    className={mergeClasses(
                                        classes.dropOverlay,
                                        getDropOverlayClass(dropIndicator.side),
                                    )}
                                />
                            )}
                        </div>
                    </Panel>
                </Fragment>
            ))}
        </PanelGroup>
    );
};
