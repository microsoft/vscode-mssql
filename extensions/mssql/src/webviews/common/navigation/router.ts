/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Matches and builds webview locations, for deep links and breadcrumbs. A location is a path and
 * an optional query string, without a leading slash: `queries/913/compare?plans=4,9`. This module
 * has no React or DOM dependency.
 */

export type RouteParams = Readonly<Record<string, string>>;

export interface RouteDefinition {
    /** Unique in the route table. */
    readonly id: string;
    /**
     * Path pattern. Segments are separated by "/", and a segment that starts with ":" is a
     * parameter, for example `queries/:queryId/compare`.
     */
    readonly path: string;
    /**
     * The route before this one in the breadcrumb. Its path parameters must be parameters of this
     * route too, so that the breadcrumb can link to it.
     */
    readonly parent?: string;
    /** The breadcrumb text. Called when the page renders, so it can read localized strings. */
    readonly title: (match: RouteMatch) => string;
}

export interface RouteMatch<TRoute extends RouteDefinition = RouteDefinition> {
    readonly route: TRoute;
    /** The location in canonical form. Equal locations have the same text. */
    readonly location: string;
    readonly params: RouteParams;
    readonly query: RouteParams;
}

export interface Router<TRoute extends RouteDefinition = RouteDefinition> {
    readonly routes: readonly TRoute[];
    /** The location of the default route. An empty location matches it. */
    readonly defaultLocation: string;
    /** Returns undefined for a location that no route matches. */
    match(location: string): RouteMatch<TRoute> | undefined;
    /**
     * Returns the location of a route. Throws a `RangeError` for an unknown route or a missing
     * parameter. Query values that are undefined or empty are left out.
     */
    build(
        routeId: string,
        params?: Readonly<Record<string, string | number>>,
        query?: Readonly<Record<string, string | number | undefined>>,
    ): string;
    /** The match and its parents, from the top route down to the match. For breadcrumbs. */
    ancestry(match: RouteMatch<TRoute>): RouteMatch<TRoute>[];
    /** The top route of the match, for example to select a tab. */
    topRoute(match: RouteMatch<TRoute>): TRoute;
}

interface CompiledRoute<TRoute extends RouteDefinition> {
    readonly route: TRoute;
    readonly segments: readonly string[];
    readonly paramNames: readonly string[];
}

/**
 * Checks the route table and returns its router. Throws an `Error` when the table is not valid:
 * a duplicate id or path, an unknown parent or default route, a parent cycle, or a parent with a
 * parameter that the child does not have.
 */
