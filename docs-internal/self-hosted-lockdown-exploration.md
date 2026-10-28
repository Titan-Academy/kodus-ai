# Self-hosted edition — unlock paid features for free installs, pin one organization, remove sign-ups

Implementation record. Started as an exploration of hiding the paywall; the
decision changed to **unlocking** it for free self-hosting instead.

Target: a single-tenant private deployment. Every tier-gated feature is
available without a license, no cap on imported Kody Rules or MCP plugins, no
plans and no checkout, no self-service registration, and everyone who logs in
belongs to one organization.

**The organising principle:** the caps and tiers this repo enforces exist to
meter work Kodus pays for on cloud — its own model inference, review volume, its
own plugin hosting. A self-hosted operator runs that work on their own machines
and brings their own model keys. Charging them does not meter anything, it just
withholds the UI. So on a non-cloud install, "no license" now means "community
edition, fully featured", not "free tier, capped".

---

## 1. What already exists

Most of the plumbing for this is already here. Do not rebuild it.

| Lever | Where | What it does |
| --- | --- | --- |
| Web edition flag | `apps/web/src/core/utils/self-hosted.ts:15` | `isSelfHosted` = `WEB_NODE_ENV === "self-hosted"`, read from `process.env` on the server and `window.__KODUS_PUBLIC_CONFIG__` in the browser |
| API edition flag | `libs/ee/configs/environment/environment.ts` | `API_CLOUD_MODE`, baked into the bundle at image build; compose overrides it with `API_CLOUD_MODE=${API_CLOUD_MODE:-false}` (`docker-compose.dev.yml:19`) |
| Env declarations | `.env.schema:961` | `WEB_NODE_ENV` is `self-hosted` by installer default, `development` in the dev tree |
| License service | `libs/ee/license/self-hosted-license.service.ts` | Ed25519-signed JWT per organization, 5-minute cache. **Now returns a valid `self-hosted` community license when no key is present or the key cannot be verified** (see §9) |
| Tier policy | `libs/ee/license/tier/enterprise-tier-policy.ts:31` | Enterprise allowed on cloud `active`, licensed self-hosted, trial. **CE self-hosted is explicitly blocked** |
| API tier guard | `libs/ee/license/guards/enterprise-tier.guard.ts` | 403 on enterprise endpoints, fail-closed |
| Feature catalog | `libs/feature-gate/domain/feature-keys.ts:8` | Six beta/stage keys, evaluated by one pure function used by both web and API |
| Web gate resolver | `apps/web/src/core/feature-gate/resolver.ts:50` | Self-hosted short-circuits to `BETA_FEATURES` |

**The important consequence:** in community self-hosted mode today, paid
features are not shown as available — they are shown **locked**. Every gate
already rewords itself for self-hosted:

- `apps/web/src/core/components/system/plan-cta-target.ts:14` — "See plans" becomes "Activate a license"
- `apps/web/src/core/components/system/gate-cta-link.tsx:104` — "upgrade the plan" becomes "activate a license"

So the ask is not "disable paid features". It is **stop rendering the gates and
the padlocks, and stop rendering the billing surfaces underneath them.** That is
a presentation change on top of a gate that already denies.

---

## 2. Ask A — remove paid features from the UI

### Inventory of paid surfaces

