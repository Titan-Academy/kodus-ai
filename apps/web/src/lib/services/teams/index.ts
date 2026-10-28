import { SETUP_PATHS } from "@services/setup";
import { pathToApiUrl } from "src/core/utils/helpers";

export const TEAMS_PATHS = {
    LIST_ALL: pathToApiUrl("/team"),
    LIST_WITH_INTEGRATIONS: pathToApiUrl("/team/list-with-integrations"),
    UPDATE: pathToApiUrl("/team"),
    CREATE: pathToApiUrl("/team"),
    DELETE: pathToApiUrl("/team"),
    GET_TEAM_BY_ID: pathToApiUrl("/team/get-by-id"),
    FIRST_CREATED_TEAM: pathToApiUrl("/team/first-created"),
    // `team-members`, not `team/members` — the controller is
    // `@Controller('team-members')`. Reuses the constant the invite flow posts
    // to, so the two cannot disagree about the route.
    MEMBERS: (teamId: string) =>
        `${SETUP_PATHS.TEAM_MEMBERS}?teamId=${encodeURIComponent(teamId)}`,
} as const;
