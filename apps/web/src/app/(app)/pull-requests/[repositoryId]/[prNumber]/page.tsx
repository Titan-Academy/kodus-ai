import type { Metadata } from "next";

import { ReviewPageClient } from "./_components/page.client";
import { PrStateControl } from "./_components/pr-state-control";

export const metadata: Metadata = {
    title: "Code Review",
    openGraph: { title: "Code Review" },
};

export default async function ReviewPage({
    params,
}: {
    params: Promise<{ repositoryId: string; prNumber: string }>;
}) {
    const { repositoryId, prNumber } = await params;
    return (
        <>
            {/* Corrects Kody's stored merge state. Separate from the review
                status, which says nothing about whether the PR was merged. */}
            <div className="flex justify-end px-2 pt-1">
                <PrStateControl
                    repositoryId={repositoryId}
                    prNumber={Number(prNumber)}
                />
            </div>
            <ReviewPageClient
                repositoryId={repositoryId}
                prNumber={Number(prNumber)}
            />
        </>
    );
}
