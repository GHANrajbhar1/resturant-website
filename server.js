require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const nodemailer = require("nodemailer");
const Razorpay = require("razorpay");
const Stripe = require("stripe");

const db = require("./server/db");
const { MENU_ITEMS } = require("./server/menu-data");

const app = express();
const publicWriteRateBuckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of publicWriteRateBuckets.entries()) {
    if (now > value.resetAt) {
      publicWriteRateBuckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

const PORT = Number(process.env.PORT || 5500);
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const RAZORPAY_KEY_ID = String(process.env.RAZORPAY_KEY_ID || "").trim();
const RAZORPAY_KEY_SECRET = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
const RAZORPAY_WEBHOOK_SECRET = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const UPI_VPA = String(process.env.UPI_VPA || "").trim();
const UPI_NAME = String(process.env.UPI_NAME || "SpiceRoot").trim();
const MAX_GUESTS_PER_SLOT = Math.max(1, Number(process.env.MAX_GUESTS_PER_SLOT || 40));
const SLOT_INTERVAL_MINUTES = Math.max(15, Number(process.env.SLOT_INTERVAL_MINUTES || 30));
const ADMIN_AUTH_SECRET = String(process.env.ADMIN_AUTH_SECRET || ADMIN_API_KEY || "").trim();

function hasRealStripeKey(value) {
  const key = String(value || "").trim();
  if (!key) return false;
  if (key.includes("replace_me") || key.includes("your_key")) return false;
  return key.startsWith("sk_live_") || key.startsWith("sk_test_");
}

function hasRealRazorpayConfig(keyId, keySecret) {
  if (!keyId || !keySecret) return false;
  if (
    keyId.includes("replace_me") ||
    keySecret.includes("replace_me") ||
    keyId.includes("your_key") ||
    keySecret.includes("your_key")
  ) {
    return false;
  }
  return keyId.startsWith("rzp_");
}

const razorpay = hasRealRazorpayConfig(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
  ? new Razorpay({
      key_id: RAZORPAY_KEY_ID,
      key_secret: RAZORPAY_KEY_SECRET
    })
  : null;

const stripe = hasRealStripeKey(STRIPE_SECRET_KEY) ? new Stripe(STRIPE_SECRET_KEY) : null;

function normalizeRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (["owner", "manager", "staff"].includes(role)) return role;
  return "staff";
}

function parseAdminUsers() {
  const raw = String(process.env.ADMIN_USERS_JSON || "").trim();
  if (!raw) {
    if (!ADMIN_API_KEY) return [];
    return [{ username: "owner", password: ADMIN_API_KEY, role: "owner" }];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        username: String(entry?.username || "").trim(),
        password: String(entry?.password || ""),
        role: normalizeRole(entry?.role)
      }))
      .filter((entry) => entry.username && entry.password);
  } catch (_) {
    return [];
  }
}

const ADMIN_USERS = parseAdminUsers();

const smtpConfigured =
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.CONTACT_RECEIVER_EMAIL;

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

function printStartupChecklist() {
  const envPath = path.join(__dirname, ".env");
  const hasEnvFile = fs.existsSync(envPath);
  const diagnostics = getConfigDiagnostics();

  console.log("==== SpiceRoot Startup Checklist ====");
  console.log(`.env file: ${hasEnvFile ? "FOUND" : "MISSING (create from .env.example)"}`);

  if (diagnostics.adminConfigured) {
    console.log(`Admin APIs: ENABLED (${diagnostics.adminAuthMode})`);
  } else {
    console.warn(`Admin APIs: DISABLED (missing: ${diagnostics.missingAdmin.join(", ")})`);
  }

  if (diagnostics.stripeEnabled) {
    console.log("Stripe payments: ENABLED");
  } else {
    console.warn(`Stripe payments: DISABLED (missing/invalid: ${diagnostics.missingStripe.join(", ")})`);
  }

  if (diagnostics.razorpayEnabled) {
    console.log("Razorpay payments: ENABLED (primary)");
  } else {
    console.warn(`Razorpay payments: DISABLED (missing/invalid: ${diagnostics.missingRazorpay.join(", ")})`);
  }

  if (diagnostics.razorpayWebhookEnabled) {
    console.log("Razorpay webhook: ENABLED");
  } else if (diagnostics.razorpayEnabled) {
    console.warn("Razorpay webhook: DISABLED (missing: RAZORPAY_WEBHOOK_SECRET)");
  }

  if (diagnostics.stripeWebhookEnabled) {
    console.log("Stripe webhook: ENABLED");
  } else if (diagnostics.stripeEnabled) {
    console.warn("Stripe webhook: DISABLED (missing: STRIPE_WEBHOOK_SECRET)");
  }

  if (diagnostics.smtpEnabled) {
    console.log("SMTP emails: ENABLED");
  } else {
    console.warn(`SMTP emails: DISABLED (missing: ${diagnostics.missingSmtp.join(", ")})`);
  }

  if (
    !hasEnvFile ||
    !diagnostics.adminConfigured ||
    (!diagnostics.razorpayEnabled && !diagnostics.stripeEnabled) ||
    !diagnostics.smtpEnabled
  ) {
    console.log("Tip: Update .env and restart server after changes.");
  }
  console.log("====================================");
}

