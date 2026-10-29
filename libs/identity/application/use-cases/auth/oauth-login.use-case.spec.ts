import { UnauthorizedException } from '@nestjs/common';

import { AuthProvider } from '@libs/core/domain/enums/auth-provider.enum';

import { OAuthLoginUseCase } from './oauth-login.use-case';

/**
 * `/auth/oauth` gating, two rules that both matter:
 *
 *  1. The provider token is verified with the provider, and the account is
 *     keyed off the email the provider returns — never the `email` in the
 *     request body, which an unauthenticated caller fully controls.
 *  2. On a single-tenant install the company's GitHub organisation is the
 *     allow-list. Membership is checked on every GitHub sign-in, so nobody
 *     outside the org can provision an account and no invitation is needed.
 */
describe('OAuthLoginUseCase', () => {
    const makeDeps = () => {
        const authService = {
            verifyOAuthProviderEmail: jest.fn(),
            assertGithubOrgMembership: jest.fn(),
            validateUser: jest.fn(),
            login: jest.fn(),
        };
        const signUpUseCase = { execute: jest.fn() };
        const telemetry = { userLoggedIn: jest.fn() };
        const singleTenant = {
            enabled: false,
            config: { githubOrg: 'Titan-Academy' },
        };
        const useCase = new OAuthLoginUseCase(
            authService as any,
            signUpUseCase as any,
            telemetry as any,
            singleTenant as any,
        );
        return { useCase, authService, signUpUseCase, telemetry, singleTenant };
    };

    describe('provider token gating', () => {
        it('rejects when the provider token cannot be verified — no JWT issued', async () => {
            const { useCase, authService, signUpUseCase } = makeDeps();
            authService.verifyOAuthProviderEmail.mockRejectedValue(
                new UnauthorizedException('bad token'),
            );

            await expect(
                useCase.execute(
                    'Any Name',
                    'victim@example.com',
                    'completely_fake',
                    AuthProvider.GITHUB,
                ),
            ).rejects.toBeInstanceOf(UnauthorizedException);

            expect(authService.login).not.toHaveBeenCalled();
            expect(signUpUseCase.execute).not.toHaveBeenCalled();
            // The provider token (not the body email) is what gets verified, in
            // (provider, token) order — swapping or dropping it must fail here.
            expect(authService.verifyOAuthProviderEmail).toHaveBeenCalledWith(
                AuthProvider.GITHUB,
                'completely_fake',
            );
        });

        it('keys the account off the provider email, not the request body', async () => {
            const { useCase, authService } = makeDeps();
            // Attacker claims the victim's email in the body, but the token the
            // provider validates belongs to attacker@evil.com.
            authService.verifyOAuthProviderEmail.mockResolvedValue({
                email: 'attacker@evil.com',
                name: 'Attacker',
            });
            authService.validateUser.mockResolvedValue({
                uuid: 'u1',
                organization: { uuid: 'o1' },
            });
            authService.login.mockResolvedValue({
                accessToken: 'a',
                refreshToken: 'r',
            });

            const out = await useCase.execute(
                'Victim',
                'victim@example.com', // body email — must be ignored
                'valid_token',
                AuthProvider.GITHUB,
            );

            expect(authService.verifyOAuthProviderEmail).toHaveBeenCalledWith(
                AuthProvider.GITHUB,
                'valid_token',
            );
            expect(authService.validateUser).toHaveBeenCalledWith({
                email: 'attacker@evil.com',
            });
            expect(out).toEqual({ accessToken: 'a', refreshToken: 'r' });
        });

        it('auto-registers with the verified email when the user is new', async () => {
            const { useCase, authService, signUpUseCase } = makeDeps();
            authService.verifyOAuthProviderEmail.mockResolvedValue({
                email: 'new@example.com',
                name: 'New User',
            });
            authService.validateUser.mockResolvedValue(undefined);
            signUpUseCase.execute.mockResolvedValue({
                uuid: 'u2',
                organization: { uuid: 'o2' },
            });
            authService.login.mockResolvedValue({
                accessToken: 'a',
                refreshToken: 'r',
            });

            await useCase.execute(
                'ignored',
                'body@example.com',
                'valid_token',
                AuthProvider.GITHUB,
            );

            expect(signUpUseCase.execute).toHaveBeenCalledWith(
                expect.objectContaining({ email: 'new@example.com' }),
            );
        });
    });

    describe('single-tenant: the GitHub organisation is the allow-list', () => {
        it('refuses a candidate who is not a member of the organisation', async () => {
            const { useCase, authService, signUpUseCase, singleTenant } =
                makeDeps();
            singleTenant.enabled = true;
            authService.verifyOAuthProviderEmail.mockResolvedValue({
                email: 'stranger@example.com',
                name: 'Stranger',
            });
            authService.assertGithubOrgMembership.mockRejectedValue(
                new UnauthorizedException('api.users.not_a_member'),
            );

            await expect(
                useCase.execute(
                    'Stranger',
                    'stranger@example.com',
                    'valid_token',
                    AuthProvider.GITHUB,
                ),
            ).rejects.toBeInstanceOf(UnauthorizedException);

            // The gate runs with the caller's token and the configured org.
            expect(authService.assertGithubOrgMembership).toHaveBeenCalledWith(
                'valid_token',
                'Titan-Academy',
            );
            expect(signUpUseCase.execute).not.toHaveBeenCalled();
            expect(authService.login).not.toHaveBeenCalled();
        });

        it('provisions an organisation member who has not signed in before', async () => {
            const { useCase, authService, signUpUseCase, singleTenant } =
                makeDeps();
            singleTenant.enabled = true;
            authService.verifyOAuthProviderEmail.mockResolvedValue({
                email: 'member@example.com',
                name: 'Member',
            });
            authService.assertGithubOrgMembership.mockResolvedValue(undefined);
            authService.validateUser.mockResolvedValue(undefined);
            signUpUseCase.execute.mockResolvedValue({
                uuid: 'u3',
                organization: { uuid: 'o3' },
            });
            authService.login.mockResolvedValue({
                accessToken: 'a',
                refreshToken: 'r',
            });

            await useCase.execute(
                'Member',
                'member@example.com',
                'valid_token',
                AuthProvider.GITHUB,
            );

            expect(signUpUseCase.execute).toHaveBeenCalled();
        });

        // Not a first-login-only check: someone removed from the GitHub org
        // loses access at their next sign-in, even though they have an account.
        it('checks the organisation for an existing member too', async () => {
            const { useCase, authService, singleTenant } = makeDeps();
            singleTenant.enabled = true;
            authService.verifyOAuthProviderEmail.mockResolvedValue({
                email: 'member@example.com',
                name: 'Member',
            });
            authService.validateUser.mockResolvedValue({
                uuid: 'u4',
                organization: { uuid: 'o4' },
            });
            authService.assertGithubOrgMembership.mockRejectedValue(
                new UnauthorizedException('api.users.not_a_member'),
            );

            await expect(
                useCase.execute(
                    'Member',
                    'member@example.com',
                    'valid_token',
                    AuthProvider.GITHUB,
                ),
            ).rejects.toBeInstanceOf(UnauthorizedException);

            expect(authService.login).not.toHaveBeenCalled();
        });

        // A password login carries no provider-verified identity, so it would be
        // a way around the organisation rule entirely.
        it('refuses a non-GitHub provider', async () => {
            const { useCase, authService, singleTenant } = makeDeps();
            singleTenant.enabled = true;
            authService.verifyOAuthProviderEmail.mockResolvedValue({
                email: 'someone@example.com',
                name: 'Someone',
            });

            await expect(
                useCase.execute(
                    'Someone',
                    'someone@example.com',
                    'valid_token',
                    AuthProvider.GITLAB,
                ),
            ).rejects.toBeInstanceOf(UnauthorizedException);

            expect(
                authService.assertGithubOrgMembership,
            ).not.toHaveBeenCalled();
        });
    });
});
