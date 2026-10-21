import { BadRequestException, Injectable } from '@nestjs/common';
import { FieldType, RecordDto, SearchResultDto } from '@crm-replica/shared';
import { FieldModel, ObjectModel } from '../records/object-model';
import { recordRef } from '../records/record-ref';
import { RecordContext, RecordsService } from '../records/records.service';
import { WorkspaceModelService } from '../records/workspace-model.service';

const MAX_QUERY = 100;
const PER_OBJECT = 5;
const MAX_RESULTS = 25;
/** Fields worth searching besides the title (and worth showing as a second line). */
const EXTRA_TYPES = [FieldType.EMAIL, FieldType.LINK, FieldType.PHONE];

/** Search across every object, for the command palette. */
@Injectable()
export class SearchService {
  constructor(
    private readonly records: RecordsService,
    private readonly models: WorkspaceModelService,
  ) {}

  async search(ctx: RecordContext, q: string, limit = MAX_RESULTS): Promise<SearchResultDto[]> {
    const words = q.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    if (q.length > MAX_QUERY)
      throw new BadRequestException(`Search for at most ${MAX_QUERY} characters`);
    const model = await this.models.load(ctx.workspace);
    const results: SearchResultDto[] = [];
    for (const object of model.objects.filter((o) => !o.isSystem)) {
      const fields = searchFields(object);
      if (!fields.length) continue;
      // Every word must match one of the fields: "ada love" finds Ada Lovelace.
      const filter = {
        and: words.map((w) => ({
          or: fields.map((f) => ({ field: f.name, op: 'contains', value: w })),
        })),
      };
      const page = await this.records.list(ctx, object.namePlural, {
        filter: JSON.stringify(filter),
        sort: 'updatedAt:desc',
        limit: String(PER_OBJECT),
      });
      results.push(
        ...page.data.map((r) => ({ ...recordRef(object, r), subtitle: subtitle(object, r) })),
      );
      if (results.length >= limit) break;
    }
    return results.slice(0, limit);
  }
}

function searchFields(object: ObjectModel): FieldModel[] {
  const title = object.fields.find((f) => f.name === object.labelIdentifierFieldName);
  const fields = title && title.type === FieldType.TEXT ? [title] : [];
  if (title?.name === 'firstName') {
    const last = object.fields.find((f) => f.name === 'lastName');
    if (last) fields.push(last);
  }
  fields.push(...object.fields.filter((f) => EXTRA_TYPES.includes(f.type) && !f.system));
  return fields;
}

function subtitle(object: ObjectModel, record: RecordDto): string | null {
  for (const f of object.fields.filter((f) => EXTRA_TYPES.includes(f.type))) {
    const value = record[f.apiKey];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}