function getConfigDiagnostics() {
  const missingAdmin = [];
  const missingRazorpay = [];
  const missingStripe = [];
  const missingSmtp = [];

  if (!ADMIN_API_KEY && ADMIN_USERS.length === 0) {
    missingAdmin.push("ADMIN_API_KEY or ADMIN_USERS_JSON");
  }

  if (!ADMIN_AUTH_SECRET) {
    missingAdmin.push("ADMIN_AUTH_SECRET");
  }

  if (!RAZORPAY_KEY_ID) {
    missingRazorpay.push("RAZORPAY_KEY_ID");
  }
  if (!RAZORPAY_KEY_SECRET) {
    missingRazorpay.push("RAZORPAY_KEY_SECRET");
  }
  if (
    RAZORPAY_KEY_ID &&
    RAZORPAY_KEY_SECRET &&
    !hasRealRazorpayConfig(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)
  ) {
    missingRazorpay.push("RAZORPAY keys (invalid/placeholder)");
  }

  if (!STRIPE_SECRET_KEY) {
    missingStripe.push("STRIPE_SECRET_KEY");
  } else if (!hasRealStripeKey(STRIPE_SECRET_KEY)) {
    missingStripe.push("STRIPE_SECRET_KEY (invalid/placeholder)");
  }

  const smtpVars = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "CONTACT_RECEIVER_EMAIL"
  ];
  for (const key of smtpVars) {
    if (!process.env[key]) {
      missingSmtp.push(key);
    }
  }

  return {
    adminConfigured: missingAdmin.length === 0,
    adminAuthMode: ADMIN_USERS.length ? "token+roles" : "api-key",
    razorpayEnabled: Boolean(razorpay),
    razorpayWebhookEnabled: Boolean(razorpay && RAZORPAY_WEBHOOK_SECRET),
    stripeEnabled: Boolean(stripe),
    primaryPaymentProvider: razorpay ? "razorpay" : stripe ? "stripe" : null,
    stripeWebhookEnabled: Boolean(stripe && STRIPE_WEBHOOK_SECRET),
    smtpEnabled: Boolean(transporter),
    upiConfigured: Boolean(UPI_VPA),
    missingAdmin,
    missingRazorpay,
    missingStripe,
    missingSmtp,
    missingUpi: UPI_VPA ? [] : ["UPI_VPA"]
  };
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.tailwindcss.com",
          "https://checkout.razorpay.com"
        ],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://api.razorpay.com"],
        frameSrc: [
          "'self'",
          "https://maps.google.com",
          "https://www.google.com",
          "https://checkout.razorpay.com"
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        manifestSrc: ["'self'"],
        upgradeInsecureRequests: null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);
