# Anurag Meds — Payments & SQL API (Render)

This service powers Razorpay payments and basic SQL auth/prescription APIs for the **Anurag Meds** project.

## Endpoints

### Payment (Razorpay)

- `POST /create-order`  
  Body: `{ "amount": number, "currency?": "INR", "receipt?": "string" }`  
  Response: `{ ok: true, orderId: string, amount: number, currency: string, keyId: string }`

- `POST /verify`  
  Body: `{ "razorpay_order_id": string, "razorpay_payment_id": string, "razorpay_signature": string }`  
  Response: `{ ok: boolean, valid: boolean }`

### Auth (JWT)

- `POST /sql/auth/register`  
  Body: `{ email: string, password: string, name?: string, phone?: string, role?: "user" | "admin" }`  
  Response: `{ ok: true, user: { id, email, name, phone, role }, token }`

- `POST /sql/auth/login`  
  Body: `{ email: string, password: string }`  
  Response: `{ ok: true, token, user }`

- `GET /sql/me` (Authorization: `Bearer <token>`)  
  Response: `{ ok: true, user }`

### Prescriptions (store image bytes in MySQL)

- `POST /sql/prescriptions` (Authorization: `Bearer <token>`)  
  Content-Type: `multipart/form-data` with fields: `fullName`, `phone`, `address?`, file field name: `file`  
  Response: `{ ok: true, id }`

- `GET /sql/prescriptions` (Authorization: `Bearer <token>`)  
  Admin users (`role=admin`) receive all prescriptions; regular users receive only their own.

- `GET /sql/prescriptions/:id/file` (Authorization: `Bearer <token>`)  
  Streams the stored file bytes for a prescription.

### Health

- `GET /sql/health` → `{ ok: true }` if DB connectivity is working.

## Environment variables

Create a `.env` in this folder with values:

```
# Razorpay Test/Live keys
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxxxxxxx

# JWT secret for issuing tokens
JWT_SECRET=please-change-me

# MySQL connection (remote DB)
# For Hostinger shared MySQL, use the *remote host name* (not 127.0.0.1) and whitelist your Render egress IP in Hostinger > Databases > Remote MySQL.
DB_HOST=<your-mysql-hostname>
DB_PORT=3306
DB_USER=<your-db-username>
DB_PASSWORD=<your-db-password>
DB_NAME=u259941502_Center_Website
```

> The service also supports environment variable names `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` if your provider exposes those by default.

## Running locally

```
# inside /payments-server
npm install
npm run dev
```

In your frontend, point to the local backend during development:

```html
<!-- payments-config.js -->
window.RAZORPAY_BACKEND_URL = "http://localhost:3002";
```

## Notes for Hostinger / Remote MySQL

- Hostinger lists `Host` as `localhost` for internal connections. From Render (or any external server), you must use Hostinger's **public MySQL hostname** and whitelist your Render egress IP in Hostinger (MySQL Remote Access).
- If Hostinger does not allow external MySQL access on your plan, consider using a managed DB with public endpoints (e.g., Neon, PlanetScale) or move your Node service to the same host as the DB.
