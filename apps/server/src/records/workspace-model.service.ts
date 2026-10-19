import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ObjectMetadataEntity } from '../metadata/object-metadata.entity';
import { buildWorkspaceModel, ObjectModel, WorkspaceModel } from './object-model';

/** Loads a workspace's live data model for the records layer. */
@Injectable()
export class WorkspaceModelService {
  constructor(private readonly dataSource: DataSource) {}

  /** Pass `em` inside a transaction to see its uncommitted metadata changes. */
  async load(
    workspace: { id: string; schemaName: string },
    em?: EntityManager,
  ): Promise<WorkspaceModel> {
    const entities = await (em ?? this.dataSource.manager)
      .getRepository(ObjectMetadataEntity)
      .find({
        where: { workspaceId: workspace.id },
        relations: { fields: true },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
    return buildWorkspaceModel(workspace.schemaName, entities);
  }

  async object(
    workspace: { id: string; schemaName: string },
    namePlural: string,
  ): Promise<{ model: WorkspaceModel; object: ObjectModel }> {
    const model = await this.load(workspace);
    const object = model.objects.find((o) => o.namePlural === namePlural);
    if (!object)
      throw new NotFoundException(
        `No object called "${namePlural}" (use the plural name, e.g. companies)`,
      );
    return { model, object };
  }
}
