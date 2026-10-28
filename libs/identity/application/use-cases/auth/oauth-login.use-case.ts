import { randomBytes } from 'crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import { AuthProvider } from '@libs/core/domain/enums/auth-provider.enum';
import { IUseCase } from '@libs/core/domain/interfaces/use-case.interface';
import { createLogger } from '@libs/core/log/logger';
import {
    AUTH_SERVICE_TOKEN,
    IAuthService,
} from '@libs/identity/domain/auth/contracts/auth.service.contracts';
import { IUser } from '@libs/identity/domain/user/interfaces/user.interface';
import { SingleTenantService } from '@libs/identity/infrastructure/adapters/services/single-tenant.service';
import { TelemetryService } from '@libs/telemetry/application/services/telemetry.service';

import { SignUpUseCase } from './signup.use-case';

@Injectable()
export class OAuthLoginUseCase implements IUseCase {
    private readonly logger = createLogger(OAuthLoginUseCase.name);

    constructor(
        @Inject(AUTH_SERVICE_TOKEN)
        private readonly authService: IAuthService,
        private readonly signUpUseCase: SignUpUseCase,
        private readonly telemetry: TelemetryService,
        private readonly singleTenant: SingleTenantService,
    ) {}

    async execute(
        name: string,
        email: string,
        providerRefreshToken: string,
        authProvider: AuthProvider,
    ) {
        try {
            // Authenticate the caller against the OAuth provider itself: the
            // access token must belong to the claimed account. The identity we
            // trust is the email the provider returns — NOT the `email` in the
            // request body, which an unauthenticated caller fully controls.
            const verified = await this.authService.verifyOAuthProviderEmail(
                authProvider,
                providerRefreshToken,
            );
            const verifiedEmail = verified.email;

            let user = await this.authService.validateUser({
                email: verifiedEmail,
            });

            if (!user) {
                // A single-tenant workspace only admits accounts an admin already
                // added; the first login on an empty workspace bootstraps the
                // owner. Without this every GitHub account that can reach the
                // login page becomes a member of the company workspace.
                if (!(await this.singleTenant.allowsNewAccount())) {
                    this.logger.warn({
                        message:
                            'Rejected sign-in from an account outside the workspace',
                        context: OAuthLoginUseCase.name,
                        metadata: {
                            authProvider,
                            email: verifiedEmail,
                        },
                    });

                    throw new UnauthorizedException(
                        'api.users.not_a_member',
                    );
                }

                user = await this.signUpUseCase.execute({
                    email: verifiedEmail,
                    name: verified.name || name,
                    password: randomBytes(32).toString('base64').slice(0, 32),
                });
            }

            const { accessToken, refreshToken } = await this.authService.login(
                user as IUser,
                authProvider,
                {
                    refreshToken: providerRefreshToken,
                },
            );

            void this.telemetry.userLoggedIn({
                userId: user.uuid,
                organizationId: user.organization?.uuid,
                method: 'oauth',
                provider: authProvider,
            });

            return { accessToken, refreshToken };
        } catch (error) {
            throw new UnauthorizedException('api.users.unauthorized');
        }
    }
}
