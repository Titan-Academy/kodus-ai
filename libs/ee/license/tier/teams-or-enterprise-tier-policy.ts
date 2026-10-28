import {
    OrganizationLicenseValidationResult,
    SubscriptionStatus,
} from '../interfaces/license.interface';

/**
 * Teams or Enterprise tier policy — source of truth for paid-team features
 * (linked repositories / cross-repo context, and cockpit analytics).
 *
 * Keep the frontend mirror in
 * `apps/web/src/features/ee/byok/_utils.ts` (`isTeamsOrEnterprisePlan`)
 * and `apps/web/src/features/ee/cockpit/_helpers/tier-policy.ts` aligned.
 *
 * Allowed:
 *   - cloud paid (`active`) on Teams or Enterprise plans
 *   - licensed self-hosted on any Enterprise plan
 *   - free self-hosted (`self-hosted`) — community installs are fully featured
 *   - trial (treated as Teams-cloud preview)
 *
 * Blocked:
 *   - invalid / expired / canceled / payment_failed
 *   - free_byok (any status)
 *   - licensed self-hosted on Teams plans (Teams is cloud-only)
 */
export function isTeamsOrEnterpriseTierAllowed(
    license: OrganizationLicenseValidationResult | null | undefined,
): boolean {
    if (!license || !license.valid) return false;
    const plan = license.planType ?? '';
    const isTeams = plan.startsWith('teams_');
    const isEnterprise =
        plan.startsWith('enterprise_') || plan === 'enterprise';

    switch (license.subscriptionStatus) {
        case SubscriptionStatus.ACTIVE:
            return isTeams || isEnterprise;
        case SubscriptionStatus.LICENSED_SELF_HOSTED:
            return isEnterprise;
        // No plan to read here: an unlicensed self-hosted install is the
        // community edition, and the features behind this gate run entirely on
        // the operator's own infrastructure. See `shouldLimitResources` in
        // `permissionValidation.service.ts` for the same reasoning.
        case SubscriptionStatus.SELF_HOSTED:
            return true;
        case SubscriptionStatus.TRIAL:
            return true;
        default:
            return false;
    }
}
