import { TriggerType } from '@crm-replica/shared';
import { Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { Popover } from '../../components/Popover';
import { Button } from '../../components/ui';
import { useToast } from '../../lib/toast';
import { useRunWorkflow, useWorkflows } from '../../lib/workflows';

/** On a record page: runs one of the active manual workflows for this object on the record. */
export function RunWorkflowButton({
  objectName,
  recordId,
}: {
  objectName: string;
  recordId: string;
}) {
  const workflows = useWorkflows();
  const run = useRunWorkflow();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const manual = (workflows.data ?? []).filter((wf) => {
    const trigger = wf.activeVersion?.definition.trigger;
    return trigger?.type === TriggerType.MANUAL && trigger.object === objectName;
  });
  if (manual.length === 0) return null;
  return (
    <>
      <span ref={anchor} className="inline-flex">
        <Button variant="secondary" onClick={() => setOpen(true)} aria-expanded={open}>
          <Play aria-hidden className="size-4" /> Run workflow
        </Button>
      </span>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={260}>
          <ul role="menu" aria-label="Workflows">
            {manual.map((wf) => (
              <li key={wf.id}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    run.mutate(
                      { id: wf.id, recordId },
                      {
                        onSuccess: () => toast(`“${wf.name}” started`),
                        onError: (e) => toast(e.message, 'error'),
                      },
                    );
                  }}
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-raised"
                >
                  {wf.name}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
