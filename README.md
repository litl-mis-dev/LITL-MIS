# LITL-MIS

Management information system for the League of Information Technology
Leaders (Cavite State University): members and approvals, officer roles,
financials and audit, events and attendance, certificates, documents,
announcements and notifications.

| Part | Stack | Deployed at |
|---|---|---|
| `frontend/` | React 19 + Vite | https://litltrece.me |
| `backend/` | Node.js + Express 5 + Prisma 5 (MySQL), Socket.IO | https://api.litltrece.me |

Files are stored in Cloudflare R2; email is sent through Hostinger SMTP.

## Local development

```
cd backend
cp .env.example .env      # fill in the values
npm ci
npx prisma migrate dev    # creates the schema in your local database
npm run seed:permissions  # default role permissions
npm start

cd ../frontend
npm ci
npm run dev
```

## Tests and checks

```
cd backend && npm test
cd frontend && npm run lint && npm run build
```

## Accounts on a fresh system

- The **first person to register and verify** becomes the **Developer**: it
  approves the future President's registration and assigns the President,
  then has no further powers.
- The **President** approves members, assigns officer roles, and invites the
  **Advisers** and **Department Chair** (Settings ▸ Advisers).

## Production

Server maintenance (migrations, fresh start, permissions, password changes)
is in [docs/RUNBOOK.md](docs/RUNBOOK.md). Migrations do not run on deploy.
