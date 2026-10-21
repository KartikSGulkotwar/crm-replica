import { CoreAuth1760700000000 } from './1760700000000-CoreAuth';
import { Metadata1760800000000 } from './1760800000000-Metadata';
import { Views1760900000000 } from './1760900000000-Views';
import { AppsAndApiKeys1761000000000 } from './1761000000000-AppsAndApiKeys';
import { Workflows1761100000000 } from './1761100000000-Workflows';
import { AgentConversations1761200000000 } from './1761200000000-AgentConversations';
import { ActivitiesAndTimeline1761300000000 } from './1761300000000-ActivitiesAndTimeline';
import { DemoData1761400000000 } from './1761400000000-DemoData';

/** Listed explicitly (not globbed) so the same list works from ts-jest, nest build and Docker. */
export const MIGRATIONS = [
  CoreAuth1760700000000,
  Metadata1760800000000,
  Views1760900000000,
  AppsAndApiKeys1761000000000,
  Workflows1761100000000,
  AgentConversations1761200000000,
  ActivitiesAndTimeline1761300000000,
  DemoData1761400000000,
];
