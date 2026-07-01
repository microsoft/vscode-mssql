/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { NotebookQueryResultBlock } from "../../../sharedInterfaces/notebookQueryResult";
import { NotebookResultGrid } from "./notebookResultGrid";
import { NotebookResultsToolbar } from "./notebookResultsToolbar";

export interface NotebookResultsOutputProps {
    blocks: NotebookQueryResultBlock[];
    postMessage?: (message: unknown) => void;
}

export function NotebookResultsOutput({ blocks, postMessage }: NotebookResultsOutputProps) {
    let resultSetCounter = 0;
    return (
        <div className="notebook-results-output">
            {blocks.map((block, index) => {
                switch (block.type) {
                    case "resultSet": {
                        const resultSetIndex = resultSetCounter++;
                        return (
                            <div className="notebook-results-output-block" key={`grid-${index}`}>
                                <NotebookResultsToolbar
                                    columnInfo={block.columnInfo}
                                    rows={block.rows}
                                    resultSetIndex={resultSetIndex}
                                    postMessage={postMessage}
                                />
                                <NotebookResultGrid
                                    columnInfo={block.columnInfo}
                                    rows={block.rows}
                                    rowCount={block.rowCount}
                                    postMessage={postMessage}
                                />
                            </div>
                        );
                    }
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
