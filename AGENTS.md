# E-Commerce Backend Agent Guide

## Project Overview
This is a Node.js/Express e-commerce backend with MongoDB, real-time activity logging via Socket.IO, payment processing (Stripe), and image management (Cloudinary).

## Architecture & Key Patterns

### Layered Architecture
- **Routes** (`/routes`) — Express route definitions, mount all routes in `routes/index.js`
- **Controllers** (`/controllers`) — Request handlers (currently minimal; logic moved to services)
- **Services** (`/services`) — Business logic layer; most operations live here
- **Models** (`/models`) — Mongoose schemas with validation
- **Middlewares** (`/middlewares`) — Authentication, validation, error handling, file uploads
- **Utils** (`/utils`) — Helper functions and custom error class

### Core Patterns

#### Error Handling
- All errors use custom `endpointError` class from `/utils/endpointError.js`
- Constructor: `new endpointError(message, statusCode)`
- Centralized error middleware in `/middlewares/globalErrorMiddlewares.js`
- Development mode shows full stack traces; production shows only message
- Use `expressAsyncHandler` to wrap async route handlers

**Example:**
```javascript
const endpointError = require("../utils/endpointError");
app.get("/example", expressAsyncHandler(async (req, res, next) => {
  if (!item) throw new endpointError("Item not found", 404);
  res.json(item);
}));
```

#### Factory Pattern for CRUD
- `/services/handlersFactory.js` provides reusable CRUD handlers
- Maps models to activity types for Socket.IO logging
- When creating a new entity type, register it in `ACTIVITY_CONFIG` within handlersFactory

#### Validation
- Use `express-validator` for request validation
- Validators stored in `/utils/validators/` by resource type
- Apply validators as middleware in routes before handlers

#### Real-Time Activity Logging
- Socket.IO connection in `/socket/socketConfig.js` handles authentication and setup
- `ActivityLogger` class in `/socket/activityLogger.js` logs CRUD operations
- All data modifications should emit activity events
- Socket connections require JWT token authentication

### Environment Configuration
- Load environment via `dotenv` with context-specific files:
  - `.env.development` for dev
  - `.env.production` for production
- Critical variables checked at startup: `STRIPE_SECRET`, `MONGO_DB_URI`, `PORT`
- Add any new config requirements to startup checks in `server.js`

### Admin Account Creation
- `npm run create-admin` runs the interactive CLI at `scripts/createAdmin.js` to create a `role: "admin"` user (prompts for name/email/hidden password, hashes via the model's `pre("save")` hook).
- After creating the admin it sends a best-effort welcome email via `utils/sendEmail` (requires `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_USER`/`EMAIL_PASS`); if the email fails it only warns — the account is still created.
- It loads the same context-specific env file as `server.js` (`.env.development` / `.env.production`), so the same command works in dev and prod.

### Product Search Normalization
- Product keyword search (`GET /api/products?keyword=...`) matches against hidden, normalized fields: `searchName` / `searchDescription` (diacritic-stripped, Arabic-normalized, lowercased). This makes searches tolerant of accented Latin (`Résumé` ↔ `resume`) and Arabic letter variants (`أ/إ/آ → ا`, `ة → ه`, `ى → ي`).
- The fields are kept in sync automatically via the Product model's `pre("save")` and `pre("findOneAndUpdate")` hooks, using the shared `normalizeSearchText` util (`utils/searchNormalize.js`).
- They are `select: false`, so they never appear in API responses.
- Only product search normalizes the keyword (`normalizeKeyword: true` in `productServices.js`); other models (brand/category/user) still search their raw `name` field as before — don't normalize the keyword for them or accented/Arabic matching regresses.
- If the database is ever edited directly (non-Mongoose), re-sync by re-running the backfill: `node scripts/normalizeProductSearch.js` (or `NODE_ENV=production node scripts/normalizeProductSearch.js`).
- Production: `NODE_ENV=production npm run create-admin` (Windows cmd: `set NODE_ENV=production && npm run create-admin`; PowerShell: `$env:NODE_ENV="production"; npm run create-admin`).
- Fails if the email already exists; only warns (does not block) when other admins already exist.
- Rotate/delete credentials after first login on a production box.

### API Route Structure
- All routes prefixed with `/api/`
- Exception: Orders use `/api/v1/orders`, Analytics use `/api/v1/analytics`
- Mount new routes in `/routes/index.js` using `app.use()`

**Current routes:**
- `/api/categories`, `/api/subcategories`, `/api/brands`
- `/api/products`
- `/api/users`, `/api/auth`
- `/api/cart`, `/api/wishlist`
- `/api/addresses`
- `/api/v1/orders`, `/api/v1/analytics`
- `/api/activities`

## Key Dependencies
| Package | Purpose |
|---------|---------|
| `mongoose` | MongoDB ORM |
| `socket.io` | Real-time communication |
| `stripe` | Payment processing |
| `cloudinary` | Image storage & management |
| `express-validator` | Request validation |
| `multer` + `multer-storage-cloudinary` | File uploads to Cloudinary |
| `nodemailer` | Email notifications |
| `jsonwebtoken` | JWT authentication |
| `express-rate-limit` | Rate limiting |
| `hpp`, `compression`, `cors` | Security & optimization |

## Development Commands
```bash
npm run dev    # Run with nodemon (watches for changes)
npm start      # Production mode
```

## Common Tasks

### Adding a New Resource Type
1. Create model in `/models/[resourceName]Model.js`
2. Create service in `/services/[resourceName]Services.js` with CRUD methods
3. Create validators in `/utils/validators/[resourceName]Validators.js`
4. Create route file in `/routes/[resource]Routes.js`
5. Register route in `/routes/index.js`
6. Add resource to `ACTIVITY_CONFIG` in `/services/handlersFactory.js`

### Adding Authentication/Authorization
- Auth logic in `/services/authServices.js`
- JWT tokens created via `/utils/createToken.js`
- Socket.IO uses the same JWT verification in `socketConfig.js`

### Handling File Uploads
- Multer configured for Cloudinary in middlewares
- Use `uploadImageMiddleware` in routes
- Image URLs stored in Cloudinary, references in database

### Adding Real-Time Events
- Emit events in services after data mutations
- Use `socketEmitter` from `/utils/socketEmitter.js`
- Register handlers in `/socket/socketHandlers.js`

## Important Notes
- **No .env files committed** — provide examples or document required vars
- **Mongoose models use validation** — always validate schema fields
- **Activity logging is automatic** for tracked resources via factory pattern
- **Socket connections require authentication** — tokens verified in `socketConfig.js`
- **Orders and Analytics use v1 prefix** — indicates API versioning strategy
- **Express 5.1.0** — uses newer features, ensure compatibility when adding middleware

## File Organization Rules
- Services contain all business logic; controllers are thin
- Validators are separate from routes for reusability
- Models contain only schema definition and basic validation
- Socket handlers in `/socket/` separate from HTTP request handling
- Utils for cross-cutting concerns (error handling, tokens, formatters)

## When Modifying Services
- Always use `expressAsyncHandler` for async functions
- Throw `endpointError` with appropriate status codes
- Log activity after successful mutations (factory pattern handles this)
- Return clean data structures, not raw Mongoose documents when possible

## Performance Considerations
- Compression enabled in `server.js` (gzip)
- Rate limiting configured in `server.js`
- MongoDB indexes should be added to frequently queried fields
- Socket.IO uses polling fallback for compatibility

If anything here is unclear, ask for details before making behavioral changes.

