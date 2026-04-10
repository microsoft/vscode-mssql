/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NotebookQueryResultBlock } from "../../../sharedInterfaces/notebookQueryResult";
import { NotebookResultGrid } from "./notebookResultGrid";

export interface NotebookResultsOutputProps {
    blocks: NotebookQueryResultBlock[];
}

export function NotebookResultsOutput({ blocks }: NotebookResultsOutputProps) {
    return (
        <div className="notebook-results-output">
            {blocks.map((block, index) => {
                switch (block.type) {
                    case "resultSet":
                        return (
                            <div className="notebook-results-output-block" key={`grid-${index}`}>
                                <NotebookResultGrid
                                    columnInfo={block.columnInfo}
                                    rows={block.rows}
                                    rowCount={block.rowCount}
                                />
                            </div>
                        );
                    case "error":
                        return (
                            <pre
                                className="notebook-result-text notebook-result-text-error"
                                key={`error-${index}`}>
                                {block.text}
                            </pre>
                        );
                    case "text":
                        return (
                            <pre className="notebook-result-text" key={`text-${index}`}>
                                {block.text}
                            </pre>
                        );
                }
            })}
        </div>
    );
}
