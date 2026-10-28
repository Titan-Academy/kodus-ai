import { Inject, Injectable } from '@nestjs/common';

import { createLogger } from '@libs/core/log/logger';
import {
    IOrganizationService,
    ORGANIZATION_SERVICE_TOKEN,
} from '@libs/organization/domain/organization/contracts/organization.service.contract';
import { OrganizationEntity } from '@libs/organization/domain/organization/entities/organization.entity';

/**
 * Single-tenant (private) deployment mode.
 *
 * One installation serves exactly one organization: every account that signs
 * in belongs to it, no account may create an organization of its own, and open
 * registration is closed. The deployment's operator is the tenant, so there is
 * no admin-approval step either — see `preVerified` in `SignUpUseCase`.
 *
 * The organization is resolved by *name* rather than by uuid so a fresh
 * deployment needs no seed script, migration or out-of-band bootstrap: the
 * first account to arrive creates the organization (`ensureOrganization`) and
 * becomes its owner. Restarts are idempotent because the lookup comes first.
 *
 * Env (documented in `.env.schema`):
 *   API_SINGLE_TENANT                     — `true` turns the mode on
 *   API_SINGLE_TENANT_ORGANIZATION_NAME   — the pinned organization's name
 */
export interface SingleTenantConfig {
    enabled: boolean;
    organizationName: string;
}

const DEFAULT_ORGANIZATION_NAME = 'Kodus';

/**
 * Read on every call rather than captured at module load: the api validates
 * env through Joi at bootstrap, but tests (and any operator flipping the flag
 * in a running process) must not be able to observe a stale value.
 */
export const readSingleTenantConfig = (): SingleTenantConfig => ({
    enabled: (process.env.API_SINGLE_TENANT ?? 'false').toLowerCase() === 'true',
    organizationName:
        (process.env.API_SINGLE_TENANT_ORGANIZATION_NAME ?? '').trim() ||
        DEFAULT_ORGANIZATION_NAME,
});

@Injectable()
export class SingleTenantService {
    private readonly logger = createLogger(SingleTenantService.name);

    /**
     * Only successful lookups are cached. A miss must stay a miss so
     * `ensureOrganization` can create on the next call instead of pinning
     * "the organization does not exist" for the life of the process.
     */
    private resolvedOrganization?: OrganizationEntity;

    constructor(
        @Inject(ORGANIZATION_SERVICE_TOKEN)
        private readonly organizationService: IOrganizationService,
    ) {}

    get config(): SingleTenantConfig {
        return readSingleTenantConfig();
    }

    get enabled(): boolean {
        return this.config.enabled;
    }

    /**
     * The pinned organization, or `undefined` while it does not exist yet (or
     * when the mode is off). Read-only: never creates anything, because it runs
     * on the authentication path.
     */
    async getOrganization(): Promise<OrganizationEntity | undefined> {
        if (!this.enabled) return undefined;
        if (this.resolvedOrganization) return this.resolvedOrganization;

        const organization = await this.organizationService.findOne({
            name: this.config.organizationName,
        });

        if (organization) {
            this.resolvedOrganization = organization;
        }

        return organization;
    }

    /** Idempotent: creates the pinned organization the first time it is needed. */
    async ensureOrganization(): Promise<OrganizationEntity | undefined> {
        const existing = await this.getOrganization();
        if (existing) return existing;

        this.logger.log({
            message: 'Creating the single-tenant organization',
            context: SingleTenantService.name,
            metadata: { organizationName: this.config.organizationName },
        });

        const created = await this.organizationService.createOrganizationWithTenant(
            {
                name: this.config.organizationName,
                status: true,
            },
        );

        if (created) {
            this.resolvedOrganization = created;
        }

        return created;
    }

    /**
     * Whether an authenticated account belongs to the pinned organization.
     * `true` whenever the mode is off, so cloud behaviour is untouched.
     */
    async allowsOrganization(organizationId?: string): Promise<boolean> {
        if (!this.enabled) return true;
        if (!organizationId) return false;

        const organization = await this.getOrganization();

        return organization?.uuid === organizationId;
    }
}
