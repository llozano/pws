# MySQL migrations

The migration runner creates the configured database and applies every SQL file in
`db-migration/migrations` once.

Set the connection variables, then run:

```bash
npm run db:migrate
```

The runner reads `.env.local` from the project root when it exists.

The database user running migrations needs permission to create the database and tables. The
application user only needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` access to the PWS database.

`schema.sql` is a current schema snapshot for inspection and new environments. Versioned changes
belong in `migrations/`.
