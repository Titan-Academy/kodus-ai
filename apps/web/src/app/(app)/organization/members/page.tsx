import { Page } from "@components/ui/page";
import { getTeamMembers, type TeamMember } from "@services/teams/fetch";
import { getGlobalSelectedTeamId } from "src/core/utils/get-global-selected-team-id";

import { MembersTable } from "./_components/members-table.client";

/**
 * Who is in this workspace and what each of them may do.
 *
 * Admission happens in the API (a GitHub login must belong to the configured
 * organisation), so this screen is about the people who are already in: their
 * role, and whether they may still sign in. In the paid product this lived on
 * the subscription screen as seat assignment; with no plans there are no seats,
 * and the meaningful control is the role.
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
                    initialMembers={members}
                    loadError={loadError}
                />
            </Page.Content>
        </Page.Root>
    );
}
