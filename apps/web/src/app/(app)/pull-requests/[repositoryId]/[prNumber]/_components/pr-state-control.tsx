"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@components/ui/button";
import { useToast } from "@components/ui/toaster/use-toast";
import { setPullRequestState } from "@services/pull-requests/fetch";
import { ChevronDownIcon } from "lucide-react";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@components/ui/dropdown-menu";

/**
 * Corrects the merge state Kody has recorded for this pull request.
 *
 * Separate from the review status on purpose: those are two different facts, and
 * a review that failed says nothing about whether the PR was merged. When the
 * webhook write that records a merge is missed, the row keeps reporting the
 * review outcome forever — this is the manual escape hatch.
 *
 * It changes Kody's record only. The pull request on the provider is untouched,
 * so this is safe to use for reporting, not a substitute for merging in git.
 */
export const PrStateControl = ({
    repositoryId,
    prNumber,
}: {
    repositoryId: string;
    prNumber: number;
}) => {
    const [saving, setSaving] = useState(false);
    const { toast } = useToast();
    const router = useRouter();

    const setMerged = async (merged: boolean) => {
        setSaving(true);
        try {
            await setPullRequestState({ repositoryId, pullRequestNumber: prNumber, merged });
            toast({
                title: merged
                    ? `PR #${prNumber} marked as merged`
                    : `PR #${prNumber} marked as open`,
                description: "Kody's record only — the pull request itself is unchanged.",
                variant: "success",
            });
            router.refresh();
        } catch (error) {
            toast({
                title: "Could not update the pull request state",
                description: error instanceof Error ? error.message : "Please try again.",
                variant: "danger",
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="xs" variant="cancel" loading={saving}>
                    Set PR state
                    <ChevronDownIcon className="ml-1 size-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs">
                    Kody&apos;s record only
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setMerged(true)}>
                    Mark as merged
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMerged(false)}>
                    Mark as open
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};
