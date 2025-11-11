/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { useChangelogSelector } from "./changelogSelector";

export const ChangelogPage = () => {
    const { changes } = useChangelogSelector((state) => state.changes);
    const { version } = useChangelogSelector((state) => state.version);
    const { resources } = useChangelogSelector((state) => state.resources);
    const { walkthroughs } = useChangelogSelector((state) => state.walkthroughs);
    const { extensionRpc } = useVscodeWebview2();
    return <div>Changelog Page</div>;
};