| # | Surface | Gate | Files |
| --- | --- | --- | --- |
| 1 | Cockpit, Teams+ | `isCockpitTierAllowed` | `apps/web/src/features/ee/cockpit/_helpers/tier-policy.ts:13`, `/cockpit` layout renders a blurred preview |
| 2 | Cockpit nav entry, always visible with a padlock | same | `apps/web/src/core/layout/navbar/use-main-nav-items.tsx:87` |
| 3 | SSO, Enterprise | `useFeatureGates().sso` | `apps/web/src/core/layout/sidebar/index.tsx:1169`, `/organization/sso` |
| 4 | Activity logs, Enterprise | `useFeatureGates().activityLogs` | `apps/web/src/core/layout/sidebar/index.tsx:1223`, `/user-logs` |
| 5 | Custom agents, Teams+ | `useCustomAgentsPlanAllowed` | `apps/web/src/features/ee/custom-agents/custom-agents-plan-gate.tsx` |
| 6 | Billing: subscription page, plan chooser, seats, trial | `ResourceType.Billing` | `apps/web/src/core/utils/permissions.routes.ts:29`, `apps/web/src/features/ee/subscription/**` (~272 files in `features/ee`) |
| 7 | Plan panel at the sidebar foot ("Community · self-hosted") | license status | `apps/web/src/core/layout/sidebar/plan-status.tsx:316` |
| 8 | Kodus-provider credits and top-up | cloud-only | `apps/web/src/features/ee/byok/**`, `use-kodus-credit-balance` |
| 9 | Trial modals, license-expiry banners, seat modals | license status | `features/ee/subscription/_components/*` |

### Options

**A1 — One edition switch that gates rendering (recommended).**
Extend `self-hosted.ts` into a capability object (`edition.hidesBilling`,
`edition.hidesPaidFeatures`) and consume it in the four places that already
import `isSelfHosted` plus the sidebar/nav item lists. Gates render `null`
instead of `<LockedFeatureOverlay>`. Smallest diff, reversible, keeps upstream
code intact.

- Cost: still ships the EE bundle.
- Risk: any gate render site we miss still shows a padlock.

**A2 — Delete the EE surface from the build.**
Conditional route segments, drop `features/ee/{cockpit,subscription,user-logs}`
from the tree, remove `/choose-plan` and `/settings/subscription`.
Cleanest output, largest diff, and `permissions.route-coverage.spec.ts` +
`permissions.route-manifest.json` must be updated in lockstep or tests fail.

**A3 — Do nothing in the UI.**
Community self-hosted already denies the API and already rewords the CTAs. If
you can live with padlocks that say "Activate a license", this is zero work.

