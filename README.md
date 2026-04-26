# Insighta Labs — Backend API

The Intelligence Engine powering the Insighta Labs platform. A secure, role-based REST API built with Express, TypeScript, Prisma, and PostgreSQL.

---

## System Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Portal    │     │   CLI Tool      │     │   Swagger UI    │
│ localhost:5173  │     │ (globally inst) │     │ localhost:3000  │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                        │
         └───────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Express API Server    │
                    │   localhost:3000        │
                    │   /api/v1/*             │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   PostgreSQL Database   │
                    │   via Prisma ORM        │
                    └─────────────────────────┘
```

---

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js v5
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: GitHub OAuth 2.0 + JWT (access + refresh tokens)
- **Docs**: Swagger UI (`/api/docs`)
- **Logging**: Morgan
- **Rate Limiting**: express-rate-limit

---

## Prerequisites

- Node.js 18+
- PostgreSQL database
- GitHub OAuth App ([create one here](https://github.com/settings/developers))

---

## Setup

```bash
git clone <backend-repo-url>
cd insighta-backend
npm install
```

Copy the example env file:

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/insight
JWT_ACCESS_SECRET=your_access_secret_here
JWT_REFRESH_SECRET=your_refresh_secret_here
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_CALLBACK_URL=http://localhost:3000/api/v1/auth/github/callback
FRONTEND_URL=http://localhost:5173
PORT=3000
NODE_ENV=development
```

Run database migrations:

```bash
npx prisma migrate dev
npx prisma generate
```

Start the server:

```bash
npm run dev       # development
npm run build     # production build
npm start         # production
```

---

## API Versioning

All endpoints are prefixed with `/api/v1/`. The version is included in the URL path to allow for future breaking changes without affecting existing clients.

---

## Authentication Flow

### Web Flow
1. Frontend redirects user to `GET /api/v1/auth/github?client=web`
2. Backend redirects to GitHub OAuth page
3. GitHub redirects back to `GET /api/v1/auth/github/callback`
4. Backend exchanges code for GitHub access token
5. Backend creates/updates user in database
6. Backend redirects to `FRONTEND_URL/?token=ACCESS_TOKEN&refresh_token=REFRESH_TOKEN`
7. Frontend stores tokens in localStorage and attaches as Bearer header

### CLI Flow
1. CLI requests auth URL from `GET /api/v1/auth/github?client=cli&redirect_uri=http://localhost:9876/callback`
2. Backend returns JSON with `auth_url`
3. CLI starts local HTTP server on port 9876 and opens auth URL in browser
4. User authenticates on GitHub
5. GitHub redirects to backend callback
6. Backend redirects to `http://localhost:9876/callback?access_token=...&refresh_token=...`
7. CLI local server captures tokens and saves to `~/.insighta/credentials.json`

---

## Token Handling

| Token | Expiry | Storage | Purpose |
|-------|--------|---------|---------|
| Access Token | 15 minutes | localStorage (web) / credentials.json (CLI) | Authenticate API requests |
| Refresh Token | 7 days | Database + localStorage (web) / credentials.json (CLI) | Obtain new access token |

Access tokens are sent as `Authorization: Bearer <token>` on every request. On 401 responses, clients automatically attempt a refresh before redirecting to login.

---

## Role Enforcement

Two roles exist: `admin` and `analyst`. Default role on signup is `analyst`.

| Operation | Admin | Analyst |
|-----------|-------|---------|
| List profiles | ✅ | ✅ |
| Search profiles | ✅ | ✅ |
| Get profile stats | ✅ | ✅ |
| Get profile by ID | ✅ | ✅ |
| Create profile | ✅ | ❌ |
| Update profile | ✅ | ❌ |
| Delete profile | ✅ | ❌ |
| Export profiles | ✅ | ❌ |

Role is encoded in the JWT payload and verified on every protected request. To promote a user to admin:

```sql
UPDATE users SET role = 'admin' WHERE username = 'your_username';
```

---

## Natural Language Parsing

The `/api/v1/profiles/search?q=` endpoint accepts plain English queries. The parser (`src/utils/parser.ts`) extracts:

- **Gender** — "males", "females", "men", "women"
- **Age group** — "young", "teenagers", "adults", "seniors", "children"
- **Age range** — "above 30", "under 25", "between 20 and 40"
- **Country** — matched against country names and ISO codes

Example queries:
```
young males from nigeria
females above 30
teenagers from kenya
adult males between 25 and 40
```

---

## Rate Limiting

- **Global**: 100 requests per 15 minutes per IP
- **Auth endpoints**: 20 requests per 15 minutes per IP
- **Auth callbacks**: exempt from rate limiting

---

## API Endpoints

Full interactive documentation available at `http://localhost:3000/api/docs`

### Auth
```
GET  /api/v1/auth/github              Initiate GitHub OAuth
GET  /api/v1/auth/github/callback     OAuth callback
POST /api/v1/auth/refresh             Refresh access token
POST /api/v1/auth/logout              Logout
GET  /api/v1/auth/me                  Get current user
POST /api/v1/auth/switch-role         Switch active role
```

### Profiles
```
GET    /api/v1/profiles               List profiles (filterable, paginated)
GET    /api/v1/profiles/search        Natural language search
GET    /api/v1/profiles/stats         Dashboard statistics
GET    /api/v1/profiles/export        Export CSV or JSON
GET    /api/v1/profiles/:id           Get single profile
POST   /api/v1/profiles               Create profile
PUT    /api/v1/profiles/:id           Update profile
DELETE /api/v1/profiles/:id           Delete profile
```

### Pagination Shape

```json
{
  "status": "success",
  "page": 1,
  "limit": 10,
  "total": 2026,
  "data": []
}
```

---

## Project Structure

```
src/
├── config/
│   └── swagger.ts          OpenAPI spec configuration
├── controllers/
│   ├── auth.controller.ts  Auth endpoint handlers
│   └── profile.controller.ts Profile endpoint handlers
├── middleware/
│   └── auth.middleware.ts  JWT verification + CSRF + role checks
├── routes/
│   ├── auth.routes.ts
│   └── profile.routes.ts
├── services/
│   ├── auth.service.ts     Token generation, user management
│   └── profile.service.ts  Profile CRUD, export, stats
├── utils/
│   ├── errors.ts           AppError class + handler
│   └── parser.ts           Natural language query parser
└── index.ts                Express app entry point
```