/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    TableExplorerWebviewState,
    TableExplorerReducers,
    TableExplorerReactProvider,
} from "../../../sharedInterfaces/tableExplorer";
import { getCoreRPCs } from "../../common/utils";
import {
    useVscodeWebview,
    WebviewContextProps,
} from "../../common/vscodeWebviewProvider";
import { ReactNode, createContext } from "react";

export interface TableExplorerContextProps
    extends WebviewContextProps<TableExplorerWebviewState>,
        TableExplorerReactProvider {}

const TableExplorerContext = createContext<
    TableExplorerContextProps | undefined
>(undefined);

interface TableExplorerProviderProps {
    children: ReactNode;
}

const TableExplorerStateProvider: React.FC<TableExplorerProviderProps> = ({
    children,
}) => {
    const webviewState = useVscodeWebview<
        TableExplorerWebviewState,
        TableExplorerReducers
    >();

    // Result pane height state
    // const [resultPaneHeight, setResultPaneHeight] = useState<number>(300);
    // const [isResultPaneFullScreen, setIsResultPaneFullScreen] =
    //     useState<boolean>(false);
    // const [originalHeight, setOriginalHeight] = useState<number>(300);

    // // Properties pane width state
    // const [propertiesPaneWidth, setPropertiesPaneWidth] = useState<number>(450);
    // const [isPropertiesPaneFullScreen, setIsPropertiesPaneFullScreen] =
    //     useState<boolean>(false);
    // const [originalWidth, setOriginalWidth] = useState<number>(450);

    // const elementRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
    // const tableState = webviewState?.state;

    // function getComponentId(componentPath: (string | number)[]): string {
    //     return `${tableState.tableInfo?.id}_${componentPath.join("_")}`;
    // }

    return (
        <TableExplorerContext.Provider
            value={{
                ...getCoreRPCs(webviewState),

                setTableExplorerResults: function (resultCount: number): void {
                    webviewState.extensionRpc.action(
                        "setTableExplorerResults",
                        { resultCount: resultCount },
                    );
                },
                openFileThroughLink: function (
                    content: string,
                    type: string,
                ): void {
                    webviewState?.extensionRpc.action("openFileThroughLink", {
                        content: content,
                        type: type,
                    });
                },
                state: webviewState?.state as TableExplorerWebviewState,
                themeKind: webviewState?.themeKind,
            }}
        >
            {children}
        </TableExplorerContext.Provider>
    );
};

export { TableExplorerContext, TableExplorerStateProvider };
