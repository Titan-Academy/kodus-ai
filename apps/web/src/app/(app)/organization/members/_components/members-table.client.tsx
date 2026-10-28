"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@components/ui/badge";
import { Button } from "@components/ui/button";
import { Card } from "@components/ui/card";
import { Input } from "@components/ui/input";
import { useToast } from "@components/ui/toaster/use-toast";
import type { TeamMember } from "@services/teams/fetch";
import { useCreateOrUpdateTeamMembers } from "@services/setup/hooks";
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

export const MembersTable = ({
    teamId,
    initialMembers,
    loadError,
}: {
    teamId: string;
    initialMembers: TeamMember[];
    loadError?: string;
}) => {
    const [members, setMembers] = useState(initialMembers);
    const [savingUserId, setSavingUserId] = useState<string | undefined>();
    const { toast } = useToast();
    const router = useRouter();
    const { userId: currentUserId } = useAuth();
    const [inviteEmail, setInviteEmail] = useState("");
    const invite = useCreateOrUpdateTeamMembers();

    // Adding a member creates their account (pending, awaiting the invitation
    // email) — which is what lets them sign in at all, since an unknown
    // account is refused. If mail is not configured the row can be flipped to
    // active below, so onboarding never depends on the mail path.
    const addMember = useCallback(async () => {
        const email = inviteEmail.trim();
        if (!email) return;

        try {
            await invite.mutateAsync({ members: [{ email }], teamId });
            setInviteEmail("");
            toast({
                title: `Added ${email}`,
                description:
                    "They can sign in once their account is active, and the invitation email has gone out.",
                variant: "success",
            });
            router.refresh();
        } catch (error) {
            toast({
                title: "Could not add that member",
                description:
                    error instanceof Error ? error.message : "Please try again.",
                variant: "danger",
            });
        }
    }, [invite, inviteEmail, router, teamId, toast]);

    const changeRole = useCallback(
        async (member: TeamMember, role: UserRole) => {
            const id = member.userId;
            if (!id) return;

            // Optimistic: the row reads back the chosen role immediately and a
            // failure puts it back. The workspace is small; a spinner plus a
            // refetch is more noise than information.
            const previous = members;

            setSavingUserId(id);
            setMembers((rows) =>
                rows.map((row) => (row.userId === id ? { ...row, role } : row)),
            );

            try {
                await updateUser(id, { role });
                toast({
                    title: `${member.name} is now ${ROLE_LABEL[role] ?? role}`,
                    variant: "success",
                });
                // Nav and screens re-derive from the session role.
                router.refresh();
            } catch (error) {
                setMembers(previous);
                toast({
                    title: "Could not change that role",
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

    const toggleActive = useCallback(
        async (member: TeamMember) => {
            const id = member.userId;
            if (!id) return;

            const previous = members;
            const nextStatus = member.active
                ? UserStatus.INACTIVE
                : UserStatus.ACTIVE;

            setSavingUserId(id);
            setMembers((rows) =>
                rows.map((row) =>
                    row.userId === id
                        ? { ...row, active: !member.active }
                        : row,
                ),
            );

            try {
                await updateUser(id, { status: nextStatus });
                toast({
                    title: member.active
                        ? `${member.name} can no longer sign in`
                        : `${member.name} can sign in again`,
                    variant: "success",
                });
                router.refresh();
            } catch (error) {
                setMembers(previous);
                toast({
                    title: "Could not change that member",
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
            <div className="flex flex-col gap-4">
                <Card color="lv1" className="p-5">
                    <p className="text-sm">No members yet.</p>
                    <p className="text-text-secondary mt-1 text-xs">
                        The first account to sign in becomes the owner, so
                        normally nobody needs adding until there is an owner.
                    </p>
                </Card>

                <AddMemberRow
                    email={inviteEmail}
                    onEmailChange={setInviteEmail}
                    onAdd={addMember}
                    pending={invite.isPending}
                />
            </div>
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
                // The last active owner cannot lose the role — that leaves a
                // workspace nobody can administer, with no screen to fix it.
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
                            disabled={locked || savingUserId === member.userId}
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
                Only an owner can change roles. The last owner cannot demote or
                deactivate themselves.
            </p>

            <div className="px-5 py-4">
                <AddMemberRow
                    email={inviteEmail}
                    onEmailChange={setInviteEmail}
                    onAdd={addMember}
                    pending={invite.isPending}
                />
            </div>
        </Card>
    );
};

/** Adds a member by email — the account is created here, which is what makes
 *  the next sign-in from that address admissible. */
const AddMemberRow = ({
    email,
    onEmailChange,
    onAdd,
    pending,
}: {
    email: string;
    onEmailChange: (value: string) => void;
    onAdd: () => void;
    pending: boolean;
}) => (
    <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
            event.preventDefault();
            onAdd();
        }}>
        <label className="flex flex-1 flex-col gap-1">
            <span className="text-text-secondary text-xs">
                Add a member by GitHub email
            </span>
            <Input
                type="email"
                placeholder="name@tracktitan.io"
                value={email}
                onChange={(event) => onEmailChange(event.target.value)}
            />
        </label>
        <Button
            type="submit"
            size="md"
            variant="primary"
            loading={pending}
            disabled={!email.trim()}>
            Add member
        </Button>
    </form>
);
