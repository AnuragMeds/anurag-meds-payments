import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";
import multer from "multer";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getPool, initSchema } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PORT = process.env.PORT || 3002;
const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;
const jwtSecret = process.env.JWT_SECRET || "change_me";

if (!key_id || !key_secret) {
  console.warn("[payments] Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET. Set them in .env");
}

const razorpay = new Razorpay({ key_id, key_secret });

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "Anurag Meds Payments", env: process.env.NODE_ENV || "dev" });
});

// ---------- DB health ----------
app.get("/sql/health", async (_req, res) => {
  try {
    const pool = await getPool();
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (e) {
    console.error("[db] health error:", e);
    res.status(500).json({ ok: false, error: "DB connection failed" });
  }
});

// ---------- DB bootstrap ----------
await initSchema().catch((e) => {
  console.error("[db] init error:", e);
});

// Auth middleware for JWT
function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
}

// ---------- SQL Auth Endpoints ----------
app.post("/sql/auth/register", async (req, res) => {
  try {
    const { email, password, name, phone, role } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const pool = await getPool();
    try {
      const [result] = await pool.execute(
        `INSERT INTO users (email, phone, name, role, password_hash) VALUES (?, ?, ?, ?, ?)`,
        [email, phone || null, name || null, role === "admin" ? "admin" : "user", password_hash]
      );
      const user = { id: result.insertId, email, name, phone, role: role === "admin" ? "admin" : "user" };
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: "7d" });
      res.json({ ok: true, user, token });
    } catch (err) {
      if (err && err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ ok: false, error: "Email already exists" });
      }
      console.error("register error:", err);
      res.status(500).json({ ok: false, error: "Registration failed" });
    }
  } catch (e) {
    console.error("register exception:", e);
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/sql/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: "Email and password required" });
    }
    const pool = await getPool();
    const [rows] = await pool.execute(`SELECT id, email, name, phone, role, password_hash FROM users WHERE email = ? LIMIT 1`, [email]);
    if (!rows || rows.length === 0) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, jwtSecret, { expiresIn: "7d" });
    res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, name: user.name, phone: user.phone, role: user.role }
    });
  } catch (e) {
    console.error("login error:", e);
    res.status(500).json({ ok: false, error: "Login failed" });
  }
});

app.get("/sql/me", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    const [rows] = await pool.execute(`SELECT id, email, name, phone, role, created_at FROM users WHERE id = ? LIMIT 1`, [req.user.id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error("me error:", e);
    res.status(500).json({ ok: false, error: "Failed to fetch user" });
  }
});

// List prescriptions (admin sees all, user sees own)
app.get("/sql/prescriptions", requireAuth, async (req, res) => {
  try {
    const pool = await getPool();
    let rows;
    if (req.user?.role === "admin") {
      [rows] = await pool.query(
        `SELECT p.id, p.full_name, p.phone, p.address, p.file_name, p.file_mime, p.file_size, p.created_at, p.user_id,
                u.name AS user_name, u.phone AS user_phone
         FROM prescriptions p
         LEFT JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC
         LIMIT 200`
      );
    } else {
      [rows] = await pool.execute(
        `SELECT id, full_name, phone, address, file_name, file_mime, file_size, created_at, user_id
         FROM prescriptions
         WHERE user_id = ?
         ORDER BY created_at DESC`,
        [req.user?.id]
      );
    }
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error("prescriptions list error:", e);
    res.status(500).json({ ok: false, error: "Failed to fetch prescriptions" });
  }
});
// ---------- Prescription Create (stores image in DB) ----------
app.post("/sql/prescriptions", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const { fullName, phone, address } = req.body || {};
    if (!fullName || !phone) {
      return res.status(400).json({ ok: false, error: "fullName and phone are required" });
    }
    const file = req.file || null;
    const pool = await getPool();
    const file_name = file?.originalname || null;
    const file_mime = file?.mimetype || null;
    const file_size = file?.size || null;
    const file_data = file ? file.buffer : null;

    const [result] = await pool.execute(
      `INSERT INTO prescriptions (user_id, full_name, phone, address, file_name, file_mime, file_size, file_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user?.id || null, fullName, phone, address || null, file_name, file_mime, file_size, file_data]
    );

    res.json({
      ok: true,
      id: result.insertId
    });
  } catch (e) {
    console.error("prescriptions insert error:", e);
    res.status(500).json({ ok: false, error: "Failed to save prescription" });
  }
});

// Download prescription image by id
app.get("/sql/prescriptions/:id/file", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const [rows] = await pool.execute(`SELECT file_name, file_mime, file_data FROM prescriptions WHERE id = ?`, [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    const row = rows[0];
    if (!row.file_data) {
      return res.status(404).json({ ok: false, error: "No file attached" });
    }
    res.setHeader("Content-Type", row.file_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${row.file_name || "file"}"`);
    res.send(Buffer.from(row.file_data));
  } else {
    res.status(404).end();
  }
  } catch (e) {
    console.error("prescription file error:", e);
    res.status(500).json({ ok: false, error: "Failed to fetch file" });
  }
});
// Create a Razorpay Order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt } = req.body || {};
    if (!amount || amount < 1) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    const order = await razorpay.orders.create({
      amount: Number(amount),
      currency,
      receipt: receipt || `order_rcptid_${Date.now()}`,
      payment_capture: 1
    });
    res.json({
      ok: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: key_id
    });
  } catch (e) {
    console.error("create-order error:", e);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// Verify payment signature (client sends razorpay_order_id, razorpay_payment_id, razorpay_signature)
app.post("/verify", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto.createHmac("sha256", key_secret).update(payload).digest("hex");
    const valid = expected === razorpay_signature;
    if (!valid) return res.status(400).json({ ok: false, valid: false });
    res.json({ ok: true, valid: true });
  } catch (e) {
    console.error("verify error:", e);
    res.status(500).json({ ok: false, error: "Verification failed" });
  }
});

app.listen(PORT, () => {
  console.log(`[payments] Listening on http://localhost:${PORT}`);
});


