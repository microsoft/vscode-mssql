/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    GetLocationRequest,
    LocationChangedNotification,
    NavigateNotification,
} from "../../../sharedInterfaces/webviewNavigation";
import { useVscodeWebview } from "../vscodeWebviewProvider";
import { RouteDefinition, RouteMatch, Router } from "./router";

export interface NavigationContextValue<TRoute extends RouteDefinition = RouteDefinition> {
    readonly router: Router<TRoute>;
    /** The current location. */
    readonly match: RouteMatch<TRoute>;
    /** Goes to a location. A location that no route matches goes to the default location. */
    navigate(location: string): void;
}

const NavigationContext = createContext<NavigationContextValue | undefined>(undefined);

/**
 * Owns the location of a page, in component state. It gets the first location from the
 * extension, follows navigate notifications, and reports each change. Renders the children after
 * the first location is known. Create `router` once, at module level.
 */
export function NavigationProvider<TRoute extends RouteDefinition>({
    router,
    children,
}: {
    router: Router<TRoute>;
    children: ReactNode;
}) {
    const { extensionRpc } = useVscodeWebview<unknown, unknown>();
    const [location, setLocation] = useState<string | undefined>(undefined);

    const navigate = useCallback(
        (target: string) => setLocation(router.match(target)?.location ?? router.defaultLocation),
        [router],
    );

    // Listen for navigate notifications before asking for the first location, so none is missed.
    useEffect(() => {
        let disposed = false;
        const subscription = extensionRpc.onNotification(
            NavigateNotification.type,
            ({ location: target }) => navigate(target),
        );
        const start = (target: string) => {
            if (!disposed) {
                setLocation(
                    (current) =>
                        current ?? router.match(target)?.location ?? router.defaultLocation,
                );
            }
        };
        extensionRpc.sendRequest(GetLocationRequest.type).then(
            (params) => start(params.location),
            () => start(router.defaultLocation),
        );
        return () => {
            disposed = true;
            subscription.dispose();
        };
    }, [extensionRpc, navigate, router]);

    useEffect(() => {
        if (location !== undefined) {
            void extensionRpc.sendNotification(LocationChangedNotification.type, { location });
        }
    }, [extensionRpc, location]);

    const value = useMemo<NavigationContextValue<TRoute> | undefined>(() => {
        if (location === undefined) {
            return undefined;
        }
        return {
            router,
            match: router.match(location) ?? router.match(router.defaultLocation)!,
            navigate,
        };
    }, [location, router, navigate]);

    if (!value) {
        return null;
    }
    return (
        <NavigationContext.Provider value={value as unknown as NavigationContextValue}>
            {children}
        </NavigationContext.Provider>
    );
}

/** The location and navigation functions of the page. Use inside a `NavigationProvider`. */
export function useNavigation<
    TRoute extends RouteDefinition = RouteDefinition,
>(): NavigationContextValue<TRoute> {
    const context = useContext(NavigationContext);
    if (!context) {
        throw new Error("useNavigation must be used within a NavigationProvider");
    }
    return context as unknown as NavigationContextValue<TRoute>;
}
