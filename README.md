# Epic Mapper

Epic Mapper is a web-based tool for visualizing Jira epic dependencies. It provides interactive graph and Gantt chart views to help teams understand task relationships, identify blockers, and forecast project completion based on developer velocity.

## Features

- **Interactive Dependency Graph** — visualize how stories, tasks, and bugs are interconnected
- **Gantt Chart View** — see the critical path and project timeline based on blocking dependencies
- **Resource Planning** — calculate project estimates using developer velocity and skill-based allocations
- **Epic Mode** — select one or more epics to visualize their full issue scope and dependencies
- **Sprint Mode** — select a project and sprint to visualize sprint scope and assess team capacity
- **Jira OAuth Login** — authenticates via Atlassian OAuth 2.0; no API tokens needed
- **Role-Based Views** — velocity data is hidden from non-admin users (configured via `ADMIN_EMAILS`)

---

## Architecture

- **Backend**: Node.js + Express, acts as a proxy to the Jira API (`server.js`)
- **Frontend**: Vanilla JS + D3.js, served as static files from `public/`
  - `main.js` — app orchestration, event listeners, stats panels
  - `search.js` — epic/project/sprint search UI and mode toggle
  - `developers.js` — developer loading, list rendering, estimation logic
  - `api.js` — Jira data fetching and issue normalization
  - `graph.js` — D3 force-directed dependency graph
  - `gantt.js` — critical path Gantt chart
  - `store.js` — shared client-side state
- **Auth**: Atlassian OAuth 2.0 (3-legged), tokens stored server-side in the session
- **Sessions**: In-memory by default; Redis supported by setting `REDIS_URL`

---

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- A Jira OAuth app (see below)

### 1. Create an Atlassian OAuth App

1. Go to [developer.atlassian.com](https://developer.atlassian.com/console/myapps/) and create a new app
2. Under **Authorization**, add an OAuth 2.0 callback URL: `http://localhost:8123/auth/jira/callback`
3. Under **Permissions → Jira API**, enable the classic scopes `read:jira-work` and `read:jira-user`
4. Note your **Client ID** and **Client Secret**

### 2. Configure Environment

Copy the example below into a `.env` file at the project root:

```env
PORT=8123
CORS_ORIGIN=http://localhost:8123
SESSION_SECRET=replace-with-a-long-random-string

JIRA_CLIENT_ID=your-client-id
JIRA_CLIENT_SECRET=your-client-secret
JIRA_REDIRECT_URI=http://localhost:8123/auth/jira/callback

ADMIN_EMAILS=you@yourcompany.com

# Optional — only needed if you want persistent sessions across restarts
# REDIS_URL=redis://localhost:6379
```

Generate a strong `SESSION_SECRET` with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install and Run

```bash
npm install
npm start
```

Open `http://localhost:8123` and click **Login with Jira**.

---

## Deployment (Google Cloud Run)

The app is packaged with a `Dockerfile` and ready to deploy to Cloud Run.

### Prerequisites

- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated
- A GCP project with Cloud Run and Secret Manager APIs enabled

### 1. Store Secrets in Secret Manager

```bash
echo -n "your-session-secret"    | gcloud secrets create SESSION_SECRET     --data-file=-
echo -n "your-client-id"         | gcloud secrets create JIRA_CLIENT_ID      --data-file=-
echo -n "your-client-secret"     | gcloud secrets create JIRA_CLIENT_SECRET  --data-file=-
```

The `JIRA_REDIRECT_URI` can be added after the first deploy once you have the Cloud Run URL.

### 2. Initial Deploy

```bash
gcloud run deploy jira-visualizer \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --set-env-vars NODE_ENV=production \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,JIRA_CLIENT_ID=JIRA_CLIENT_ID:latest,JIRA_CLIENT_SECRET=JIRA_CLIENT_SECRET:latest
```

### 3. Set the Redirect URI

After the first deploy, GCP will give you a URL like `https://jira-visualizer-xxxx-uc.a.run.app`. Then:

1. Add it as a secret:
    ```bash
    echo -n "https://jira-visualizer-xxxx-uc.a.run.app/auth/jira/callback" \
      | gcloud secrets create JIRA_REDIRECT_URI --data-file=-
    ```
2. Update the callback URL in your [Atlassian app settings](https://developer.atlassian.com/console/myapps/)
3. Redeploy with the secret included:
    ```bash
    gcloud run deploy jira-visualizer \
      --source . \
      --region us-central1 \
      --allow-unauthenticated \
      --max-instances 1 \
      --set-env-vars NODE_ENV=production,CORS_ORIGIN=https://jira-visualizer-xxxx-uc.a.run.app \
      --set-secrets SESSION_SECRET=SESSION_SECRET:latest,JIRA_CLIENT_ID=JIRA_CLIENT_ID:latest,JIRA_CLIENT_SECRET=JIRA_CLIENT_SECRET:latest,JIRA_REDIRECT_URI=JIRA_REDIRECT_URI:latest
    ```

### Notes on Sessions

The app uses **in-memory session storage** by default. With `--max-instances 1`, this works reliably — users will just need to re-login after a redeploy. If you need persistent sessions, set `REDIS_URL` to an [Upstash](https://upstash.com/) or other Redis instance.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Secret used to sign session cookies |
| `JIRA_CLIENT_ID` | Yes | Atlassian OAuth app client ID |
| `JIRA_CLIENT_SECRET` | Yes | Atlassian OAuth app client secret |
| `JIRA_REDIRECT_URI` | Yes | OAuth callback URL (must match Atlassian app settings) |
| `PORT` | No | Port to listen on (default: `8123`) |
| `CORS_ORIGIN` | No | Allowed CORS origin (set to your app's URL in production) |
| `ADMIN_EMAILS` | No | Comma-separated emails that can see developer velocity data |
| `REDIS_URL` | No | Redis connection string for persistent sessions |
