import { PASSWORD_MIN_LENGTH } from '@crm-replica/shared';
import { TextField } from '../../components/ui';

export interface AccountValues {
  name: string;
  email: string;
  password: string;
}

/** Name, email and password fields shared by signup and accept-invite. */
export function AccountFields({
  values,
  onChange,
}: {
  values: AccountValues;
  onChange: (v: AccountValues) => void;
}) {
  return (
    <>
      <TextField
        label="Your name"
        autoComplete="name"
        required
        value={values.name}
        onChange={(e) => onChange({ ...values, name: e.target.value })}
      />
      <TextField
        label="Work email"
        type="email"
        autoComplete="email"
        required
        value={values.email}
        onChange={(e) => onChange({ ...values, email: e.target.value })}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        value={values.password}
        onChange={(e) => onChange({ ...values, password: e.target.value })}
      />
    </>
  );
}
