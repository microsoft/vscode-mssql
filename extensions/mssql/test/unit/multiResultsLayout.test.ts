/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { MultiResultsLayout } from "../../src/queryResult/multiResultsLayout";

suite("MultiResultsLayout", () => {
    const a = "file:///a.sql";
    const b = "file:///b.sql";
    const c = "file:///c.sql";

    function createLayout(...uris: string[]): MultiResultsLayout {
        const layout = new MultiResultsLayout();
        uris.forEach((uri) => layout.add(uri));
        return layout;
    }

    function groupUris(layout: MultiResultsLayout): string[][] {
        return layout.groups.map((group) => group.uris);
    }

    test("adds each result as its own group and shows the first one", () => {
        const layout = createLayout(a, b);
        layout.add(a);

        expect(groupUris(layout)).to.deep.equal([[a], [b]]);
        expect(layout.activeGroup?.uris).to.deep.equal([a]);
    });

    test("focusing a result shows its group with the result focused", () => {
        const layout = createLayout(a, b, c);
        layout.move(b, { kind: "joinGroup", groupId: layout.getGroup(c)!.id, index: 0 });
        layout.focus(a);

        expect(layout.focus(c)).to.be.true;
        expect(layout.activeGroup?.uris).to.deep.equal([b, c]);
        expect(layout.activeGroup?.focusedUri).to.equal(c);
        expect(layout.focus(c)).to.be.false;
        expect(layout.focus("file:///unknown.sql")).to.be.false;
    });

    test("joining a group splits the results and resets the group's sizes", () => {
        const layout = createLayout(a, b, c);
        const groupA = layout.getGroup(a)!;
        layout.setSizes(groupA.id, [100]);

        layout.move(c, { kind: "joinGroup", groupId: groupA.id, index: 1 });

        expect(groupUris(layout)).to.deep.equal([[a, c], [b]]);
        expect(groupA.sizes).to.be.undefined;
        expect(layout.activeGroupId).to.equal(groupA.id);
        expect(groupA.focusedUri).to.equal(c);
    });

    test("reorders results within a group by their position before the move", () => {
        const layout = createLayout(a, b, c);
        const groupA = layout.getGroup(a)!;
        layout.move(b, { kind: "joinGroup", groupId: groupA.id, index: 1 });
        layout.move(c, { kind: "joinGroup", groupId: groupA.id, index: 2 });

        layout.move(a, { kind: "joinGroup", groupId: groupA.id, index: 3 });
        expect(groupA.uris).to.deep.equal([b, c, a]);

        layout.move(a, { kind: "joinGroup", groupId: groupA.id, index: 0 });
        expect(groupA.uris).to.deep.equal([a, b, c]);
    });

    test("moving a result to a new group places it at the given position", () => {
        const layout = createLayout(a, b, c);
        const groupA = layout.getGroup(a)!;
        layout.move(b, { kind: "joinGroup", groupId: groupA.id, index: 1 });

        layout.move(b, { kind: "newGroup", index: 1 });

        expect(groupUris(layout)).to.deep.equal([[a], [b], [c]]);
        expect(layout.activeGroup?.uris).to.deep.equal([b]);
    });

    test("moving a lone result to a new group only changes its place in the list", () => {
        const layout = createLayout(a, b, c);
        const groupA = layout.getGroup(a)!;

        layout.move(a, { kind: "newGroup", index: 3 });

        expect(groupUris(layout)).to.deep.equal([[b], [c], [a]]);
        expect(layout.getGroup(a)).to.equal(groupA);
    });

    test("removing the last result of the active group shows the next group", () => {
        const layout = createLayout(a, b, c);
        layout.focus(b);

        layout.remove(b);
        expect(layout.activeGroup?.uris).to.deep.equal([c]);

        layout.remove(c);
        expect(layout.activeGroup?.uris).to.deep.equal([a]);

        layout.remove(a);
        expect(layout.activeGroup).to.be.undefined;
        expect(layout.groups).to.be.empty;
    });

    test("removing the focused result of a group focuses its neighbour", () => {
        const layout = createLayout(a, b, c);
        const groupA = layout.getGroup(a)!;
        layout.move(b, { kind: "joinGroup", groupId: groupA.id, index: 1 });
        layout.move(c, { kind: "joinGroup", groupId: groupA.id, index: 2 });
        layout.focus(b);

        layout.remove(b);

        expect(groupA.uris).to.deep.equal([a, c]);
        expect(groupA.focusedUri).to.equal(c);
    });

    test("keeps sizes only when they match the group's results", () => {
        const layout = createLayout(a, b);
        const groupA = layout.getGroup(a)!;
        layout.move(b, { kind: "joinGroup", groupId: groupA.id, index: 1 });

        layout.setSizes(groupA.id, [100]);
        expect(groupA.sizes).to.be.undefined;

        layout.setSizes(groupA.id, [30, 70]);
        expect(groupA.sizes).to.deep.equal([30, 70]);
    });

    test("renames a result in place", () => {
        const layout = createLayout(a, b);
        const groupA = layout.getGroup(a)!;
        layout.move(b, { kind: "joinGroup", groupId: groupA.id, index: 1 });

        layout.rename(b, c);

        expect(groupA.uris).to.deep.equal([a, c]);
        expect(groupA.focusedUri).to.equal(c);
        expect(layout.has(b)).to.be.false;
    });
});
