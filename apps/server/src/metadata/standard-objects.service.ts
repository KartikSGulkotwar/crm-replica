import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { createObjectSchema } from '@crm-replica/shared';
import { DataSource, EntityManager } from 'typeorm';
import { UserEntity } from '../auth/user.entity';
import { WorkspaceEntity } from '../workspace/workspace.entity';
import { MetadataService, WorkspaceRef } from './metadata.service';
import { ObjectMetadataEntity } from './object-metadata.entity';
import { STANDARD_OBJECTS } from './standard-objects';
import { WorkspaceMembersService } from './workspace-members.service';

@Injectable()
export class StandardObjectsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StandardObjectsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly metadata: MetadataService,
    private readonly members: WorkspaceMembersService,
  ) {}

  /** Creates the standard objects and their tables. Runs inside the signup transaction. */
  async seed(em: EntityManager, workspace: WorkspaceRef): Promise<void> {
    for (const def of STANDARD_OBJECTS) {
      await this.metadata.createObject(workspace, createObjectSchema.parse(def.input), {
        em,
        isCustom: false,
        isSystem: def.isSystem,
        position: def.position,
      });
    }
  }

  /** Workspaces created before the data model existed get their standard objects on startup. */
  async onApplicationBootstrap() {
    const pending: WorkspaceEntity[] = await this.dataSource
      .getRepository(WorkspaceEntity)
      .createQueryBuilder('w')
      .where(`NOT EXISTS (SELECT 1 FROM core.object_metadata o WHERE o.workspace_id = w.id)`)
      .getMany();
    for (const workspace of pending) {
      await this.dataSource.transaction(async (em) => {
        await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`seed:${workspace.id}`]);
        // Another API instance may have seeded it while we waited for the lock.
        if (await em.existsBy(ObjectMetadataEntity, { workspaceId: workspace.id })) return;
        await this.seed(em, workspace);
        for (const user of await em.findBy(UserEntity, { workspaceId: workspace.id })) {
          await this.members.upsert(em, workspace, user);
        }
      });
      this.logger.log(`Added standard objects to existing workspace "${workspace.name}"`);
    }
  }
}
