import { types } from 'pg';

// DATE columns come back as plain 'YYYY-MM-DD' strings instead of JS Dates at local midnight,
// which would shift by a day depending on the server's time zone.
types.setTypeParser(types.builtins.DATE, (value) => value);
