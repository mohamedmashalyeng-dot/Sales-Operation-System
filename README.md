# Kent Business College Workspace

Node.js workspace for Kent Business College admissions, email queue, events, leads, and integrations.

## Local Run

```bash
npm install
npm start
```

Open `http://127.0.0.1:5500/`.

For local development, copy `.env.example` to `.env` and change only the values you need.

## Database

Without `DATABASE_URL`, the backend uses `data/pathway-db.json`. That is fine for local testing, but production should use a real database.

Supported production databases:

```env
DATABASE_URL=postgresql://...?sslmode=verify-full
DATABASE_NAME=pathway
POSTGRES_STATE_TABLE=app_state
POSTGRES_USERS_TABLE=app_users
POSTGRES_LOGIN_EVENTS_TABLE=app_login_events
POSTGRES_PASSWORD_RESETS_TABLE=app_password_resets
```

MongoDB is also supported with a `mongodb://` or `mongodb+srv://` URL and `MONGO_STATE_COLLECTION`.

## Hostinger Deployment

Use a Hostinger Business or Cloud plan that supports Node.js web apps.

1. Upload the project files or connect the repository.
2. Set Node.js version to `20` or newer.
3. Set the application startup file to `server.js`.
4. Set the start command to:

```bash
npm start
```

5. Install dependencies with:

```bash
npm ci --omit=dev
```

6. Add environment variables in Hostinger, not in the repository:

```env
NODE_ENV=production
PORT=5500
DATABASE_URL=postgresql://...?sslmode=verify-full
INITIAL_ADMIN_EMAIL=...
INITIAL_ADMIN_PASSWORD=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=https://your-domain.com/api/integrations/gmail/callback
EVENTBRITE_REDIRECT_URI=https://your-domain.com/api/integrations/eventbrite/callback
```

7. In Google OAuth, add the same Gmail redirect URL used above.
8. Visit `/api/health` after deployment. A healthy app returns JSON with the storage mode.

Do not upload `.env`, `node_modules`, or local database backups as public files.
