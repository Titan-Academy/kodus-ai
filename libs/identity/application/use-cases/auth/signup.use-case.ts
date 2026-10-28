import { createLogger } from '@libs/core/log/logger';
import { Inject, Injectable } from '@nestjs/common';

import { environment } from '@libs/ee/configs/environment';
import { IUseCase } from '@libs/core/domain/interfaces/use-case.interface';
import { STATUS } from '@libs/core/infrastructure/config/types/database/status.type';
import { DuplicateRecordException } from '@libs/core/infrastructure/filters/duplicate-record.exception';
import { EmailService } from '@libs/common/email/services/email.service';
import { generateRandomOrgName } from '@libs/common/utils/helpers';
import { TelemetryService } from '@libs/telemetry/application/services/telemetry.service';
import { Role } from '@libs/identity/domain/permissions/enums/permissions.enum';
import {
    USER_SERVICE_TOKEN,
    IUsersService,
} from '@libs/identity/domain/user/contracts/user.service.contract';
import { IUser } from '@libs/identity/domain/user/interfaces/user.interface';
import {
    ORGANIZATION_SERVICE_TOKEN,
    IOrganizationService,
} from '@libs/organization/domain/organization/contracts/organization.service.contract';
import {
    ITeamService,
    TEAM_SERVICE_TOKEN,
} from '@libs/organization/domain/team/contracts/team.service.contract';
import { ITeam } from '@libs/organization/domain/team/interfaces/team.interface';
import {
    ITeamMemberService,
    TEAM_MEMBERS_SERVICE_TOKEN,
} from '@libs/organization/domain/teamMembers/contracts/teamMembers.service.contracts';
import { TeamMemberRole } from '@libs/organization/domain/teamMembers/enums/teamMemberRole.enum';

import { CreateProfileUseCase } from '../profile/create.use-case';
import { CreateTeamUseCase } from '@libs/organization/application/use-cases/team/create.use-case';
import { SignUpDTO } from '@libs/identity/dtos/create-user-organization.dto';
import { SingleTenantService } from '@libs/identity/infrastructure/adapters/services/single-tenant.service';

export interface SignUpOptions {
    preVerified?: boolean;
}

@Injectable()
export class SignUpUseCase implements IUseCase {
    private readonly logger = createLogger(SignUpUseCase.name);
    constructor(
        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,
        @Inject(USER_SERVICE_TOKEN)
        private readonly usersService: IUsersService,
        @Inject(TEAM_MEMBERS_SERVICE_TOKEN)
        private readonly teamMembersService: ITeamMemberService,
        @Inject(TEAM_SERVICE_TOKEN)
        private readonly teamService: ITeamService,
        private readonly createProfileUseCase: CreateProfileUseCase,
        private readonly createTeamUseCase: CreateTeamUseCase,
        private readonly emailService: EmailService,
        private readonly telemetry: TelemetryService,
        private readonly singleTenant: SingleTenantService,
    ) {}

