/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RouteDefinition, createRouter } from "../../src/webviews/common/navigation/router";
import {
    comparedPlanIds,
    pageQuery,
    performanceDashboardRouter,
    performanceDashboardTabs,
    settingsSectionOf,
    withSettings,
} from "../../src/webviews/pages/PerformanceDashboard/performanceDashboardRoutes";

const title = () => "";

const routes: RouteDefinition[] = [
    { id: "home", path: "home", title },
    { id: "items", path: "items", title },
    { id: "item", path: "items/:itemId", parent: "items", title },
    { id: "itemPart", path: "items/:itemId/parts/:partId", parent: "item", title },
];

suite("Webview navigation router", () => {
    const router = createRouter(routes, "home");

    test("matches a path with parameters and a query string", () => {
        const match = router.match("items/42/parts/a%20b?view=grid&empty=");

        expect(match?.route.id).to.equal("itemPart");
        expect(match?.params).to.deep.equal({ itemId: "42", partId: "a b" });
        expect(match?.query).to.deep.equal({ view: "grid" });
        expect(match?.location).to.equal("items/42/parts/a%20b?view=grid");
    });

    test("ignores a leading slash or hash and extra slashes", () => {
        expect(router.match("/items/42")?.location).to.equal("items/42");
        expect(router.match("#items//42/")?.location).to.equal("items/42");
    });

    test("matches an empty location to the default route", () => {
        expect(router.defaultLocation).to.equal("home");
        expect(router.match("")?.route.id).to.equal("home");
        expect(router.match("?x=1")?.location).to.equal("home?x=1");
    });

    test("does not match an unknown or malformed location", () => {
        expect(router.match("missing")).to.be.undefined;
        expect(router.match("items/42/extra")).to.be.undefined;
        expect(router.match("items/%E0%A4%A")).to.be.undefined;
    });

    test("builds locations and encodes the values", () => {
        expect(router.build("item", { itemId: "a/b" })).to.equal("items/a%2Fb");
        expect(router.build("items", {}, { plans: "4,9", sort: undefined, q: "" })).to.equal(
            "items?plans=4,9",
        );
        expect(router.build("itemPart", { itemId: 7, partId: 8 })).to.equal("items/7/parts/8");
        expect(router.build("home", {}, { from: "2026-09-28T03:00:00Z" })).to.equal(
            "home?from=2026-09-28T03:00:00Z",
        );
    });

    test("does not build an unknown route or a route without its parameters", () => {
        expect(() => router.build("missing")).to.throw(RangeError);
        expect(() => router.build("item")).to.throw(RangeError, /itemId/);
    });

    test("returns the ancestry with the parameters of each parent", () => {
        const match = router.match("items/42/parts/7?view=grid")!;

        expect(router.ancestry(match).map((ancestor) => ancestor.location)).to.deep.equal([
            "items",
            "items/42",
            "items/42/parts/7?view=grid",
        ]);
        expect(router.topRoute(match).id).to.equal("items");
    });

    test("rejects a route table that is not valid", () => {
        expect(() =>
            createRouter([...routes, { id: "home", path: "other", title }], "home"),
        ).to.throw(/more than once/);
        expect(() =>
            createRouter([...routes, { id: "copy", path: "items/:x", title }], "home"),
        ).to.throw(/used by another route/);
        expect(() =>
            createRouter([{ id: "a", path: "a", parent: "missing", title }], "a"),
        ).to.throw(/unknown/);
        expect(() =>
            createRouter(
                [
                    { id: "a", path: "a", parent: "b", title },
                    { id: "b", path: "b", parent: "a", title },
                ],
                "a",
            ),
        ).to.throw(/cycle/);
        expect(() =>
            createRouter(
                [
                    { id: "parent", path: "p/:id", title },
                    { id: "child", path: "c", parent: "parent", title },
                ],
                "child",
            ),
        ).to.throw(/no parameter "id"/);
        expect(() => createRouter(routes, "missing")).to.throw(/default route/);
        expect(() => createRouter(routes, "item")).to.throw(/must not have parameters/);
    });
});

suite("Performance dashboard routes", () => {
    const router = performanceDashboardRouter;
    const crumbs = (location: string) =>
        router.ancestry(router.match(location)!).map((match) => match.route.title(match));

    test("has tabs for the overview and queries, and opens at the overview", () => {
        expect(performanceDashboardTabs.map((tab) => tab.id)).to.deep.equal([
            "overview",
            "queries",
        ]);
        expect(router.defaultLocation).to.equal("overview");
    });

    test("has no pages for removed tabs", () => {
        for (const location of ["setup", "activity", "changes"]) {
            expect(router.match(location), location).to.be.undefined;
        }
    });

    test("opens the settings dialog over a page with a query value", () => {
        const overview = router.match("overview?range=7d")!;
        const withDialog = withSettings(overview, "queryStore");

        expect(withDialog).to.equal("overview?range=7d&settings=queryStore");
        expect(settingsSectionOf(router.match(withDialog)!)).to.equal("queryStore");
        expect(pageQuery(router.match(withDialog)!)).to.deep.equal({ range: "7d" });
        expect(withSettings(router.match(withDialog)!, undefined)).to.equal("overview?range=7d");
        expect(settingsSectionOf(router.match("overview?settings=unknown")!)).to.be.undefined;
        expect(withSettings(router.match("queries/913")!, "queryStore")).to.equal(
            "queries/913?settings=queryStore",
        );
    });

    test("builds the breadcrumb of a plan compare location", () => {
        const location = router.build("comparePlans", { queryId: 913 }, { plans: "4,9" });

        expect(location).to.equal("queries/913/compare?plans=4,9");
        expect(crumbs(location)).to.deep.equal(["Queries", "Query 913", "Compare plans 4 and 9"]);
        expect(router.topRoute(router.match(location)!).id).to.equal("queries");
        expect(comparedPlanIds(router.match(location)!)).to.deep.equal(["4", "9"]);
    });

    test("names a plan compare without two plans", () => {
        expect(crumbs("queries/913/compare")).to.deep.equal([
            "Queries",
            "Query 913",
            "Compare plans",
        ]);
    });
});
