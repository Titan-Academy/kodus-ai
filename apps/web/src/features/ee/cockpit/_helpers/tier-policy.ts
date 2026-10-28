import type { OrganizationLicense } from "../../subscription/_services/billing/types";

/**
 * Cockpit tier policy — MUST stay aligned with
 * `libs/cockpit/domain/tier-policy.ts` on the backend. Duplicated here
 * because apps/web doesn't import from libs/*.
 *
 * Allowed:
 *   - cloud paid (subscriptionStatus=active) on Teams or Enterprise plans
 *   - licensed self-hosted on any Enterprise plan
 *   - free self-hosted — the community edition is fully featured
 *   - trial (treated as Teams-cloud equivalent)
 */
export function isCockpitTierAllowed(
    license: OrganizationLicense | null | undefined,
): boolean {
    if (!license || !license.valid) return false;

    switch (license.subscriptionStatus) {
        case "active": {
            const plan = license.planType ?? "";
            return plan.startsWith("teams_") || isEnterprisePlan(plan);
        }
        case "licensed-self-hosted": {
            const plan = license.planType ?? "";
            return isEnterprisePlan(plan);
        }
        // Free self-hosted: the dashboard measures the operator's own reviews
        // running on their own machine. Nothing is being metered for Kodus, so
        // there is no tier to fall short of. Mirrors
        // `libs/ee/license/tier/teams-or-enterprise-tier-policy.ts`.
        case "self-hosted":
            return true;
        case "trial":
            return true;
        default:
            return false;
    }
}

function isEnterprisePlan(planType: string): boolean {
    return planType.startsWith("enterprise_") || planType === "enterprise";
}
