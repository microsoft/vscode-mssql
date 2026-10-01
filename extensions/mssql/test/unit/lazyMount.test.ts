/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LazyMount } from "../../src/webviews/common/lazyMount";

suite("LazyMount", () => {
    test("keeps deferred result sets in the rendered keyboard focus order", () => {
        const markup = renderToStaticMarkup(
            createElement(
                "div",
                undefined,
                createElement(LazyMount, {
                    children: createElement("button", undefined, "First mounted grid"),
                    enabled: true,
                    placeholderProps: {
                        "aria-busy": true,
                        "aria-label": "Result set 1",
                        role: "region",
                        tabIndex: 0,
                    },
                }),
                createElement(LazyMount, {
                    children: createElement("button", undefined, "Second mounted grid"),
                    enabled: true,
                    placeholderProps: {
                        "aria-busy": true,
                        "aria-label": "Result set 2",
                        role: "region",
                        tabIndex: 0,
                    },
                }),
            ),
        );

        expect(markup.match(/tabindex="0"/g)).to.have.length(2);
        expect(markup.match(/role="region"/g)).to.have.length(2);
        expect(markup).to.include('aria-label="Result set 1"');
        expect(markup).to.include('aria-label="Result set 2"');
        expect(markup).not.to.include("mounted grid");
    });
});
