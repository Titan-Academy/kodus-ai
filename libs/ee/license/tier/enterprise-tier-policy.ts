import {
    OrganizationLicenseValidationResult,
    SubscriptionStatus,
} from '../interfaces/license.interface';

/**
 * Enterprise tier policy — single source of truth for "who can access
 * enterprise-only features" (SSO config, user activity logs). Keep the
 * frontend copy in `apps/web/src/features/ee/byok/_utils.ts`
 * (`isEnterprisePlan`) aligned with this when the rule changes.
 *
 * Allowed:
 *   - cloud paid (`active`) on enterprise plans
 *   - licensed self-hosted with `plan: enterprise*` in the signed JWT
 *   - free self-hosted (`self-hosted`) — community installs are fully featured
 *   - trial (treated as enterprise preview)
 *
 * Blocked:
 *   - invalid / canceled / expired / payment_failed
 *   - cloud paid on non-enterprise plans
 *   - licensed self-hosted with a non-enterprise `plan` in the JWT
 */
export function isEnterpriseTierAllowed(
    license: OrganizationLicenseValidationResult | null | undefined,
): boolean {
    if (!license || !license.valid) return false;
    const plan = license.planType ?? '';
    const isEnterprise =
        plan.startsWith('enterprise_') || plan === 'enterprise';

    switch (license.subscriptionStatus) {
        case SubscriptionStatus.ACTIVE:
            return isEnterprise;
        case SubscriptionStatus.LICENSED_SELF_HOSTED:
            return isEnterprise;
        // Community (unlicensed) self-hosted has no tier to fall short of:
        // SSO and activity logs run on the operator's own box. Mirrors
        // `isTeamsOrEnterpriseTierAllowed`.
        case SubscriptionStatus.SELF_HOSTED:
            return true;
        case SubscriptionStatus.TRIAL:
            return true;
        default:
            return false;
    }
}
