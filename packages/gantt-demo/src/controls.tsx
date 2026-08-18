/** The two chrome bits both demo views are built from. */

export function Toggle({
  label,
  checked,
  onChange,
  title,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  title?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className={`app__toggle${disabled ? " app__toggle--off" : ""}`} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

export function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="app__stat">
      <span className="app__muted">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}
