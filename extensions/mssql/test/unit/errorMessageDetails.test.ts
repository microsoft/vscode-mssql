/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorMessageDetails } from "../../src/webviews/common/errorMessageDetails";
import { locConstants } from "../../src/webviews/common/locConstants";

suite("Error message details", () => {
    test("renders the full error and a copy button", () => {
        const message = "A long error with an_unbroken_identifier_that_must_remain_available";
        const markup = renderToStaticMarkup(createElement(ErrorMessageDetails, { message }));

        expect(markup).to.include(message);
        expect(markup).to.include(`<button`);
        expect(markup).to.include(`aria-label="${locConstants.common.copy}"`);
        expect(markup).to.include(`tabindex="0"`);
    });
});
