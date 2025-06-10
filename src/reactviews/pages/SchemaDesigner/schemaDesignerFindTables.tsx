/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Node, useReactFlow } from "@xyflow/react";
import { SchemaDesigner } from "../../../sharedInterfaces/schemaDesigner";
import { SchemaDesignerContext } from "./schemaDesignerStateProvider";
import { locConstants } from "../../common/locConstants";
import { SearchableItem, FindWidget } from "../../common/findWidget.component";
// Adapter to make a flow Node compatible with SearchableItem
class TableNodeItem implements SearchableItem {
    private node: Node<SchemaDesigner.Table>;

    constructor(node: Node<SchemaDesigner.Table>) {
        this.node = node;
    }

    get id(): string {
        return this.node.id;
    }

    getDisplayText(): string {
        return `${this.node.data.schema || ""}.${this.node.data.name}`;
    }

    getSearchableText(): string {
        return this.getDisplayText();
    }

    getNode(): Node<SchemaDesigner.Table> {
        return this.node;
    }
}

export const SchemaDesignerFindTableWidget = ({
    parentRef,
}: {
    parentRef?: React.RefObject<HTMLElement>;
}) => {
    const reactFlow = useReactFlow();
    const context = useContext(SchemaDesignerContext);

    // Convert flow nodes to searchable items
    const getSearchableItems = (): TableNodeItem[] => {
        const nodes = reactFlow.getNodes() as Array<Node<SchemaDesigner.Table>>;
        return nodes
            .filter((node) => !node.hidden && node.data && node.data.name)
            .map((node) => new TableNodeItem(node));
    };

    // Handle when an item is selected in search results
    const handleItemSelected = (item: TableNodeItem) => {
        context.updateSelectedNodes([item.id]);
        context.setCenter(item.id, true);
    };

    return (
        <FindWidget
            getItems={getSearchableItems}
            onItemSelected={handleItemSelected}
            searchLabel={locConstants.common.find}
            width="200px"
            emitSearchEvent={(searchText) => {
                context.setFindTableText(searchText);
            }}
            parentRef={parentRef}
        />
    );
};