    public async execute(
        payload: SignUpDTO,
        options?: SignUpOptions,
    ): Promise<Partial<IUser>> {
        const { email, password, name, organizationId } = payload;

        this.logger.error({
            message: 'TEST LOG: Starting signup process',
            context: SignUpUseCase.name,
            metadata: { email, organizationId, name },
        });

        try {
            const userExists = await this.checkIfUserAlreadyExists(email);
            if (userExists) {
                throw new DuplicateRecordException('User already exists');
            }

            const singleTenantEnabled = this.singleTenant.enabled;
            // A single-tenant deployment is itself the authority on who may
            // hold an account: there is no emailed confirmation to wait for
            // and no admin to approve, so the account is trusted on creation.
            // Without this the team member row is created inactive
            // (`status: isOwner || preVerified` below) and the user never
            // appears in the workspace.
            const preVerified = !!options?.preVerified || singleTenantEnabled;

            const status =
                preVerified || !environment.API_CLOUD_MODE
                    ? STATUS.ACTIVE
                    : STATUS.PENDING;
            const user: Omit<IUser, 'uuid'> = {
                email,
                password,
                role: Role.CONTRIBUTOR,
                status,
                organization: {
                    name: generateRandomOrgName(name),
                },
            };

            if (singleTenantEnabled) {
                // Anyone the identity provider verifies joins the one pinned
                // organization. The inbound `organizationId` is deliberately
                // ignored: honouring it would let a caller place an account in
                // an organization of their choosing.
                const organization =
                    await this.singleTenant.ensureOrganization();

                if (!organization) {
                    throw new Error(
                        'Single-tenant organization could not be resolved',
                    );
                }

                user.organization = organization;
                user.role = await this.resolveSingleTenantRole(
                    organization.uuid,
                );
                user.status = STATUS.ACTIVE;
            } else if (organizationId && organizationId.length > 0) {
                user.organization = await this.organizationService.findOne({
                    uuid: organizationId,
                });
            } else {
                const orgExists = await this.checkIfOrganizationAlreadyExists(
                    user.organization.name,
                );

                if (orgExists) {
                    throw new DuplicateRecordException(
                        'Organization with this name already exists',
                    );
                }

                user.role = Role.OWNER;
                user.status = STATUS.ACTIVE;
                user.organization =
                    await this.organizationService.createOrganizationWithTenant(
                        user.organization,
                    );
            }

            if (!user.organization) {
                throw new Error('Organization not found');
            }

            const createdUser = await this.usersService.register(user);

            if (!createdUser) {
                throw new Error('User creation failed');
            }

            await this.createProfileUseCase.execute({
                user: { uuid: createdUser.uuid },
                name,
            });

            let team: ITeam;
            const isOwner = user.role === Role.OWNER;
            if (isOwner) {
                team = await this.createTeamUseCase.execute({
                    teamName: `${name} - team`,
                    organizationId: createdUser.organization.uuid,
                    organizationName: createdUser.organization.name,
                    actorUserId: createdUser.uuid,
                });

                if (!team) {
                    throw new Error('Team creation failed');
                }
            } else {
                team = await this.teamService.findOne({
                    organization: {
                        uuid: createdUser.organization.uuid,
                    },
                });

                // A pinned organization can predate any team in it (created by
                // an earlier deployment, or emptied by an admin), and a joiner
                // is not allowed to create one through the owner branch. Give
                // the organization a default team so the join can complete.
                if (!team && singleTenantEnabled) {
                    team = await this.createTeamUseCase.execute({
                        teamName: `${createdUser.organization.name} - team`,
                        organizationId: createdUser.organization.uuid,
                        organizationName: createdUser.organization.name,
                        actorUserId: createdUser.uuid,
                    });
                }

                if (!team) {
                    throw new Error('Team not found for the organization');
                }
            }

            const member = await this.teamMembersService.create({
                user: createdUser,
                name,
                organization: createdUser.organization,
                team,
                teamRole: isOwner
                    ? TeamMemberRole.TEAM_LEADER
                    : TeamMemberRole.MEMBER,
                status: isOwner || preVerified,
            });

            if (!member) {
                throw new Error('Failed to create team member');
            }

            void this.emailService.createContact({ email, name }, this.logger);

            void this.telemetry.userSignedUp({
                userId: createdUser.uuid,
                email,
                name,
                organizationId: createdUser.organization.uuid,
                organizationName: createdUser.organization.name,
                teamId: team.uuid,
                teamName: team.name,
            });

            return createdUser.toObject();
        } catch (error) {
            this.logger.error({
                message: 'Error during sign up',
                error,
                context: SignUpUseCase.name,
                metadata: {
                    name,
                    email,
                    organizationId,
                },
                serviceName: SignUpUseCase.name,
            });

            throw error;
        }
    }

    private async checkIfUserAlreadyExists(email: string): Promise<boolean> {
        const previousUser = await this.usersService.count({
            email: email,
        });

        return !!previousUser;
    }

    /**
     * The first account in the pinned organization owns it, everyone after
     * that joins as a contributor.
     *
     * Without this a single-tenant deployment could end up with no owner at
     * all — every account a plain contributor, and nobody able to configure
     * the workspace. The owner can promote further members from the
     * organization settings.
     */
    private async resolveSingleTenantRole(
        organizationId: string,
    ): Promise<Role> {
        const members = await this.usersService.find({
            organization: { uuid: organizationId },
        });

        return members.length === 0 ? Role.OWNER : Role.CONTRIBUTOR;
    }

    private async checkIfOrganizationAlreadyExists(
        organizationName: string,
    ): Promise<boolean> {
        const existingOrganization = await this.organizationService.findOne({
            name: organizationName,
        });

        return !!existingOrganization;
    }
}
