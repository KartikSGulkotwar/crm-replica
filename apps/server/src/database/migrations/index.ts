import { CoreAuth1760700000000 } from './1760700000000-CoreAuth';
import { Metadata1760800000000 } from './1760800000000-Metadata';
import { Views1760900000000 } from './1760900000000-Views';
import { AppsAndApiKeys1761000000000 } from './1761000000000-AppsAndApiKeys';

/** Listed explicitly (not globbed) so the same list works from ts-jest, nest build and Docker. */
export const MIGRATIONS = [
  CoreAuth1760700000000,
  Metadata1760800000000,
  Views1760900000000,
  AppsAndApiKeys1761000000000,
];
