import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3002;
const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

if (!key_id || !key_secret) {
  console.warn("[payments] Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET. Set them in .env");
}

const razorpay = new Razorpay({ key_id, key_secret });

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "AnuragMeds Payments", env: process.env.NODE_ENV || "dev" });
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