app.use(compression());
app.post(
  "/api/payments/stripe-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Stripe webhook is not configured on server." });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing Stripe signature header." });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      return res.status(400).json({ error: `Webhook signature verification failed: ${error.message}` });
    }

    const stripeEventId = String(event?.id || "");
    if (!stripeEventId) {
      return res.status(400).json({ error: "Stripe webhook payload missing event id." });
    }

    const registered = registerWebhookEvent("stripe", stripeEventId, req.body);
    if (registered.isDuplicate) {
      markWebhookEventStatus("stripe", stripeEventId, "duplicate");
      return res.json({ received: true, duplicate: true });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        orderStatusBySessionUpdate.run({ stripe_session_id: session.id, status: "paid" });
      } else if (
        event.type === "checkout.session.async_payment_failed" ||
        event.type === "checkout.session.expired"
      ) {
        const session = event.data.object;
        orderStatusBySessionUpdate.run({ stripe_session_id: session.id, status: "failed" });
      }
      markWebhookEventStatus("stripe", stripeEventId, "processed");
      return res.json({ received: true });
    } catch (error) {
      markWebhookEventStatus("stripe", stripeEventId, "error");
      console.error("Stripe webhook processing failed:", error);
      return res.status(500).json({ error: "Failed to process webhook event." });
    }
  }
);
app.post(
  "/api/payments/razorpay-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!razorpay || !RAZORPAY_WEBHOOK_SECRET) {
      return res.status(503).json({ error: "Razorpay webhook is not configured on server." });
    }

    const signatureHeader = String(req.headers["x-razorpay-signature"] || "");
    if (!signatureHeader) {
      return res.status(400).json({ error: "Missing Razorpay signature header." });
    }

    const expected = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest("hex");

    const left = Buffer.from(signatureHeader, "utf8");
    const right = Buffer.from(expected, "utf8");
    const signatureValid = left.length === right.length && crypto.timingSafeEqual(left, right);
    if (!signatureValid) {
      return res.status(400).json({ error: "Invalid Razorpay webhook signature." });
    }

    let event;
    try {
      event = JSON.parse(req.body.toString("utf8"));
    } catch (_) {
      return res.status(400).json({ error: "Invalid webhook payload JSON." });
    }

    const razorpayEventHeader = String(req.headers["x-razorpay-event-id"] || "").trim();
    const paymentId = String(event?.payload?.payment?.entity?.id || "").trim();
    const baseEventId = razorpayEventHeader || paymentId;
    const razorpayEventId = baseEventId
      ? `${baseEventId}:${String(event?.event || "unknown")}`
      : `${getPayloadHash(req.body)}:${String(event?.event || "unknown")}`;
    const registered = registerWebhookEvent("razorpay", razorpayEventId, req.body);
    if (registered.isDuplicate) {
      markWebhookEventStatus("razorpay", razorpayEventId, "duplicate");
      return res.json({ received: true, duplicate: true });
    }

    try {
      const type = String(event?.event || "");
      const paymentEntity = event?.payload?.payment?.entity || {};
      const razorpayOrderId = String(paymentEntity?.order_id || "");

      if (razorpayOrderId) {
        if (type === "payment.captured") {
          orderStatusBySessionUpdate.run({
            stripe_session_id: `razorpay:${razorpayOrderId}`,
            status: "paid"
          });
        } else if (type === "payment.failed") {
          orderStatusBySessionUpdate.run({
            stripe_session_id: `razorpay:${razorpayOrderId}`,
            status: "failed"
          });
        }
      }
      markWebhookEventStatus("razorpay", razorpayEventId, "processed");
      return res.json({ received: true });
    } catch (error) {
      markWebhookEventStatus("razorpay", razorpayEventId, "error");
      console.error("Razorpay webhook processing failed:", error);
      return res.status(500).json({ error: "Failed to process Razorpay webhook event." });
    }
  }
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use("/assets", express.static(path.join(__dirname, "assets")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/index.html", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/admin.html", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/manifest.webmanifest", (req, res) => {
  res.sendFile(path.join(__dirname, "manifest.webmanifest"));
});

app.get("/sw.js", (req, res) => {
  res.sendFile(path.join(__dirname, "sw.js"));
});

const reservationInsert = db.prepare(`
  INSERT INTO reservations (name, phone, date, time, guests, occasion)
  VALUES (@name, @phone, @date, @time, @guests, @occasion)
`);

const messageInsert = db.prepare(`
  INSERT INTO messages (name, email, message)
  VALUES (@name, @email, @message)
`);

const reservationList = db.prepare(`
  SELECT id, name, phone, date, time, guests, occasion, status, created_at
  FROM reservations
  ORDER BY datetime(created_at) DESC
`);

const reservationStatusUpdate = db.prepare(`
  UPDATE reservations
  SET status = @status
  WHERE id = @id
`);

const reservationSlotGuestSum = db.prepare(`
  SELECT COALESCE(SUM(guests), 0) AS total_guests
  FROM reservations
  WHERE date = @date
    AND time = @time
    AND status IN ('pending', 'confirmed')
`);