Ask A is also where **the sidebar plan panel (#7) and the billing pages (#6)**
have to be decided separately from the feature gates: hiding "Cockpit" is not
the same decision as removing `/settings/subscription`, which is currently the
only place a self-hosted operator can paste a license key
(`apps/web/src/features/ee/subscription/layout.tsx:47`).

---

## 3. Ask B — restrict sign-in to one organization, auto-assign

### How a user gets created today

Two public endpoints, one funnel:

```
POST /auth/signUp   (@Public, auth.controller.ts:117)  ─┐
                                                        ├─→ SignUpUseCase.execute()
POST /auth/oauth    (@Public, auth.controller.ts:177)  ─┘   (oauth-login.use-case.ts:47)
```

`SignUpUseCase` (`libs/identity/application/use-cases/auth/signup.use-case.ts`)
already contains **both branches** we need:

- `organizationId` supplied → user joins that existing org, `Role.CONTRIBUTOR`,
  team resolved from the org (`:97-101`)
- `organizationId` absent → `generateRandomOrgName`, `Role.OWNER`, a brand-new
  org + tenant is created (`:105-110`)
- status is `ACTIVE` when `preVerified` **or** `!API_CLOUD_MODE`, otherwise
  `PENDING` (`:76-78`); the team member row is active only when
  `isOwner || preVerified` (`:158-162`)

`SignUpDTO.organizationId` is already an accepted optional field
(`libs/identity/dtos/create-user-organization.dto.ts:34`).

### Options

**B1 — Force the organization inside `SignUpUseCase` (recommended).**
When in single-tenant mode: ignore/override the inbound `organizationId` with
one resolved from config, force `preVerified = true`, force
`Role.CONTRIBUTOR` + the org's default team. One choke point covers both
credentials signup and OAuth first-login, because both pass through it.

**B2 — A separate single-tenant use case selected by env** in the controller.
Keeps the cloud path byte-identical, at the cost of a second code path that can
drift from the first.

**B3 — Provider-side restriction instead of (or as well as) app-side.**
Restrict the GitHub App / OAuth app installation to the org's members. Defense in
depth, but not a substitute — the credentials path has no provider to lean on.

### The gaps B has to close

1. **Existing users in other orgs.** `validateUser({email})`
   (`oauth-login.use-case.ts:42`) returns the user as stored. If a matching
   email already exists in some other organization, they log into *that* org,
   not the pinned one. Needs a decision (re-home, or refuse).
2. **What "hardcoded organisation" is keyed to.** A UUID from env requires the
   org to exist first — that means a migration/seed that creates org + tenant +
   default team + an owner, and it must be idempotent on restart.
3. **Email restriction.** Nothing in the repo does domain allowlisting today
   (the `allowedDomains` hits in `libs/` are unrelated: sandbox egress). If
   "only our people" means "only `@yourco.com`", that check belongs next to the
   org override, on the *verified* email — `verifyOAuthProviderEmail`
   (`oauth-login.use-case.ts:36`) already gives us a trusted address, and it
   deliberately ignores the request body's email.
4. **Password reset / email confirmation** still work and still send mail. Fine,
   but they are the remaining paths that touch user records.

---

## 4. Ask C — remove sign-ups

### Inventory

| Piece | Where |
| --- | --- |
| Route page | `apps/web/src/app/(auth)/sign-up/page.tsx` |
| Middleware allowlist | `apps/web/src/proxy.ts:32` (`authPaths`), which also bypasses auth for `/sign-up` |
| Sign-in page link | `apps/web/src/app/(auth)/sign-in/page.tsx:53` ("Sign up for free") |
| Registration form | `apps/web/src/app/(auth)/components/register-page-content.tsx` |
| API endpoint | `POST /auth/signUp`, `@Public()`, `apps/api/src/controllers/auth.controller.ts:117` |

Removing the page without removing the endpoint leaves an open registration API
behind the UI. Both have to go, and the endpoint should fail closed
(404/410/403), not merely disappear from the nav.

### The consequence to decide

**If sign-ups are gone, how does a brand-new colleague get an account?**

- **C1 — OAuth first login creates them.** Keep `POST /auth/oauth`; the account
  is created implicitly inside the pinned org at first login. There is no form
  and no `/sign-up` page. This is the only flow that requires no admin action.
- **C2 — Invite-only.** An admin invites from `/organization`; the existing
  accept-invitation path (`accept-user-invitation.use-case.ts`) creates the
  user in the org. `/invite/*` stays in `authPaths`. Strongest control, needs an
  admin for every joiner.
- **C3 — Both.** OAuth for allowlisted domains, invite for everyone else.

Note this interacts with B: if C2 only, the "auto-assign" work is mostly the
existing invitation flow plus forcing the org.

---

## 5. Open decisions

1. **First-login path** — C1 (OAuth auto-provision), C2 (invite-only), or C3.
2. **Who is allowed** — email-domain allowlist, explicit email list, or anyone
   the OAuth provider authenticates.
3. **Existing data** — this dev tree has multiple orgs (`scripts/preview/seed-preview-org.ts`).
   Do we wipe, or migrate members into the pinned org?
4. **Hide vs delete** — A1 (render nothing) or A2 (remove the code).
5. **Keep `/settings/subscription`?** It is the only license-activation surface.
   Hiding billing entirely also hides the way to paste a license key.
6. **Owner of the pinned org** — seeded account, first OAuth login promoted, or
   an env-provided email.

---

## 6. Test surface that will move

- `libs/identity/application/use-cases/auth/signup.use-case.spec.ts` (181 lines)
  and `oauth-login.use-case.spec.ts` (116 lines) — both encode the
  "creates a new org" behaviour.
- `apps/web/src/core/utils/permissions.route-coverage.spec.ts` walks
  `app/(app)` and fails when a route is unmapped; `permissions.route-manifest.json`
  pins expected role/route outcomes. Removing any page requires both.
- `apps/web/src/core/layout/sidebar/plan-status.self-hosted.spec.tsx`,
  `core/components/system/gate-cta-link.spec.tsx`,
  `features/ee/custom-agents/custom-agents-plan-gate.spec.tsx` — all assert the
  current "locked, with a license CTA" behaviour.
- `apps/web/src/core/utils/self-hosted.spec.ts` — the edition flag itself.

---

## 7. Decided

| Question | Decision |
| --- | --- |
| Paid features | Hide, do not delete. Code and EE bundle stay in place |
| New accounts | OAuth first login auto-provisions into the pinned org |
| Who is allowed | Anyone the provider verifies — no domain allowlist |
| Billing | Removed from the UI entirely, `/settings/subscription` included |

Since billing goes away and paid features are hidden, no license is ever
needed: the app runs permanently on the community self-hosted default
(`{valid:true, subscriptionStatus:"self-hosted"}`, `fetch.ts:290`). That is
self-consistent — do not leave a license-activation path behind.

### On hiding with CSS

CSS is the wrong tool for the two route-level pieces and unnecessary for the
rest. A route such as `/settings/subscription` is a server component with
parallel routes (`@status`, `@licenses`, `@admins`); overlaying it with
`display:none` still executes its data fetching, still hits billing endpoints,
and still 500s if those are unavailable. The cheaper and safer split:

- **Routes** — a guard that redirects (see step 2), not CSS.
- **Nav items and menus** — `visible: false` in the item arrays, not CSS.
- **In-page gates** — return `null` from the gate wrapper, not CSS.

Same amount of work, no phantom network calls, no hidden DOM carrying data the
viewer should not see.

---

## 8. Implementation plan

One switch drives all of it, next to the existing edition flag
(`apps/web/src/core/utils/self-hosted.ts`):

```ts
export const edition = {
    hidesBilling: isSelfHosted,
    hidesPaidFeatures: isSelfHosted,
    singleTenantOrganization: isSelfHosted,
};
```

Keep it a plain object of booleans so it can be read from module scope (the same
constraint `self-hosted.ts` documents at its top).

### Step 1 — hide the paid surfaces (web)

Render-null / `visible: false`, no deletions:

| Surface | Change |
| --- | --- |
| Cockpit nav item | `use-main-nav-items.tsx:80` — `visible: false`, drop the `LockIcon` badge |
| Cockpit route | `features/ee/cockpit/layout.tsx` — redirect when hidden |
| SSO (org nav + page) | `sidebar/index.tsx:1191`, `features/ee/sso/page.tsx` |
| Activity logs (org nav + page) | `sidebar/index.tsx:1223`, `features/ee/user-logs/page.tsx` |
| Subscription (org nav) | `sidebar/index.tsx:1213` |
| Plan panel, sidebar foot | `SidebarPlanStatus` in `core/layout/sidebar/index.tsx` — render nothing (its `HREF` is the page being removed) |
| Command palette entry | `core/layout/navbar/_components/command-palette.tsx:160` |
| Custom agents gate | `features/ee/custom-agents/custom-agents-plan-gate.tsx` — return `null` for both the gate and its entry point |
| Kodus-provider credits / top-up | `features/ee/byok/**`, `use-kodus-credit-balance` consumers |
| Trial / seat / license modals | `features/ee/subscription/_components/{finished-trial-modal,no-more-licenses-modal,...}` |

### Step 2 — remove billing (web)

- `/choose-plan` (`app/(app)/choose-plan/page.tsx`) and
  `/settings/subscription` (`app/(app)/settings/subscription/**`) redirect to
  `/pull-requests` when hidden. Keep the files — the redirect lives in the page
  or its layout, so no route-manifest entry is orphaned.
- `app/(setup)/setup/subscription/{,cancel,success}/page.tsx` currently redirect
  to `/settings/subscription` and would land on the redirect chain — point them
  at the post-setup destination instead.
- `/forbidden` keeps its prefix→label map (`app/forbidden/page.tsx:14`); it is
  unreachable once the routes redirect, not broken.

### Step 3 — pin the organization (api)

Single choke point in `libs/identity/application/use-cases/auth/signup.use-case.ts`,
because both creation paths land there:

1. Read the pinned org from env (`SINGLE_TENANT_ORGANIZATION_ID`). Fail fast at
   boot if single-tenant mode is on and the value is missing or does not resolve
   — a silent fallback to "create a new org" is the one failure mode that
   quietly breaks the whole point.
2. When single-tenant: ignore the inbound `organizationId`, set
   `preVerified: true`, force `Role.CONTRIBUTOR`, resolve the org's default team.
   That flips status to `ACTIVE` (`:76-78`) and activates the team member row
   (`:158-162`), so `/user-waiting-for-approval` is never reached.
3. If the email already exists in a **different** org: refuse with a clear
   message rather than silently logging them into the wrong tenant. (Open, but
   this is the safe default.)
4. Seed: idempotent bootstrap that creates the org + tenant + default team +
   owner when the pinned org does not exist yet, so a fresh volume comes up
   usable.

### Step 4 — close registration

- `POST /auth/signUp` (`apps/api/src/controllers/auth.controller.ts:117`) — in
  single-tenant mode, reject (403 or 410). Keep `POST /auth/oauth` public: it is
  now the only account-creation path.
- `/sign-up` page renders a redirect to `/sign-in`; drop the
  `app/(auth)/sign-in/page.tsx:53` link and the `proxy.ts:32` allowlist entry
  (leave `authPaths` intact otherwise — `/invite/*` and `/sso-callback` still
  need it).
- `/invite/*` (`accept-user-invitation.use-case.ts`) is a *second* creation path
  that can place a user in an org other than the pinned one. Default: disable
  acceptance in single-tenant mode, since OAuth now covers every joiner.

### Step 5 — the provisioner will break

`scripts/selfhosted/provision.sh` calls `POST /auth/signUp` twice — the dev user
(~`:804`) and four smoke tenants, one per git provider (~`:841`). The smoke
tenants exist precisely to keep one tenant per provider, which single-tenant
mode removes by definition. Either the fork stops running that half of the
provisioner, or it gets a privileged bootstrap path (env-provided admin
credentials, `preVerified`) that bypasses the closed endpoint. This has to be
decided together with step 4, not after it.

### Verification

- `pnpm --filter kodus-web check-types` and `pnpm run lint` for the web changes.
- `libs/identity/application/use-cases/auth/{signup,oauth-login}.use-case.spec.ts`
  — rewrite the "creates an organization" expectations; they currently encode
  the behaviour being inverted.
- `apps/web/src/core/utils/permissions.route-coverage.spec.ts` +
  `permissions.route-manifest.json` — the manifest asserts reachability, so a
  redirecting route needs its expected outcome updated.
- `plan-status.self-hosted.spec.tsx`, `gate-cta-link.spec.tsx`,
  `custom-agents-plan-gate.spec.tsx`, `self-hosted.spec.ts`.
- End to end on a clean volume: fresh OAuth login lands as `CONTRIBUTOR` in the
  pinned org, no padlock anywhere in the sidebar, `/settings/subscription` and
  `/choose-plan` unreachable, `/sign-up` redirects, and
  `POST /auth/signUp` refuses.

---

## 9. As built — free self-hosting is fully featured

Supersedes §2 and the billing half of §7. The paywall is not hidden; it is
**lifted** for unlicensed self-hosted installs.

### The one status that carries the decision

`SelfHostedLicenseService` is only bound when `API_CLOUD_MODE` is false, so "no
valid key" there is not a lapsed subscription — it is the normal state of a free
install. It now reports a valid **community** license:

```ts
// libs/ee/license/self-hosted-license.service.ts
private communityLicense(): OrganizationLicenseValidationResult {
    return { valid: true, subscriptionStatus: SubscriptionStatus.SELF_HOSTED };
}
```

Returned for all three non-cloud cases: no key, key that fails verification, and
expired key. An unreadable key must never be worse than no key — otherwise
pasting something malformed silently locks an install that was working.

This also removes the old API/web asymmetry: the web already modelled CE as
`{ valid: true, subscriptionStatus: "self-hosted" }`
(`features/ee/subscription/_services/billing/fetch.ts`), while the API said
`{ valid: false }`. Both now agree.

### What each gate does with it

| Gate | File | Now |
| --- | --- | --- |
| Cockpit / dashboard | `libs/ee/license/tier/teams-or-enterprise-tier-policy.ts` | `self-hosted` → allowed |
| SSO, activity logs | `libs/ee/license/tier/enterprise-tier-policy.ts` | `self-hosted` → allowed |
| Custom agents, linked repos | same Teams+ policy | `self-hosted` → allowed |
| Rules cap + **MCP plugin cap** | `libs/ee/shared/services/permissionValidation.service.ts` `shouldLimitResources` | `self-hosted` → `false` (uncapped) |
| **Kody Rules imported limit** | same file, `resolveGlobalRulesImportTier` | `self-hosted` → `'paid'` → `limit: null` (unlimited) |

Web mirrors kept aligned: `features/ee/cockpit/_helpers/tier-policy.ts`,
`features/ee/byok/_utils.ts` (`isEnterprisePlan`, `isTeamsOrEnterprisePlan`),
`lib/services/mcp-manager/use-mcp-plugins-limit.ts`.

Both caps move together on purpose: `shouldLimitResources` is the single switch
behind the paused-rules behaviour **and** the plugin slice in
`libs/mcp-server/services/mcp-manager.service.ts`, so lifting it in one place is
what makes "no rules cap and no plugin cap" true rather than two independent
fixes that can drift.

### What still disappears (single-tenant only, `WEB_SINGLE_TENANT`)

`apps/web/src/core/utils/edition.ts`:

- `hidesBilling` — `/settings/subscription` and `/choose-plan` redirect to
  `/settings` via `proxy.ts`; the sidebar plan panel and the palette entry go.
- `closedRegistration` — `/sign-up` redirects to `/sign-in`; `POST /auth/signUp`
  refuses in single-tenant mode.
- `hidesKodusCreditProvider` — "Kodus as the provider" is **not** a feature
  tier: it routes over Kodus's own upstream accounts against prepaid Kodus
  credits, which needs a billing relationship with Kodus that a private install
  does not have. Every *feature* the tier gates withheld is unlocked; this one
  cannot work at all, so the option is not offered.

### Auth (unchanged from §8, steps 3–4)

`SingleTenantService` + `SignUpUseCase` pin every account to one organization
(`API_SINGLE_TENANT`, `API_SINGLE_TENANT_ORGANIZATION_NAME`); first account owns
it, later ones join as contributors; `AuthService.login` rejects any account
from another organization; `POST /auth/oauth` is the only way in.

### Verification

- `libs/ee` — 72 tests (license + permission validation, including 4 new ones
  pinning "free self-hosted is uncapped").
- `libs/cockpit` — 104 tests.
- `apps/web` — 1019 tests.
- `libs/identity` auth specs — green.
- Typecheck: no new errors in either app (web 58 pre-existing, api/libs 4108
  pre-existing; none in touched files).
- Two suites fail locally for environment reasons only:
  `user.repository.getLoginData.integration.spec.ts` (Postgres unreachable) and
  `cli-sandbox-scripts.spec.ts` (shell stderr noise from `~/.bashrc`).