export function createRouter<TRoute extends RouteDefinition>(
    routes: readonly TRoute[],
    defaultRouteId: string,
): Router<TRoute> {
    const compiled = new Map<string, CompiledRoute<TRoute>>();
    const patterns = new Set<string>();
    for (const route of routes) {
        if (compiled.has(route.id)) {
            throw new Error(`The route "${route.id}" is defined more than once.`);
        }
        const segments = splitPath(route.path);
        const pattern = segments.map((s) => (isParam(s) ? ":" : s)).join("/");
        if (patterns.has(pattern)) {
            throw new Error(`The path of the route "${route.id}" is used by another route.`);
        }
        patterns.add(pattern);
        compiled.set(route.id, {
            route,
            segments,
            paramNames: segments.filter(isParam).map((s) => s.slice(1)),
        });
    }
    for (const { route, paramNames } of compiled.values()) {
        const seen = new Set<string>([route.id]);
        let parentId = route.parent;
        while (parentId !== undefined) {
            const parent = compiled.get(parentId);
            if (!parent) {
                throw new Error(`The parent "${parentId}" of the route "${route.id}" is unknown.`);
            }
            if (seen.has(parentId)) {
                throw new Error(`The parents of the route "${route.id}" form a cycle.`);
            }
            const missing = parent.paramNames.find((name) => !paramNames.includes(name));
            if (missing) {
                throw new Error(
                    `The route "${route.id}" has no parameter "${missing}" for its parent "${parentId}".`,
                );
            }
            seen.add(parentId);
            parentId = parent.route.parent;
        }
    }
    const defaultRoute = compiled.get(defaultRouteId);
    if (!defaultRoute) {
        throw new Error(`The default route "${defaultRouteId}" is unknown.`);
    }
    if (defaultRoute.paramNames.length > 0) {
        throw new Error(`The default route "${defaultRouteId}" must not have parameters.`);
    }

    const build: Router<TRoute>["build"] = (routeId, params = {}, query = {}) => {
        const entry = compiled.get(routeId);
        if (!entry) {
            throw new RangeError(`The route "${routeId}" is unknown.`);
        }
        const path = entry.segments
            .map((segment) => {
                if (!isParam(segment)) {
                    return segment;
                }
                const value = params[segment.slice(1)];
                if (value === undefined || String(value) === "") {
                    throw new RangeError(
                        `The route "${routeId}" needs the parameter "${segment.slice(1)}".`,
                    );
                }
                return encodeURIComponent(String(value));
            })
            .join("/");
        const search = Object.entries(query)
            .filter(([, value]) => value !== undefined && String(value) !== "")
            .map(([key, value]) => `${encodeQueryPart(key)}=${encodeQueryPart(String(value))}`)
            .join("&");
        return search ? `${path}?${search}` : path;
    };

    const toMatch = (
        entry: CompiledRoute<TRoute>,
        params: RouteParams,
        query: RouteParams,
    ): RouteMatch<TRoute> => ({
        route: entry.route,
        location: build(entry.route.id, params, query),
        params,
        query,
    });

    const defaultLocation = build(defaultRouteId);

    return {
        routes,
        defaultLocation,
        match(location) {
            const trimmed = trimLocation(location);
            const queryStart = trimmed.indexOf("?");
            const pathPart = queryStart < 0 ? trimmed : trimmed.slice(0, queryStart);
            const searchPart = queryStart < 0 ? "" : trimmed.slice(queryStart + 1);
            const pathSegments = splitPath(pathPart);
            if (pathSegments.length === 0) {
                return toMatch(defaultRoute, {}, parseQuery(searchPart));
            }
            for (const entry of compiled.values()) {
                const params = matchSegments(entry.segments, pathSegments);
                if (params) {
                    return toMatch(entry, params, parseQuery(searchPart));
                }
            }
            return undefined;
        },
        build,
        ancestry(match) {
            const chain = [match];
            let parentId = match.route.parent;
            while (parentId !== undefined) {
                const parent = compiled.get(parentId)!;
                const params = Object.fromEntries(
                    parent.paramNames.map((name) => [name, match.params[name]]),
                );
                chain.unshift(toMatch(parent, params, {}));
                parentId = parent.route.parent;
            }
            return chain;
        },
        topRoute(match) {
            let route = match.route;
            while (route.parent !== undefined) {
                route = compiled.get(route.parent)!.route;
            }
            return route;
        },
    };
}

function isParam(segment: string): boolean {
    return segment.startsWith(":") && segment.length > 1;
}

function splitPath(path: string): string[] {
    return path.split("/").filter((segment) => segment.length > 0);
}

/** Removes a leading "#" or "/". */
function trimLocation(location: string): string {
    return location.trim().replace(/^#/, "").replace(/^\/+/, "");
}

function matchSegments(
    pattern: readonly string[],
    segments: readonly string[],
): Record<string, string> | undefined {
    if (pattern.length !== segments.length) {
        return undefined;
    }
    const params: Record<string, string> = {};
    for (let index = 0; index < pattern.length; index++) {
        const expected = pattern[index];
        const actual = segments[index];
        if (isParam(expected)) {
            const value = safeDecode(actual);
            if (value === undefined) {
                return undefined;
            }
            params[expected.slice(1)] = value;
        } else if (expected !== actual) {
            return undefined;
        }
    }
    return params;
}

function parseQuery(search: string): RouteParams {
    const query: Record<string, string> = {};
    new URLSearchParams(search).forEach((value, key) => {
        if (value !== "" && !(key in query)) {
            query[key] = value;
        }
    });
    return query;
}

/**
 * Encodes a query key or value. Keeps commas and colons readable, for lists such as `plans=4,9`
 * and times such as `from=2026-09-28T03:00:00Z`.
 */
function encodeQueryPart(value: string): string {
    return encodeURIComponent(value).replace(/%2C/gi, ",").replace(/%3A/gi, ":");
}

function safeDecode(value: string): string | undefined {
    try {
        return decodeURIComponent(value);
    } catch {
        return undefined;
    }
}
