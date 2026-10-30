/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Text, Title3 } from "@fluentui/react-components";
import { DatabaseSearch24Regular } from "@fluentui/react-icons";
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
    CloseMultiResultNotification,
    FocusMultiResultNotification,
    MoveMultiResultNotification,
    MultiResultsFileStateNotification,
    SetMultiResultsGroupSizesNotification,
} from "../../../../sharedInterfaces/multiResults";
import {
    QueryResultReducers,
    QueryResultWebviewState,
} from "../../../../sharedInterfaces/queryResult";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { useQueryResultSelector } from "../queryResultSelector";
import { MultiResultsActions, MultiResultsActionsContext } from "./multiResultsActions";
import { MultiResultsGroupView, MultiResultsOrientation } from "./multiResultsGroupView";
import { MultiResultsList } from "./multiResultsList";
import { MultiResultsStore } from "./multiResultsStore";

const useStyles = makeStyles({
    root: {
        width: "100%",
        height: "100%",
    },
    listResizeHandle: {
        width: "1px",
        position: "relative",
        backgroundColor: "var(--vscode-panel-border)",
        outline: "none",
        ":hover": {
            backgroundColor: "var(--vscode-sash-hoverBorder)",
        },
        "&[data-resize-handle-state='drag']": {
            backgroundColor: "var(--vscode-sash-hoverBorder)",
        },
        ":focus-visible": {
            backgroundColor: "var(--vscode-focusBorder)",
        },
        "::after": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "-2px",
            right: "-2px",
        },
    },
    empty: {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "20px",
        boxSizing: "border-box",
        textAlign: "center",
        overflowY: "auto",
    },
    emptyIcon: {
        width: "56px",
        height: "56px",
        display: "grid",
        placeItems: "center",
        borderRadius: "14px",
        background: "linear-gradient(135deg, rgba(0,120,212,.16), rgba(0,120,212,.06))",
    },
});

interface MultiResultsPageProps {
    GridView: ComponentType;
    isBetaResultsGridEnabled: boolean;
}

/**
 * Lists every query result on the right, and shows one group of them side by side.
 */
export const MultiResultsPage = ({ GridView, isBetaResultsGridEnabled }: MultiResultsPageProps) => {
    const classes = useStyles();
    const { extensionRpc } = useVscodeWebview<QueryResultWebviewState, QueryResultReducers>();
    const multiResults = useQueryResultSelector((state) => state.multiResults);
    const store = useMemo(() => new MultiResultsStore(), []);

    useEffect(() => {
        const disposable = extensionRpc.onNotification(
            MultiResultsFileStateNotification.type,
            ({ uri, state }) => store.set(uri, state),
        );
        return () => disposable.dispose();
    }, [extensionRpc, store]);

    const actions = useMemo<MultiResultsActions>(
        () => ({
            focus: (uri) =>
                void extensionRpc.sendNotification(FocusMultiResultNotification.type, { uri }),
            move: (uri, target) =>
                void extensionRpc.sendNotification(MoveMultiResultNotification.type, {
                    uri,
                    target,
                }),
            close: (uri) =>
                void extensionRpc.sendNotification(CloseMultiResultNotification.type, { uri }),
            setGroupSizes: (groupId, sizes) =>
                void extensionRpc.sendNotification(SetMultiResultsGroupSizesNotification.type, {
                    groupId,
                    sizes,
                }),
        }),
        [extensionRpc],
    );

    // Split side by side when the view is wide, as in the bottom panel, and stacked when it is
    // tall, as in a side panel.
    const rootRef = useRef<HTMLDivElement>(null);
    const [orientation, setOrientation] = useState<MultiResultsOrientation>("horizontal");
    useEffect(() => {
        const element = rootRef.current;
        if (!element) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            setOrientation(width >= height ? "horizontal" : "vertical");
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const activeGroup = multiResults?.groups.find(
        (group) => group.id === multiResults.activeGroupId,
    );
    // Identifies the results shown, which change less often than the layout objects.
    const activeGroupKey = activeGroup ? `${activeGroup.id}\n${activeGroup.uris.join("\n")}` : "";
    useEffect(() => {
        store.retainOnly(activeGroup?.uris ?? []);
    }, [activeGroupKey, store]);

    return (
        <div ref={rootRef} className={classes.root}>
            {multiResults && (
                <MultiResultsActionsContext.Provider value={actions}>
                    <PanelGroup direction="horizontal">
                        <Panel id="multi-results-group" order={0} minSize={30}>
                            {activeGroup ? (
                                <MultiResultsGroupView
                                    key={`${activeGroupKey}\n${orientation}`}
                                    group={activeGroup}
                                    groups={multiResults.groups}
                                    entries={multiResults.entries}
                                    orientation={orientation}
                                    store={store}
                                    GridView={GridView}
                                    isBetaResultsGridEnabled={isBetaResultsGridEnabled}
                                />
                            ) : (
                                <div className={classes.empty}>
                                    <div className={classes.emptyIcon} aria-hidden>
                                        <DatabaseSearch24Regular />
                                    </div>
                                    <Title3>{locConstants.multiResults.noResultsHeader}</Title3>
                                    <Text>{locConstants.multiResults.noResultsMessage}</Text>
                                </div>
                            )}
                        </Panel>
                        <PanelResizeHandle className={classes.listResizeHandle} />
                        <Panel
                            id="multi-results-list"
                            order={1}
                            defaultSize={20}
                            minSize={8}
                            maxSize={50}>
                            <MultiResultsList state={multiResults} />
                        </Panel>
                    </PanelGroup>
                </MultiResultsActionsContext.Provider>
            )}
        </div>
    );
};