const messageList = db.prepare(`
  SELECT id, name, email, message, status, created_at
  FROM messages
  ORDER BY datetime(created_at) DESC
`);

const orderInsert = db.prepare(`
  INSERT INTO orders (stripe_session_id, total_inr, total_items, status)
  VALUES (@stripe_session_id, @total_inr, @total_items, 'created')
`);

const orderItemInsert = db.prepare(`
  INSERT INTO order_items (order_id, item_name, qty, unit_price_inr)
  VALUES (@order_id, @item_name, @qty, @unit_price_inr)
`);

const orderList = db.prepare(`
  SELECT
    o.id,
    o.stripe_session_id,
    o.total_inr,
    o.total_items,
    o.status,
    o.created_at,
    COALESCE(GROUP_CONCAT(oi.item_name || ' x' || oi.qty, ', '), '') AS items_summary
  FROM orders o
  LEFT JOIN order_items oi ON oi.order_id = o.id
  GROUP BY o.id
  ORDER BY datetime(o.created_at) DESC
`);

const orderStatusUpdate = db.prepare(`
  UPDATE orders
  SET status = @status
  WHERE id = @id
`);

const orderStatusBySessionUpdate = db.prepare(`
  UPDATE orders
  SET status = @status
  WHERE stripe_session_id = @stripe_session_id
`);

const adminAnalyticsQuery = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM reservations) AS total_reservations,
    (SELECT COUNT(*) FROM messages) AS total_messages,
    (SELECT COUNT(*) FROM orders) AS total_orders,
    (
      SELECT COALESCE(SUM(total_inr), 0)
      FROM orders
      WHERE date(created_at, 'localtime') = date('now', 'localtime')
        AND status NOT IN ('cancelled', 'failed', 'refunded')
    ) AS today_revenue_inr,
    (SELECT COUNT(*) FROM reservations WHERE status = 'pending') AS pending_reservations,
    (
      SELECT COUNT(*)
      FROM orders
      WHERE status IN ('created', 'paid', 'confirmed', 'preparing', 'out_for_delivery')
    ) AS active_orders
`);

const adminAuditInsert = db.prepare(`
  INSERT INTO admin_audit_logs (actor_ip, action, meta_json)
  VALUES (@actor_ip, @action, @meta_json)
`);

const webhookEventInsert = db.prepare(`
  INSERT OR IGNORE INTO webhook_events (provider, event_id, payload_hash, status)
  VALUES (@provider, @event_id, @payload_hash, 'received')
`);

const webhookEventStatusUpdate = db.prepare(`
  UPDATE webhook_events
  SET status = @status
  WHERE provider = @provider AND event_id = @event_id
