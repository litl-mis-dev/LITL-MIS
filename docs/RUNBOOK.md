# LITL-MIS server runbook (Hostinger)

How to run database maintenance on the live API (`api.litltrece.me`). These are
the steps that are known to work on Hostinger's shared hosting. Never put real
passwords or secrets in this file.

## Things that are different on this host

- **Migrations don't run on deploy.** A redeploy builds and restarts the app
  but never touches the database. New migrations must be applied by hand
  (see "Apply new migrations").
- **Node isn't on the SSH `PATH`.** Turn it on for the session:
  `export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH`
- **The running app's `node_modules` isn't reachable over SSH.** The latest
  build's source is in `~/domains/api.litltrece.me/hbuilds/last-source`
  without packages, so work in a temporary copy (below).
- **Never run bare `npx prisma ...` on the server.** With no local Prisma it
  downloads the newest Prisma (8+), which doesn't match this project
  (5.22.0). Always use `node_modules/.bin/prisma`.
- **The Prisma engine can panic in SSH sessions** with
  `PANIC: timer has gone away` (account thread limits). Schema commands
  (`migrate deploy` / `migrate reset`) worked; `npm run seed:permissions` did
  not. Use `prisma/seed-permissions.sql` in phpMyAdmin instead.
- **The app connects to MySQL at `127.0.0.1:3306`**, never `localhost` or
  the `srvNNNN.hstgr.io` address (that one is only for Remote MySQL).

## Prepare a maintenance copy (every time)

```
ssh -p 65002 u757713338@SERVER_IP          # from your computer
export PATH=/opt/alt/alt-nodejs22/root/usr/bin:$PATH
cp -r ~/domains/api.litltrece.me/hbuilds/last-source ~/litl-maint
cd ~/litl-maint
ls prisma/migrations                       # check the expected migrations are there
npm ci
node_modules/.bin/prisma -v                # must say prisma : 5.22.0
export DATABASE_URL='mysql://DB_USER:DB_PASSWORD@127.0.0.1:3306/DB_NAME'
```

Encode special characters in the password: `@` → `%40`, `#` → `%23`,
`:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `%` → `%25`.

When finished:

```
unset DATABASE_URL
cd ~ && rm -rf ~/litl-maint
history -c
exit
```

## Apply new migrations (keeps all data)

After deploying code that adds a migration:

```
node_modules/.bin/prisma migrate deploy
```

It lists the migrations it applied. "No pending migrations" means the database
was already up to date.

## Fresh start (deletes ALL data)

1. **Back up first** unless the data is disposable: phpMyAdmin → Export.
2. Note the current highest user ID: `SELECT MAX(id) FROM User;`
3. In the maintenance copy:
   ```
   node_modules/.bin/prisma migrate reset
   ```
   Check it names your database at `127.0.0.1:3306` before typing `y`.
4. Permissions: run `prisma/seed-permissions.sql` in phpMyAdmin → SQL tab
   (or `NODE_ENV=production npm run seed:permissions` if it doesn't panic).
   Expect `permissions: 171`.
5. **Stop old logins from matching new accounts.** User IDs restart at 1 but
   old login cookies stay valid for 7 days. Do one of these **before anyone
   registers**:
   - rotate `JWT_SECRET` (and `RESET_TOKEN_SECRET`) in hPanel, or
   - `ALTER TABLE User AUTO_INCREMENT = <old max + 1>;` (use 1000 if the old
     max was small).
6. Redeploy (or restart) the API, then check
   `https://api.litltrece.me/api/health/ready` → `{"status":"ready"}`.
7. The **first person to register and verify becomes the Developer**. It
   approves the future President's registration and assigns the President,
   then has no further powers.

## Changing the database password

The API reads the password from the `DATABASE_URL` environment variable, so
after changing it in **Databases → Management**, update `DATABASE_URL` in the
Node.js environment variables and redeploy. Until then
`/api/health/ready` returns `unavailable`.

## Environment variables

See `backend/.env.example` for the full list. Push notifications need
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_CONTACT_EMAIL`
(`npx web-push generate-vapid-keys` on your own computer); without them the API
logs a warning at startup and push is off.
