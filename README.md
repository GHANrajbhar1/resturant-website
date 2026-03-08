# SpiceRoot Restaurant Website (Full Stack)

Fully responsive restaurant website with:
- Dynamic menu and cart
- Reservation API + database storage
- Contact API + optional email integration
- Razorpay-first online payment flow (India friendly) with Stripe fallback
- Free checkout options: COD and direct UPI intent (no gateway required)
- Admin panel for reservations and messages
- PWA manifest + service worker caching

## Tech Stack

- Frontend: HTML, Tailwind CDN, custom CSS, vanilla JS
- Backend: Node.js, Express
- Database: SQLite (`better-sqlite3`)
- Payments: Razorpay + Stripe (fallback)
- Email: Nodemailer (SMTP)

## 1. Install

```powershell
npm install
```

## 2. Configure environment

```powershell
Copy-Item .env.example .env
```

Update `.env` values:
- `ADMIN_AUTH_SECRET`: token signature secret for admin login
- `ADMIN_USERS_JSON`: JSON array of admin users with roles (`owner`, `manager`, `staff`)
- `ADMIN_API_KEY`: optional legacy key mode fallback
- `PUBLIC_BASE_URL`: e.g. `http://localhost:5500`
- `DB_FILE`: SQLite file path (default: `spiceroot.db`)
- `STRIPE_SECRET_KEY`: Stripe secret key for real payments
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret
- `RAZORPAY_KEY_ID`: Razorpay key id
- `RAZORPAY_KEY_SECRET`: Razorpay key secret
- `RAZORPAY_WEBHOOK_SECRET`: Razorpay webhook secret
- SMTP fields for contact email delivery
- `UPI_VPA`: your UPI ID for free UPI intent checkout
- `UPI_NAME`: payee name shown in UPI app
- `MAX_GUESTS_PER_SLOT`: max guest capacity per reservation slot
- `SLOT_INTERVAL_MINUTES`: slot interval in minutes

## 3. Run

```powershell
npm run dev
```

Open:
- Website: `http://localhost:5500`
- Admin panel: `http://localhost:5500/admin`

## 4. Admin usage

1. Open `/admin`
2. Login with admin username/password from `ADMIN_USERS_JSON` (or use legacy key fallback)
3. Click `Load Data`
4. Update reservation status directly from panel

## API Endpoints

- `GET /api/health`
- `GET /api/config`
- `GET /api/reservations/availability?date=YYYY-MM-DD`
- `POST /api/reservations`
- `POST /api/contact`
- `POST /api/payments/create-checkout-session`
- `POST /api/payments/verify-razorpay`
- `POST /api/payments/razorpay-webhook`
- `POST /api/payments/stripe-webhook`
- `POST /api/admin/login`
- `GET /api/admin/reservations` (requires admin auth: Bearer token or legacy `x-admin-key`)
- `PATCH /api/admin/reservations/:id/status` (requires manager/owner role)
- `GET /api/admin/messages` (requires admin auth)
- `GET /api/admin/orders` (requires admin auth)
- `PATCH /api/admin/orders/:id/status` (requires manager/owner; `cancelled/refunded` owner only)
- `GET /api/admin/analytics` (requires admin auth)

## Notes

- Razorpay is used as primary online gateway when configured.
- If Razorpay is missing but Stripe exists, Stripe checkout is used as fallback.
- If both Razorpay and Stripe are missing, users can still order via `COD` and `UPI (free)`.
- Stripe and Razorpay webhook handlers are idempotent (duplicate retry events are safely ignored).
- If SMTP is missing, contact messages still save to database and can be viewed in admin panel.
- SQLite database file is `spiceroot.db`.

## Deploy

### Render (recommended)

1. Push code to GitHub.
2. In Render, create new Web Service and select repo.
3. Render auto-detects `render.yaml`.
4. Set secret env values in Render dashboard:
   - `PUBLIC_BASE_URL` (your Render app URL)
   - `ADMIN_API_KEY`
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (recommended)
   - `STRIPE_SECRET_KEY` (optional fallback)
   - SMTP vars (optional)
   - `UPI_VPA`, `UPI_NAME` (optional but recommended)
5. Deploy. Health endpoint: `/api/health`

### Docker

```powershell
docker build -t spiceroot .
docker run -p 5500:5500 --env-file .env -v ${PWD}\\data:/app/data spiceroot
```
