import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { API_KEY_PREFIX, ApiKeyDto, CreatedApiKeyDto } from '@crm-replica/shared';
import { createHash, randomBytes } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { ApiKeyEntity } from './api-key.entity';

const hash = (key: string) => createHash('sha256').update(key).digest('hex');
/** Only refresh "last used" this often, so busy keys don't write on every request. */
const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Workspace API keys for the CLI and the REST API. Keys are 192-bit random strings, so a
 * fast SHA-256 is enough to store them safely (unlike passwords, they can't be guessed).
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKeyEntity) private readonly keys: Repository<ApiKeyEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async list(workspaceId: string): Promise<ApiKeyDto[]> {
    const keys = await this.keys.find({
      where: { workspaceId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!keys.length) return [];
    const creators = await this.users.findBy({
      id: In([...new Set(keys.map((k) => k.createdBy))]),
    });
    return keys.map((k) =>
      toDto(
        k,
        creators.find((u) => u.id === k.createdBy),
      ),
    );
  }

  async create(workspaceId: string, creator: UserEntity, name: string): Promise<CreatedApiKeyDto> {
    const key = `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const saved = await this.keys.save(
      this.keys.create({
        workspaceId,
        createdBy: creator.id,
        name,
        keyPrefix: key.slice(0, API_KEY_PREFIX.length + 8),
        keyHash: hash(key),
      }),
    );
    return { ...toDto(saved, creator), key };
  }

  async revoke(workspaceId: string, id: string): Promise<void> {
    const result = await this.keys.update(
      { id, workspaceId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) throw new NotFoundException('API key not found');
  }

  /** The user a key acts as (its creator, with their current role), or null if invalid or revoked. */
  async authenticate(key: string): Promise<UserEntity | null> {
    if (!key.startsWith(API_KEY_PREFIX) || key.length > 100) return null;
    const found = await this.keys.findOne({ where: { keyHash: hash(key), revokedAt: IsNull() } });
    if (!found) return null;
    const user = await this.users.findOne({
      where: { id: found.createdBy, workspaceId: found.workspaceId },
      relations: { workspace: true },
    });
    if (!user) return null;
    if (!found.lastUsedAt || Date.now() - found.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
      await this.keys.update({ id: found.id }, { lastUsedAt: new Date() });
    }
    return user;
  }
}

function toDto(key: ApiKeyEntity, creator?: UserEntity): ApiKeyDto {
  return {
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdBy: creator ? { id: creator.id, name: creator.name } : null,
  };
}
