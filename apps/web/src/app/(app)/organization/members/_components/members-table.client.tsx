"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { useToast } from "@components/ui/toaster/use-toast";
import type { TeamMember } from "@services/teams/fetch";
import { updateUser } from "@services/users/fetch";
import { UserRole, UserStatus } from "@enums";
import { useAuth } from "src/core/providers/auth.provider";

/**
 * Roles offered for assignment. `billing_manager` is deliberately absent: there
 * is no billing on this install, so the role grants nothing.
 */
const ASSIGNABLE_ROLES = [
    { value: UserRole.OWNER, label: "Owner" },
    { value: UserRole.REPO_ADMIN, label: "Repo admin" },
    { value: UserRole.CONTRIBUTOR, label: "Contributor" },
] as const;

const ROLE_LABEL: Record<string, string> = {
    [UserRole.OWNER]: "Owner",
    [UserRole.BILLING_MANAGER]: "Billing manager",
    [UserRole.REPO_ADMIN]: "Repo admin",
    [UserRole.CONTRIBUTOR]: "Contributor",
};

// A native select, styled with the design tokens. The DS `Select` is raw Radix
// with no composition in the codebase yet; three fixed options do not justify
// inventing one here.
const ROLE_SELECT_CLASS =
    "h-8 rounded-lg bg-card-lv2 px-2 text-sm text-text-primary ring-1 ring-card-lv3 " +
    "outline-none focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Who is in the workspace and what each of them may do.
 *
 * Admission is handled by the API, not here: a GitHub login has to belong to
 * the configured organisation to get an account at all. So this screen does not
 * invite anybody — it manages the people who already got in: their role, and
 * whether they may still sign in.
 */
export const MembersTable = ({
    initialMembers,
    loadError,
}: {
    initialMembers: TeamMember[];
    loadError?: string;
}) => {
    const [members, setMembers] = useState(initialMembers);
    const [savingUserId, setSavingUserId] = useState<string | undefined>();
    const { toast } = useToast();
    const router = useRouter();
    const { userId: currentUserId } = useAuth();

    const patch = useCallback(
        async (
            member: TeamMember,
            data: { role?: UserRole; status?: UserStatus },
            optimistic: (row: TeamMember) => TeamMember,
            title: string,
        ) => {
            const id = member.userId;
            if (!id) return;

            const previous = members;

            setSavingUserId(id);
            setMembers((rows) =>
                rows.map((row) => (row.userId === id ? optimistic(row) : row)),
            );

            try {
                await updateUser(id, data);
                toast({ title, variant: "success" });
                // Nav and screens re-derive from the session role.
                router.refresh();
            } catch (error) {
                setMembers(previous);
                toast({
                    title: "Could not save that change",
                    description:
                        error instanceof Error
                            ? error.message
                            : "Please try again.",
                    variant: "danger",
                });
            } finally {
                setSavingUserId(undefined);
            }
        },
        [members, router, toast],
    );

    const changeRole = (member: TeamMember, role: UserRole) =>
        patch(
            member,
            { role },
            (row) => ({ ...row, role }),
            `${member.name} is now ${ROLE_LABEL[role] ?? role}`,
        );

    const toggleActive = (member: TeamMember) =>
        patch(
            member,
            { status: member.active ? UserStatus.INACTIVE : UserStatus.ACTIVE },
            (row) => ({ ...row, active: !member.active }),
            member.active
                ? `${member.name} can no longer sign in`
                : `${member.name} can sign in again`,
        );

    if (loadError) {
        return (
            <Card color="lv1" className="p-5">
                <p className="text-danger text-sm">
                    Could not load the members for this workspace.
                </p>
                <p className="text-text-secondary mt-1 text-xs">{loadError}</p>
            </Card>
        );
    }

    if (members.length === 0) {
        return (
            <Card color="lv1" className="p-5">
                <p className="text-sm">No members yet.</p>
                <p className="text-text-secondary mt-1 text-xs">
                    The first account to sign in becomes the owner.
                </p>
            </Card>
        );
    }

    const ownerCount = members.filter(
        (member) => member.role === UserRole.OWNER && member.active,
    ).length;

    return (
        <Card color="lv1" className="divide-card-lv3/60 divide-y">
            <div className="text-text-secondary grid grid-cols-[1fr_auto] gap-4 px-5 py-3 text-xs uppercase">
                <span>Member</span>
                <span>Role</span>
            </div>

            {members.map((member) => {
                const isSelf =
                    !!member.userId && member.userId === currentUserId;
                // The last active owner cannot lose the role or be deactivated —
                // that leaves a workspace nobody can administer, with no screen
                // to fix it from.
                const isLastOwner =
                    member.role === UserRole.OWNER && ownerCount === 1;
                const locked = isSelf || isLastOwner || !member.userId;

                return (
                    <div
                        key={member.userId ?? member.email}
                        className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium">
                                    {member.name}
                                </span>
                                {isSelf && (
                                    <Badge variant="secondary">You</Badge>
                                )}
                                {!member.active && (
                                    <Badge variant="helper">Inactive</Badge>
                                )}
                            </div>
                            <span className="text-text-secondary truncate text-xs">
                                {member.email}
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                size="xs"
                                variant={member.active ? "cancel" : "primary"}
                                disabled={locked || savingUserId === member.userId}
                                onClick={() => toggleActive(member)}>
                                {member.active ? "Deactivate" : "Activate"}
                            </Button>

                            <select
                                aria-label={`Role for ${member.name}`}
                                className={ROLE_SELECT_CLASS}
                                value={member.role}
                                disabled={
                                    locked || savingUserId === member.userId
                                }
                                onChange={(event) =>
                                    changeRole(
                                        member,
                                        event.target.value as UserRole,
                                    )
                                }>
                                {ASSIGNABLE_ROLES.map((role) => (
                                    <option key={role.value} value={role.value}>
                                        {role.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                );
            })}

            <p className="text-text-secondary px-5 py-3 text-xs">
                Anyone in the GitHub organisation can sign in. Deactivating a
                member here is what keeps an individual out.
            </p>
        </Card>
    );
};
