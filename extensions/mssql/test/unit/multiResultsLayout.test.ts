/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { MultiResultsLayout } from "../../src/queryResult/multiResultsLayout";
import { isMultiResultAtTarget } from "../../src/sharedInterfaces/multiResults";

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

    test("moving a result to where it already is only shows it and keeps the sizes", () => {
        const layout = createLayout(a, b, c);
        const groupA = layout.getGroup(a)!;
        layout.move(b, { kind: "joinGroup", groupId: groupA.id, index: 1 });
        layout.setSizes(groupA.id, [30, 70]);
        layout.focus(c);

        layout.move(a, { kind: "joinGroup", groupId: groupA.id, index: 1 });

        expect(groupA.uris).to.deep.equal([a, b]);
        expect(groupA.sizes).to.deep.equal([30, 70]);
        expect(layout.activeGroupId).to.equal(groupA.id);
        expect(groupA.focusedUri).to.equal(a);
    });

    test("only the far side of a neighbouring pane moves a result within its group", () => {
        const layout = createLayout(a, b);
        const groupId = layout.getGroup(a)!.id;
        layout.move(b, { kind: "joinGroup", groupId, index: 1 });

        const isAtIndex = (uri: string, index: number) =>
            isMultiResultAtTarget(layout.groups, uri, { kind: "joinGroup", groupId, index });

        // Index 0 is the left of a, 1 is between a and b, and 2 is the right of b.
        expect(isAtIndex(a, 0), "a over its own left half").to.be.true;
        expect(isAtIndex(a, 1), "a over its own right half or b's left half").to.be.true;
        expect(isAtIndex(a, 2), "a over b's right half").to.be.false;
        expect(isAtIndex(b, 2), "b over its own right half").to.be.true;
        expect(isAtIndex(b, 1), "b over its own left half or a's right half").to.be.true;
        expect(isAtIndex(b, 0), "b over a's left half").to.be.false;
    });

    test("a result is not at a target in another group", () => {
        const layout = createLayout(a, b);
        const groupB = layout.getGroup(b)!;

        expect(
            isMultiResultAtTarget(layout.groups, a, {
                kind: "joinGroup",
                groupId: groupB.id,
                index: 0,
            }),
        ).to.be.false;
    });

    test("only a lone result can already be at a new group target", () => {
        const layout = createLayout(a, b, c);
        const groupC = layout.getGroup(c)!;

        expect(isMultiResultAtTarget(layout.groups, c, { kind: "newGroup", index: 3 })).to.be.true;
        expect(isMultiResultAtTarget(layout.groups, a, { kind: "newGroup", index: 3 })).to.be.false;

        layout.move(b, { kind: "joinGroup", groupId: groupC.id, index: 1 });
        expect(isMultiResultAtTarget(layout.groups, b, { kind: "newGroup", index: 2 })).to.be.false;
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

    test("renaming a result to the name of a listed result replaces that result", () => {
        const layout = createLayout(a, b);

        layout.rename(a, b);

        expect(groupUris(layout)).to.deep.equal([[b]]);
        expect(layout.activeGroup?.uris).to.deep.equal([b]);
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