`);

function requireAdmin(req, res, next) {
  const authHeader = String(req.header("authorization") || "");
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const payload = verifyAdminToken(token);
    if (payload) {
      req.adminUser = {
        username: payload.sub,
        role: payload.role,
        authMode: "token"
      };
      return next();
    }
  }

  if (ADMIN_API_KEY && req.header("x-admin-key") === ADMIN_API_KEY) {
    req.adminUser = {
      username: "legacy-admin-key",
      role: "owner",
      authMode: "api-key"
    };
    return next();
  }

  return res.status(401).json({ error: "Unauthorized admin request." });
}

function roleRank(role) {
  if (role === "owner") return 3;
  if (role === "manager") return 2;
  return 1;
}

function requireRole(minRole) {
  const minRank = roleRank(minRole);
  return (req, res, next) => {
    const currentRole = req.adminUser?.role || "staff";
    if (roleRank(currentRole) < minRank) {
      return res.status(403).json({ error: `Forbidden. ${minRole} role required.` });
    }
    return next();
  };
}

function signAdminToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ADMIN_AUTH_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

function verifyAdminToken(token) {
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature || !ADMIN_AUTH_SECRET) return null;
    const expected = crypto.createHmac("sha256", ADMIN_AUTH_SECRET).update(body).digest("base64url");
    if (signature !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.sub || !payload?.role || !payload?.exp) return null;
    if (Date.now() >= Number(payload.exp) * 1000) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function findAdminUser(username) {
  const normalized = String(username || "").trim().toLowerCase();
  return ADMIN_USERS.find((user) => user.username.toLowerCase() === normalized) || null;
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function getErrorDetail(error) {
  const parts = [
    error?.error?.description,
    error?.error?.reason,
    error?.error?.message,
    error?.description,
    error?.reason,
    error?.message
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (parts.length) return parts[0];

  try {
    return JSON.stringify(error);
  } catch (_) {
    return String(error || "Unknown error");
  }
}

function getReservationSlots() {
  const slots = [];
  const startMinutes = 12 * 60;
  const endMinutes = 23 * 60;
  for (let minutes = startMinutes; minutes < endMinutes; minutes += SLOT_INTERVAL_MINUTES) {
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    slots.push(`${hh}:${mm}`);
  }
  return slots;
}

function isSupportedReservationTime(input) {
  return getReservationSlots().includes(String(input || ""));
}

function getSlotCapacity(date, time) {
  const row = reservationSlotGuestSum.get({ date, time });
  const bookedGuests = Number(row?.total_guests || 0);
  return {
    bookedGuests,
    availableGuests: Math.max(0, MAX_GUESTS_PER_SLOT - bookedGuests)
  };
}

function logAdminAction(req, action, meta = {}) {
  try {
    const actor = req.adminUser || {};
    adminAuditInsert.run({
      actor_ip: getClientIp(req),
      action,
      meta_json: JSON.stringify({
        actorUsername: actor.username || "unknown",
        actorRole: actor.role || "unknown",
        actorAuthMode: actor.authMode || "unknown",
        ...meta
      })
    });
  } catch (error) {
    console.error("Failed to write admin audit log:", error.message);
  }
}

function isValidDate(input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const parsed = new Date(`${input}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function isValidTime(input) {
  if (!/^\d{2}:\d{2}$/.test(input)) return false;
  const [hh, mm] = String(input).split(":").map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

function normalizeCart(items) {
  if (!Array.isArray(items)) return [];
  const cleaned = [];
  for (const entry of items) {
    const id = Number(entry.id);
    const qty = Number(entry.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 25) continue;
    const found = MENU_ITEMS.find((item) => item.id === id);
    if (!found) continue;
    cleaned.push({ id, qty, name: found.name, priceInr: found.priceInr });
  }
  return cleaned;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function getPayloadHash(rawBody) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

function registerWebhookEvent(provider, eventId, rawBody) {
  const payloadHash = getPayloadHash(rawBody);
  const result = webhookEventInsert.run({
    provider,
    event_id: eventId,
    payload_hash: payloadHash
  });
  return {
    isDuplicate: result.changes === 0,
    payloadHash
  };
}

function markWebhookEventStatus(provider, eventId, status) {
  webhookEventStatusUpdate.run({
    provider,
    event_id: eventId,
    status
  });
}

function createRateLimitMiddleware({ keyPrefix, windowMs, maxRequests }) {
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = `${keyPrefix}:${getClientIp(req)}`;
    const existing = publicWriteRateBuckets.get(bucketKey);

    if (!existing || now > existing.resetAt) {
      publicWriteRateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (existing.count >= maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        error: "Too many requests. Please try again shortly."
      });
    }

    existing.count += 1;
    return next();
  };
}

const reservationRateLimit = createRateLimitMiddleware({
  keyPrefix: "reservation",
  windowMs: 15 * 60 * 1000,
  maxRequests: 15
});

const contactRateLimit = createRateLimitMiddleware({
  keyPrefix: "contact",
  windowMs: 15 * 60 * 1000,
  maxRequests: 10
});

app.post("/api/admin/login", (req, res) => {
  if (!ADMIN_USERS.length) {
    return res.status(503).json({ error: "Admin users are not configured on server." });
  }
  if (!ADMIN_AUTH_SECRET) {
    return res.status(503).json({ error: "ADMIN_AUTH_SECRET is not configured on server." });
  }

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const user = findAdminUser(username);
  if (!user || !secureEqual(password, user.password)) {
    return res.status(401).json({ error: "Invalid admin credentials." });
  }

  const expiresInSec = 8 * 60 * 60;
  const token = signAdminToken({
    sub: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + expiresInSec
  });

  return res.json({
    token,
    expiresInSec,
    user: {
      username: user.username,
      role: user.role
    }
  });
});

