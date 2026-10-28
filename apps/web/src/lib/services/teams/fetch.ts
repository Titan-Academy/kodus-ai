import { authorizedFetch } from "@services/fetch";
import type { UserRole } from "@enums";
import { axiosAuthorized } from "src/core/utils/axios";

import { TEAMS_PATHS } from ".";
import { Team, TeamWithIntegrations } from "./types";

export const getTeams = () =>
    authorizedFetch<Team[]>(TEAMS_PATHS.LIST_ALL, {
        next: { tags: ["teams-list"] },
    });

export const getTeamsWithIntegrations = async (): Promise<
    { data: TeamWithIntegrations[] } | { error: string }
> => {
    try {
        const response = await axiosAuthorized.fetcher(
            TEAMS_PATHS.LIST_WITH_INTEGRATIONS,
        );

        return response;
    } catch (error: any) {
        return { error: error.response?.status || "Unknown error" };
    }
};

/** A member of the workspace team, as the members screen lists them. */
export type TeamMember = {
    uuid?: string;
    userId?: string;
    name: string;
    email: string;
    role: UserRole;
    teamRole?: string;
    active: boolean;
    avatar?: string;
};

export const getTeamMembers = async (
    teamId: string,
): Promise<TeamMember[]> => {
    // The endpoint answers `{ members: [...] }`; `authorizedFetch` unwraps the
    // outer `{ data }` envelope but not this one.
    const response = await authorizedFetch<{ members: TeamMember[] }>(
        TEAMS_PATHS.MEMBERS(teamId),
    );

    return response?.members ?? [];
};
