import { Page } from "@components/ui/page";
import { getTeamMembers, type TeamMember } from "@services/teams/fetch";
import { getGlobalSelectedTeamId } from "src/core/utils/get-global-selected-team-id";

import { MembersTable } from "./_components/members-table.client";

/**
 * Who is in this workspace and what each of them may do.
 *
 * This is the control that a single-tenant install cannot do without: sign-in
 * is closed to accounts the workspace does not already have (see
 * `SingleTenantService.allowsNewAccount`), so an admin has to be able to see
 * who is in it and change what they are. In the paid product this lived on the
 * subscription screen as seat assignment; with no plans there are no seats, and
 * the meaningful control is the role.
 */
export default async function OrganizationMembersPage() {
    const teamId = await getGlobalSelectedTeamId();

    let members: TeamMember[] = [];
    let loadError: string | undefined;

    try {
        members = await getTeamMembers(teamId);
    } catch (error) {
        // Never render an empty table as if the workspace had no members: an
        // unanswered request and an empty team look identical otherwise, and
        // "everyone is gone" is the wrong thing to tell an admin.
        loadError =
            error instanceof Error ? error.message : "Could not load members";
    }

    return (
        <Page.Root>
            <Page.Header>
                <Page.Title>Members</Page.Title>
                <Page.Description>
                    Who can sign in to this workspace, and what each of them can
                    change.
                </Page.Description>
            </Page.Header>

            <Page.Content>
                <MembersTable
                    teamId={teamId}
                    initialMembers={members}
                    loadError={loadError}
                />
            </Page.Content>
        </Page.Root>
    );
}
