import { OBJECT_ICONS, ObjectIcon } from '../../../components/ObjectIcon';

export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (icon: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-1">
      {Object.keys(OBJECT_ICONS).map((name) => (
        <button
          key={name}
          type="button"
          role="radio"
          aria-checked={value === name}
          aria-label={name}
          title={name}
          onClick={() => onChange(name)}
          className={`grid size-8 place-items-center rounded-md border ${
            value === name
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-line text-muted hover:bg-raised hover:text-ink'
          }`}
        >
          <ObjectIcon name={name} />
        </button>
      ))}
    </div>
  );
}