app.get("/api/reservations/availability", (req, res) => {
  const date = String(req.query?.date || "");
  if (!isValidDate(date)) {
    return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });
  }

  const slots = getReservationSlots().map((time) => {
    const capacity = getSlotCapacity(date, time);
    return {
      time,
      bookedGuests: capacity.bookedGuests,
      availableGuests: capacity.availableGuests,
      isAvailable: capacity.availableGuests > 0
    };
  });

  return res.json({
    date,
    slotIntervalMinutes: SLOT_INTERVAL_MINUTES,
    maxGuestsPerSlot: MAX_GUESTS_PER_SLOT,
    slots
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    razorpayEnabled: Boolean(razorpay),
    razorpayWebhookEnabled: Boolean(razorpay && RAZORPAY_WEBHOOK_SECRET),
    stripeEnabled: Boolean(stripe),
    stripeWebhookEnabled: Boolean(stripe && STRIPE_WEBHOOK_SECRET),
    smtpEnabled: Boolean(transporter)
  });
});

app.get("/api/config", (req, res) => {
  res.json(getConfigDiagnostics());
});

app.get("/api/admin/status", (req, res) => {
  const diagnostics = getConfigDiagnostics();
  res.json({
    adminConfigured: diagnostics.adminConfigured,
    adminAuthMode: diagnostics.adminAuthMode,
    tokenLoginEnabled: ADMIN_USERS.length > 0 && Boolean(ADMIN_AUTH_SECRET),
    legacyKeyEnabled: Boolean(ADMIN_API_KEY)
  });
});

app.post("/api/reservations", reservationRateLimit, (req, res) => {
  const { name, phone, date, time, guests, occasion } = req.body || {};
  const guestCount = Number(guests);

  if (!name || !phone || !isValidDate(date) || !isValidTime(time) || !Number.isInteger(guestCount)) {
    return res.status(400).json({ error: "Please provide valid reservation details." });
  }
  if (!isSupportedReservationTime(time)) {
    return res.status(400).json({
      error: "Unsupported reservation time. Please choose a valid slot."
    });
  }
  if (guestCount < 1 || guestCount > 20) {
    return res.status(400).json({ error: "Guests must be between 1 and 20." });
  }

  const { availableGuests } = getSlotCapacity(String(date), String(time));
  if (guestCount > availableGuests) {
    return res.status(409).json({
      error: `Selected slot is nearly full. Only ${availableGuests} seats left.`,
      availableGuests
    });
  }

  const result = reservationInsert.run({
    name: String(name).trim(),
    phone: String(phone).trim(),
    date: String(date),
    time: String(time),
    guests: guestCount,
    occasion: occasion ? String(occasion).trim() : ""
  });

  return res.status(201).json({
    message: "Reservation submitted successfully.",
    reservationId: result.lastInsertRowid
  });
});

