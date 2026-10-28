import { isServerSide } from "./server-side";

/**
 * Single-tenant (private) deployment capabilities.
 *
 * One installation, one organization, no plans. The deployment's operator is
 * the tenant, so every surface built around buying, licensing or upgrading a
 * plan is dead weight: it can never be satisfied, and showing it only invites
 * a click that leads nowhere.
 *
 * Deliberately separate from `self-hosted.ts`. A self-hosted install *with* an
 * Enterprise license still wants SSO, activity logs and Cockpit — hiding the
 * paid surfaces is a decision about the deployment, not about how it is
 * hosted. Set `WEB_SINGLE_TENANT=true` (and `API_SINGLE_TENANT=true` on the
 * api, which pins the organization and closes registration).
 *
 * Same runtime-config rule as `isSelfHosted`: the server reads `process.env`,
 * the browser reads the config the root layout injects into
 * `window.__KODUS_PUBLIC_CONFIG__`, so module-scope callers work too.
 */
function getSingleTenantFlag(): boolean {
    if (isServerSide) {
        return (process.env.WEB_SINGLE_TENANT ?? "").toLowerCase() === "true";
    }

    return (
        (globalThis as any).__KODUS_PUBLIC_CONFIG__?.singleTenant === true
    );
}

export const isSingleTenant = getSingleTenantFlag();

/**
 * Destinations a single-tenant deployment removes, and where they lead
 * instead.
 *
 * One list drives both the middleware redirect (`proxy.ts`) and the ⌘K
 * palette's filter, so a hidden page cannot stay reachable by one path and
 * disappear from the other. Every target must itself stay visible — a
 * redirect that lands on another hidden route is a loop.
 */
export const singleTenantRedirects: ReadonlyArray<{
    prefix: string;
    to: string;
}> = [
    // Billing only. The paid *features* (Cockpit, activity logs, custom
    // agents) stay: a free self-hosted install unlocks every one of them,
    // because they run on the operator's own infrastructure. What disappears is
    // the machinery for buying and metering a plan.
    { prefix: "/settings/subscription", to: "/settings" },
    { prefix: "/choose-plan", to: "/settings" },
    // SAML SSO is switched off here by choice, not by tier: this deployment
    // authenticates through the GitHub OAuth app, so the SAML configuration
    // screen is dead weight for the operator. Removing it from the nav alone
    // would leave the page reachable by URL, so the route redirects too —
    // which also drops it from the command palette (`isHiddenRoute`).
    { prefix: "/organization/sso", to: "/organization/general" },
];

/**
 * Where a removed destination leads, or `undefined` when the path is served
 * normally. Prefix-matched so nested routes (`/settings/subscription/@status`)
 * follow their parent.
 */
export const singleTenantRedirectFor = (
    pathname: string,
): string | undefined => {
    if (!isSingleTenant) return undefined;

    return singleTenantRedirects.find(
        ({ prefix }) =>
            pathname === prefix || pathname.startsWith(`${prefix}/`),
    )?.to;
};

/** Whether a destination is removed in this deployment. */
export const isHiddenRoute = (href: string): boolean =>
    singleTenantRedirectFor(href.split("?")[0]) !== undefined;

/**
 * What a single-tenant deployment stops rendering. Read these instead of
 * re-deriving the condition at each call site, so one flag turns the whole
 * edition on or off.
 */
export const edition = {
    /**
     * Plans, checkout, seats, trials, license keys. Covers `/choose-plan`,
     * `/settings/subscription` and the sidebar plan panel.
     */
    hidesBilling: isSingleTenant,
    /** No self-service registration: `/sign-up` redirects to `/sign-in`. */
    closedRegistration: isSingleTenant,
    /**
     * SAML SSO config screen — off by choice in this deployment, which signs in
     * through GitHub OAuth. See `singleTenantRedirects` for the route and the
     * sidebar for the nav entry.
     */
    hidesSso: isSingleTenant,
    /**
     * "Kodus as the provider" — routes over Kodus's own upstream accounts and
     * bills the org's prepaid Kodus credits.
     *
     * This is not a feature tier: it is a billing relationship with Kodus, and
     * a private self-hosted install does not have one, so the option cannot
     * work there. Every *feature* the tier gates used to withhold is unlocked
     * for free self-hosting (see `libs/ee/license/tier/*`); this is the one
     * paid capability that needs Kodus's invoice to exist at all.
     */
    hidesKodusCreditProvider: isSingleTenant,
} as const;
