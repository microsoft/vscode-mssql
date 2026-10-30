/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles, Spinner, Text } from "@fluentui/react-components";
import { ArrowExitRegular, DismissRegular } from "@fluentui/react-icons";
import {
    type ComponentType,
    memo,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useSyncExternalStore,
} from "react";
import {
    GetMultiResultsFileStateRequest,
    MultiResultsEntry,
    MultiResultsGroup,
    MultiResultsPaneActionRequest,
} from "../../../../sharedInterfaces/multiResults";
import {
    QueryResultReducers,
    QueryResultWebviewState,
} from "../../../../sharedInterfaces/queryResult";
import { locConstants } from "../../../common/locConstants";
import {
    VscodeWebviewContext,
    VscodeWebviewContextProps,
} from "../../../common/vscodeWebviewProvider";
import { QueryResultPane } from "../queryResultPane";
import { QueryResultPaneScopeContext } from "../queryResultPaneScope";
import { QueryResultStateProvider } from "../queryResultStateProvider";
import { MultiResultsStore } from "./multiResultsStore";
import {
    getNewGroupTarget,
    startMultiResultDrag,
    useMultiResultsActions,
} from "./multiResultsActions";

const useStyles = makeStyles({
    pane: {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "2px",
        flexShrink: 0,
        height: "24px",
        paddingLeft: "8px",
        paddingRight: "2px",
        cursor: "grab",
        color: "var(--vscode-descriptionForeground)",
        borderTop: "1px solid transparent",
        borderBottom: "1px solid var(--vscode-panel-border)",
    },
    headerFocused: {
        color: "var(--vscode-foreground)",
        borderTopColor: "var(--vscode-focusBorder)",
    },
    title: {
        flex: 1,
        minWidth: 0,
        fontSize: "12px",
    },
    closedTitle: {
        fontStyle: "italic",
    },
    body: {
        position: "relative",
        flex: 1,
        minHeight: 0,
    },
    bodyContent: {
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
    },
    loading: {
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    },
});

const EMPTY_STATE = {} as QueryResultWebviewState;

type QueryResultWebviewContextProps = VscodeWebviewContextProps<
    QueryResultWebviewState,
    QueryResultReducers
>;

/**
 * Gives the results pane below it a webview context that reads and changes one result, so the
 * pane works as it does when it is the only one in the view.
 */
function useResultWebviewContext(
    uri: string,
    store: MultiResultsStore,
): QueryResultWebviewContextProps {
    const parent = useContext(VscodeWebviewContext) as QueryResultWebviewContextProps;
    return useMemo(
        () => ({
            ...parent,
            extensionRpc: parent.extensionRpc.withActionDispatcher((type, payload) =>
                parent.extensionRpc.sendRequest(MultiResultsPaneActionRequest.type, {
                    uri,
                    type: type as keyof QueryResultReducers,
                    payload,
                }),
            ),
            getSnapshot: () => store.get(uri) ?? EMPTY_STATE,
            subscribe: (listener: () => void) => store.subscribe(uri, listener),
        }),
        [parent, uri, store],
    );
}

interface MultiResultsPaneProps {
    uri: string;
    entry: MultiResultsEntry | undefined;
    group: MultiResultsGroup;
    groups: readonly MultiResultsGroup[];
    isFocused: boolean;
    store: MultiResultsStore;
    GridView: ComponentType;
    isBetaResultsGridEnabled: boolean;
}

export const MultiResultsPane = memo(function MultiResultsPane({
    uri,
    entry,
    group,
    groups,
    isFocused,
    store,
    GridView,
    isBetaResultsGridEnabled,
}: MultiResultsPaneProps) {
    const classes = useStyles();
    const actions = useMultiResultsActions();
    const context = useResultWebviewContext(uri, store);
    const paneScope = useMemo(() => ({ isActive: isFocused }), [isFocused]);

    const subscribe = useCallback(
        (listener: () => void) => store.subscribe(uri, listener),
        [store, uri],
    );
    const hasState = useSyncExternalStore(subscribe, () => store.get(uri) !== undefined);

    // Results normally arrive before their pane is shown. Ask for them if they did not.
    const { extensionRpc } = context;
    useEffect(() => {
        if (store.get(uri)) {
            return;
        }
        extensionRpc
            .sendRequest(GetMultiResultsFileStateRequest.type, { uri })
            .then((state) => {
                if (state && !store.get(uri)) {
                    store.set(uri, state);
                }
            })
            .catch((error) => extensionRpc.log.error("Failed to get query result state", error));
    }, [extensionRpc, store, uri]);

    const focus = () => {
        if (!isFocused) {
            actions.focus(uri);
        }
    };

    const title = entry?.title ?? uri;
    return (
        <div
            className={classes.pane}
            role="region"
            aria-label={locConstants.multiResults.resultsFor(title)}
            onPointerDownCapture={focus}
            onFocusCapture={focus}>
            <div
                className={`${classes.header} ${isFocused ? classes.headerFocused : ""}`}
                draggable
                onDragStart={(event) => startMultiResultDrag(event, uri)}
                title={
                    entry?.isDocumentClosed ? locConstants.multiResults.closedEditorTooltip : uri
                }>
                <Text
                    truncate
                    wrap={false}
                    className={`${classes.title} ${entry?.isDocumentClosed ? classes.closedTitle : ""}`}>
                    {entry?.isDocumentClosed
                        ? locConstants.multiResults.closedEditorTitle(title)
                        : title}
                </Text>
                {group.uris.length > 1 && (
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<ArrowExitRegular />}
                        title={locConstants.multiResults.moveToNewGroup}
                        aria-label={locConstants.multiResults.moveToNewGroup}
                        onClick={() => actions.move(uri, getNewGroupTarget(groups, group))}
                    />
                )}
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<DismissRegular />}
                    title={locConstants.multiResults.closeResults}
                    aria-label={locConstants.multiResults.closeResults}
                    onClick={() => actions.close(uri)}
                />
            </div>
            <div className={classes.body}>
                <div className={classes.bodyContent}>
                    {hasState ? (
                        <VscodeWebviewContext.Provider
                            value={context as VscodeWebviewContextProps<unknown, unknown>}>
                            <QueryResultPaneScopeContext.Provider value={paneScope}>
                                <QueryResultStateProvider>
                                    <QueryResultPane
                                        GridView={GridView}
                                        isBetaResultsGridEnabled={isBetaResultsGridEnabled}
                                    />
                                </QueryResultStateProvider>
                            </QueryResultPaneScopeContext.Provider>
                        </VscodeWebviewContext.Provider>
                    ) : (
                        <div className={classes.loading}>
                            <Spinner size="small" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});
