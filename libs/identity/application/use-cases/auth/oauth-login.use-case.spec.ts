import { UnauthorizedException } from '@nestjs/common';

import { AuthProvider } from '@libs/core/domain/enums/auth-provider.enum';

import { OAuthLoginUseCase } from './oauth-login.use-case';

/**
 * Provider token gating — `/auth/oauth` issued a JWT based only on a
 * client-supplied email, never validating the OAuth token against the
 * provider. The use case must now (1) verify the token with the provider and
 * (2) key the account off the provider-returned email, never the request body.
 */
describe('OAuthLoginUseCase — provider token gating', () => {
    const makeDeps = () => {
        const authService = {
            verifyOAuthProviderEmail: jest.fn(),
            validateUser: jest.fn(),
            login: jest.fn(),
        };
        const signUpUseCase = { execute: jest.fn() };
        const telemetry = { userLoggedIn: jest.fn() };
        const singleTenant = { allowsNewAccount: jest.fn().mockResolvedValue(true) };
        const useCase = new OAuthLoginUseCase(
            authService as any,
            signUpUseCase as any,
            telemetry as any,
            singleTenant as any,
        );
        return { useCase, authService, signUpUseCase, telemetry, singleTenant };
    };

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

    // A single-tenant workspace is one company's install, not a public
    // service. Provisioning whoever the provider verifies let any GitHub
    // account that reached the login page into the company's reviews.
    it('refuses to provision an account the workspace has not added', async () => {
        const { useCase, authService, signUpUseCase, singleTenant } =
            makeDeps();
        authService.verifyOAuthProviderEmail.mockResolvedValue({
            email: 'stranger@example.com',
            name: 'Stranger',
        });
        authService.validateUser.mockResolvedValue(undefined);
        singleTenant.allowsNewAccount.mockResolvedValue(false);

        await expect(
            useCase.execute(
                'Stranger',
                'stranger@example.com',
                'valid_token',
                AuthProvider.GITHUB,
            ),
        ).rejects.toBeInstanceOf(UnauthorizedException);

        expect(signUpUseCase.execute).not.toHaveBeenCalled();
        expect(authService.login).not.toHaveBeenCalled();
    });

    it('still provisions the first account, so a workspace can bootstrap', async () => {
        const { useCase, authService, signUpUseCase, singleTenant } =
            makeDeps();
        authService.verifyOAuthProviderEmail.mockResolvedValue({
            email: 'owner@example.com',
            name: 'Owner',
        });
        authService.validateUser.mockResolvedValue(undefined);
        singleTenant.allowsNewAccount.mockResolvedValue(true);
        signUpUseCase.execute.mockResolvedValue({
            uuid: 'u3',
            organization: { uuid: 'o3' },
        });
        authService.login.mockResolvedValue({
            accessToken: 'a',
            refreshToken: 'r',
        });

        await useCase.execute(
            'Owner',
            'owner@example.com',
            'valid_token',
            AuthProvider.GITHUB,
        );

        expect(signUpUseCase.execute).toHaveBeenCalled();
    });

    // An existing member never reaches the check: `validateUser` already found
    // them, so the workspace-empty rule cannot lock out the people in it.
    it('does not consult the rule for an existing member', async () => {
        const { useCase, authService, singleTenant } = makeDeps();
        authService.verifyOAuthProviderEmail.mockResolvedValue({
            email: 'member@example.com',
            name: 'Member',
        });
        authService.validateUser.mockResolvedValue({
            uuid: 'u4',
            organization: { uuid: 'o4' },
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

        expect(singleTenant.allowsNewAccount).not.toHaveBeenCalled();
    });
});
