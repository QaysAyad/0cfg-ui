import {injectable} from 'inversify';
import {BufferQueue} from '@0cfg/utils-common/lib/BufferQueue';
import {Sequential} from '@0cfg/utils-common/lib/Sequential';
import {Predicate} from '@0cfg/utils-common/lib/Predicate';
import {has} from '@0cfg/utils-common/lib/has';
import micromatch from 'micromatch';

const ROUTING_QUEUE_LENGTH = 20;
export type ListenerRemovalFunction = () => void;

/*
* Guaranteed serializable version of the window.location object in the browser.
* This is necessary to save the properties at one point in time and reuse them later.
 */
export interface SerializableLocation {
    /**
     * Returns the Location object's URL's fragment (includes leading "#" if non-empty).
     *
     * Can be set, to navigate to the same URL with a changed fragment (ignores leading "#").
     */
    readonly hash: string;
    /**
     * Returns the Location object's URL's host and port (if different from the default port for the scheme).
     *
     * Can be set, to navigate to the same URL with a changed host and port.
     */
    readonly host: string;
    /**
     * Returns the Location object's URL's host.
     *
     * Can be set, to navigate to the same URL with a changed host.
     */
    readonly hostname: string;
    /**
     * Returns the Location object's URL.
     *
     * Can be set, to navigate to the given URL.
     */
    readonly href: string;
    /**
     * Returns the Location object's URL's origin.
     */
    readonly origin: string;
    /**
     * Returns the Location object's URL's path.
     *
     * Can be set, to navigate to the same URL with a changed path.
     */
    readonly pathname: string;
    /**
     * Returns the Location object's URL's port.
     *
     * Can be set, to navigate to the same URL with a changed port.
     */
    readonly port: string;
    /**
     * Returns the Location object's URL's scheme.
     *
     * Can be set, to navigate to the same URL with a changed scheme.
     */
    readonly protocol: string;
    /**
     * Returns the Location object's URL's query (includes leading "?" if non-empty).
     *
     * Can be set, to navigate to the same URL with a changed query (ignores leading "?").
     */
    readonly search: string;
}

const serialize = (location: Location): SerializableLocation => ({
    hash: location.hash,
    hostname: location.hostname,
    pathname: location.pathname,
    search: location.search,
    host: location.host,
    href: location.href,
    origin: location.origin,
    port: location.port,
    protocol: location.protocol,
});

export type UrlChangeListener = (location: SerializableLocation) => Promise<void> | void;

/**
 * Regex matching on location.pathname.
 */
export const regex = (regex: RegExp): Predicate<SerializableLocation> =>
    (location: SerializableLocation) => regex.test(location.pathname);

/**
 * Comparison with location.pathname.
 */
 export const path = (path: string): Predicate<SerializableLocation> =>
 (location: SerializableLocation) => path === location.pathname || path === `${location.pathname}/`;

/**
 * Exact comparison with location.pathname.
 */
export const exactPath = (path: string): Predicate<SerializableLocation> =>
    (location: SerializableLocation) => path === location.pathname;

/**
 * Glob matching agains location.pathname.
 * Supports:
 * - Wildcards (**, *.js)
 * - Negation ('!a/*.js', '*!(b).js'])
 * - extglobs (+(x|y), !(a|b))
 * - POSIX character classes ([[:alpha:][:digit:]])
 * - brace expansion (foo/{1..5}.md, bar/{a,b,c}.js)
 * - regex character classes (foo-[1-5].js)
 * - regex logical "or" (foo/(abc|xyz).js)
 */
export const glob = (pattern: string): Predicate<SerializableLocation> =>
    (location: SerializableLocation) => micromatch.isMatch(location.pathname, pattern);

type Detour = { readonly condition: Predicate<SerializableLocation> | undefined, readonly handler: UrlChangeListener }

/**
 * Generic SPA router intended to be used in the entry point of a frontend application,
 * or in components which want to perform actions if a certain link was loaded.
 * Note that it is (even though most probably not common) possible and intended to be able to have multiple
 * routers per app, if both serve a different purpose and do not extend on each other.
 *
 * Components can handle route-away's like so:
 * router.onUrlChange(page.show, path("/page")).onUrlChange(page.hide, not(path("/page"));
 */
@injectable()
export class Router {

    private readonly urlChangeListeners: Detour[] = [];
    private readonly routingQueue: BufferQueue<SerializableLocation> =
        new BufferQueue<SerializableLocation>(ROUTING_QUEUE_LENGTH);
    private routing: boolean = false;

    // prevent inheritance, allow singleton
    private constructor(basePath: string = '/') {
        window.addEventListener('unload', (e) => {
            if (location.pathname.startsWith(basePath)) {
                e.preventDefault();
                document.dispatchEvent(new Event('popstate'));
            }
        });
        window.addEventListener('popstate', (e: PopStateEvent) => {
            e.preventDefault();
            this.enqueueCurrentRoute();
        });
    }

    /**
     * Create a new router.
     */
    public static create(basePath: string = '/') {
        return new Router(basePath);
    }

    /**
     * Register a listener which will be executed if the current url in the browser changed.
     * @param condition the listener will be executed on a url if the condition is undefined or evaluates to true.
     * Use to improve readability for simple conditions (e.g. location.pathname === "app").
     */
    public onUrlChange(listener: UrlChangeListener, condition?: Predicate<SerializableLocation>): this {
        this.urlChangeListeners.push({handler: listener, condition: condition});
        return this;
    }

    /**
     * Set the current url in the browser.
     */
    public setUrl(url: string): this {
        history.pushState({url}, '', url);
        return this;
    }

    /**
     * Set the current url and execute listeners.
     */
    public navigateTo(url: string): this {
        this.setUrl(url);
        this.enqueueCurrentRoute();
        return this;
    }

    public enqueueCurrentRoute(): void {
        this.routingQueue.push(serialize(window.location));
        if (this.routingQueue.size() !== 1 || this.routing) {
            return;
        }
        (async () => {
            this.routing = true;
            while (!this.routingQueue.isEmpty()) {
                await this.execRoute(this.routingQueue.pop()!);
            }
            this.routing = false;
        })();
    }

    private async execRoute(location: SerializableLocation): Promise<void> {
        for (const listener of this.urlChangeListeners) {
            if (!has(listener.condition) || listener.condition(location)) {
                await listener.handler(location);
            }
        }
    }

}


/**
 * Get the URL parameters
 * source: https://css-tricks.com/snippets/javascript/get-url-variables/
 *
 * @return {Object} The URL parameters
 */
export const getUrlParams = (url: string): Record<string, string> => {
    const params: Record<string, string> = {};
    const parser = document.createElement('a');
    parser.href = url;
    const query = parser.search.substring(1);
    const vars = query.split('&');
    for (let i = 0; i < vars.length; i++) {
        const pair = vars[i].split('=');
        params[pair[0]] = decodeURIComponent(pair[1]);
    }
    return params;
};