app.post("/api/contact", contactRateLimit, async (req, res) => {
  const { name, email, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: "Name, email, and message are required." });
  }

  const result = messageInsert.run({
    name: String(name).trim(),
    email: String(email).trim(),
    message: String(message).trim()
  });

  if (transporter) {
    try {
      await transporter.sendMail({
        from: process.env.SMTP_USER,
        to: process.env.CONTACT_RECEIVER_EMAIL,
        subject: `New Contact Message (#${result.lastInsertRowid})`,
        text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`
      });
    } catch (error) {
      const errorDetail = getErrorDetail(error);
      console.error("SMTP send failed:", errorDetail);
      if (
        /invalid login|badcredentials|username and password not accepted|auth/i.test(
          errorDetail.toLowerCase()
        )
      ) {
        console.error(
          "SMTP auth hint: Use SMTP app password and make sure SMTP_USER matches the sender account."
        );
      }
    }
  }

  return res.status(201).json({
    message: "Message received. Our team will contact you shortly.",
    contactId: result.lastInsertRowid
  });
});

app.post("/api/payments/create-checkout-session", async (req, res) => {
  const items = normalizeCart(req.body?.items);
  if (!items.length) {
    return res.status(400).json({ error: "Cart is empty or invalid." });
  }

  if (!razorpay && !stripe) {
    return res.status(503).json({ error: "No online payment provider is configured on server." });
  }

  const totalInr = items.reduce((sum, item) => sum + item.qty * item.priceInr, 0);
  const totalItems = items.reduce((sum, item) => sum + item.qty, 0);

  if (razorpay) {
    try {
      const razorpayOrder = await razorpay.orders.create({
        amount: totalInr * 100,
        currency: "INR",
        receipt: `spiceroot-${Date.now()}`
      });

      const orderId = orderInsert.run({
        stripe_session_id: `razorpay:${razorpayOrder.id}`,
        total_inr: totalInr,
        total_items: totalItems
      }).lastInsertRowid;

      for (const item of items) {
        orderItemInsert.run({
          order_id: orderId,
          item_name: item.name,
          qty: item.qty,
          unit_price_inr: item.priceInr
        });
      }

      return res.status(201).json({
        provider: "razorpay",
        orderId,
        razorpay: {
          keyId: RAZORPAY_KEY_ID,
          orderId: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
          name: "SpiceRoot",
          description: `Order #${orderId}`
        }
      });
    } catch (error) {
      const errorDetail = getErrorDetail(error);
      const isProd = String(process.env.NODE_ENV || "").trim().toLowerCase() === "production";
      console.error("Razorpay order create failed:", errorDetail);
      return res.status(502).json(
        isProd
          ? { error: "Failed to initialize Razorpay order." }
          : { error: "Failed to initialize Razorpay order.", details: errorDetail }
      );
    }
  }

  if (!stripe) {
    return res.status(503).json({ error: "Stripe is not configured on server." });
  }

  const line_items = items.map((item) => ({
    quantity: item.qty,
    price_data: {
      currency: "inr",
      unit_amount: item.priceInr * 100,
      product_data: {
        name: item.name
      }
    }
  }));

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items,
    success_url: `${PUBLIC_BASE_URL}/index.html?payment=success`,
    cancel_url: `${PUBLIC_BASE_URL}/index.html?payment=cancelled`
  });

  const orderId = orderInsert.run({
    stripe_session_id: session.id,
    total_inr: totalInr,
    total_items: totalItems
  }).lastInsertRowid;

  for (const item of items) {
    orderItemInsert.run({
      order_id: orderId,
      item_name: item.name,
      qty: item.qty,
      unit_price_inr: item.priceInr
    });
  }

  return res.status(201).json({
    provider: "stripe",
    sessionId: session.id,
    checkoutUrl: session.url
  });
});

app.post("/api/payments/verify-razorpay", (req, res) => {
  if (!razorpay) {
    return res.status(503).json({ error: "Razorpay is not configured on server." });
  }

  const razorpayOrderId = String(req.body?.razorpay_order_id || "").trim();
  const razorpayPaymentId = String(req.body?.razorpay_payment_id || "").trim();
  const razorpaySignature = String(req.body?.razorpay_signature || "").trim();

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return res.status(400).json({ error: "Missing Razorpay payment verification fields." });
  }

  const expectedSignature = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  if (expectedSignature !== razorpaySignature) {
    return res.status(400).json({ error: "Invalid Razorpay payment signature." });
  }

  const update = orderStatusBySessionUpdate.run({
    stripe_session_id: `razorpay:${razorpayOrderId}`,
    status: "paid"
  });

  if (!update.changes) {
    return res.status(404).json({ error: "Order not found for Razorpay payment." });
  }

  return res.json({ message: "Payment verified successfully." });
});

app.post("/api/orders/manual-checkout", (req, res) => {
  const mode = String(req.body?.mode || "").toLowerCase();
  if (!["cod", "upi"].includes(mode)) {
    return res.status(400).json({ error: "Invalid checkout mode. Use cod or upi." });
  }

  const items = normalizeCart(req.body?.items);
  if (!items.length) {
    return res.status(400).json({ error: "Cart is empty or invalid." });
  }

  if (mode === "upi" && !UPI_VPA) {
    return res.status(400).json({ error: "UPI is not configured on server." });
  }

  const totalInr = items.reduce((sum, item) => sum + item.qty * item.priceInr, 0);
  const totalItems = items.reduce((sum, item) => sum + item.qty, 0);
  const orderRef = `manual-${mode}-${Date.now()}`;

  const orderId = orderInsert.run({
    stripe_session_id: orderRef,
    total_inr: totalInr,
    total_items: totalItems
  }).lastInsertRowid;

  for (const item of items) {
    orderItemInsert.run({
      order_id: orderId,
      item_name: item.name,
      qty: item.qty,
      unit_price_inr: item.priceInr
    });
  }

  let upiUrl = "";
  if (mode === "upi") {
    const note = `SpiceRoot Order #${orderId}`;
    upiUrl = `upi://pay?pa=${encodeURIComponent(UPI_VPA)}&pn=${encodeURIComponent(UPI_NAME)}&am=${totalInr}&cu=INR&tn=${encodeURIComponent(note)}`;
  }

  return res.status(201).json({
    message: mode === "cod" ? "COD order placed successfully." : "UPI order created successfully.",
    orderId,
    totalInr,
    mode,
    upiUrl
  });
});

