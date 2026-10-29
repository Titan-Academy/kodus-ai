import { Suspense } from "react";
import { Metadata } from "next";
import { Heading } from "@components/ui/heading";
import { SvgKodus } from "@components/ui/icons/SvgKodus";
import { Link } from "@components/ui/link";
import { Page } from "@components/ui/page";

import { OAuthButtons } from "../components/oauth";
import { edition } from "src/core/utils/edition";

export const metadata: Metadata = {
    title: "Login",
};

export default function LoginPage() {
    return (
        <Page.Root className="flex h-full w-full flex-col items-center overflow-auto py-20">
            <div className="flex w-[90%] flex-1 flex-col items-center justify-center gap-10 md:max-w-[500px]">
                <Page.Header className="flex w-full flex-col items-center gap-10">
                    <SvgKodus className="h-8" />

                    <div className="flex flex-col items-center gap-2">
                        <Heading variant="h2" className="text-center">
                            Welcome Back!
                        </Heading>

                        <p className="text-text-secondary text-center text-sm">
                            Start automating reviews in minutes and save hours
                            every sprint!
                        </p>
                    </div>
                </Page.Header>

                <Page.Content className="flex-none gap-4">
                    <Suspense>
                        <OAuthButtons />
                    </Suspense>

                    {/* Email/password sign-in is gone: this deployment admits
                        people by GitHub organisation membership, so a password
                        would be a second, unverified identity — and with no
                        self-service signup there is nothing to point
                        "forgot password" at. */}

                    {!edition.closedRegistration && (
                        <div className="mt-4 text-center text-sm">
                            Don't have an account yet?{" "}
                            <Link href="/sign-up">Sign up for free</Link>
                        </div>
                    )}
                </Page.Content>
            </div>
        </Page.Root>
    );
}