app.get("/api/admin/reservations", requireAdmin, requireRole("staff"), (req, res) => {
  const rows = reservationList.all();
  logAdminAction(req, "admin.reservations.list", { count: rows.length });
  res.json({ reservations: rows });
});

app.patch("/api/admin/reservations/:id/status", requireAdmin, requireRole("manager"), (req, res) => {
  const id = Number(req.params.id);
  const allowed = new Set(["pending", "confirmed", "cancelled", "completed"]);
  const status = String(req.body?.status || "").toLowerCase();
  if (!Number.isInteger(id) || id < 1 || !allowed.has(status)) {
    return res.status(400).json({ error: "Invalid reservation id or status." });
  }

  const result = reservationStatusUpdate.run({ id, status });
  if (result.changes === 0) {
    return res.status(404).json({ error: "Reservation not found." });
  }

  logAdminAction(req, "admin.reservations.status_update", { id, status });
  return res.json({ message: "Reservation status updated." });
});

app.get("/api/admin/messages", requireAdmin, requireRole("staff"), (req, res) => {
  const rows = messageList.all();
  logAdminAction(req, "admin.messages.list", { count: rows.length });
  res.json({ messages: rows });
});

app.get("/api/admin/orders", requireAdmin, requireRole("staff"), (req, res) => {
  const rows = orderList.all();
  logAdminAction(req, "admin.orders.list", { count: rows.length });
  res.json({ orders: rows });
});

app.patch("/api/admin/orders/:id/status", requireAdmin, requireRole("manager"), (req, res) => {
  const id = Number(req.params.id);
  const allowed = new Set([
    "created",
    "paid",
    "confirmed",
    "preparing",
    "out_for_delivery",
    "completed",
    "cancelled",
    "failed",
    "refunded"
  ]);
  const status = String(req.body?.status || "").toLowerCase();

  if (!Number.isInteger(id) || id < 1 || !allowed.has(status)) {
    return res.status(400).json({ error: "Invalid order id or status." });
  }

  if (["cancelled", "refunded"].includes(status) && req.adminUser?.role !== "owner") {
    return res.status(403).json({ error: "Only owner can set cancelled/refunded status." });
  }

  const result = orderStatusUpdate.run({ id, status });
  if (result.changes === 0) {
    return res.status(404).json({ error: "Order not found." });
  }

  logAdminAction(req, "admin.orders.status_update", { id, status });
  return res.json({ message: "Order status updated." });
});

app.get("/api/admin/analytics", requireAdmin, requireRole("staff"), (req, res) => {
  const row = adminAnalyticsQuery.get();
  logAdminAction(req, "admin.analytics.view");
  res.json({
    analytics: {
      totalReservations: row.total_reservations,
      totalMessages: row.total_messages,
      totalOrders: row.total_orders,
      todayRevenueInr: row.today_revenue_inr,
      pendingReservations: row.pending_reservations,
      activeOrders: row.active_orders
    }
  });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

app.use((error, req, res, next) => {
  console.error(error);
  const statusCode = Number(error?.statusCode || error?.status || 500);
  if (statusCode >= 400 && statusCode < 500) {
    return res.status(statusCode).json({
      error: error?.expose ? String(error.message || "Bad request.") : "Bad request."
    });
  }
  return res.status(500).json({ error: "Internal server error." });
});

const server = app.listen(PORT, () => {
  printStartupChecklist();
  if (!getConfigDiagnostics().adminConfigured) {
    console.warn("Warning: Admin auth is incomplete. Configure ADMIN_USERS_JSON/ADMIN_AUTH_SECRET or ADMIN_API_KEY.");
  }
  console.log(`SpiceRoot server running on ${PUBLIC_BASE_URL}`);
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Stop the existing process or set a different PORT in .env, then restart.");
    process.exit(1);
  }
  console.error("Server failed to start:", error);
  process.exit(1);
});
