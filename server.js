"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const { DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ADMIN_PASSWORD } = process.env;

const SERVICES = {
  tint: "Тонировка",
  diag: "Диагностика",
  fog: "Сухой туман",
  other: "Другое / несколько услуг",
};
const STATUSES = ["new", "called", "booked", "done", "rejected"];

// ---------- database ----------
let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1|\.railway\.internal/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
} else {
  console.warn("DATABASE_URL не задан: заявки будут только уходить в Telegram, без сохранения.");
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      car TEXT,
      service TEXT NOT NULL,
      preferred_date TEXT,
      comment TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// ---------- helpers ----------
function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function notifyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
    if (!res.ok) console.error("Telegram ответил", res.status, await res.text());
  } catch (err) {
    console.error("Ошибка отправки в Telegram", err);
  }
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return res.status(503).json({ error: "NO_PASSWORD_SET" });
  if (!safeEqual(req.get("x-admin-password") || "", ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "BAD_PASSWORD" });
  }
  next();
}

// Simple per-IP limit: 5 leads per 10 minutes.
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}

// ---------- app ----------
const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.post("/api/leads", async (req, res) => {
  const body = req.body || {};
  if (body.website) return res.json({ ok: true }); // honeypot

  const name = clean(body.name, 80);
  const phone = clean(body.phone, 24);
  const car = clean(body.car, 80);
  const service = clean(body.service, 10);
  const preferredDate = clean(body.preferredDate, 20);
  const comment = clean(body.comment, 600);

  if (name.length < 2) return res.status(400).json({ error: "Укажите имя" });
  if (!/^[+\d\s()-]{7,24}$/.test(phone)) return res.status(400).json({ error: "Проверьте номер телефона" });
  if (!SERVICES[service]) return res.status(400).json({ error: "Выберите услугу" });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Слишком много заявок, попробуйте позже" });

  try {
    if (pool) {
      await pool.query(
        "INSERT INTO leads (name, phone, car, service, preferred_date, comment) VALUES ($1,$2,$3,$4,$5,$6)",
        [name, phone, car, service, preferredDate, comment],
      );
    }
  } catch (err) {
    console.error("Ошибка сохранения заявки", err);
    return res.status(500).json({ error: "Не удалось сохранить заявку" });
  }

  const lines = [
    "<b>Новая заявка Hayanmi Detailing</b>",
    `Имя: ${escapeHtml(name)}`,
    `Телефон: ${escapeHtml(phone)}`,
    `Услуга: ${SERVICES[service]}`,
    car && `Авто: ${escapeHtml(car)}`,
    preferredDate && `Дата: ${escapeHtml(preferredDate)}`,
    comment && `Комментарий: ${escapeHtml(comment)}`,
  ].filter(Boolean);
  notifyTelegram(lines.join("\n"));

  res.json({ ok: true });
});

app.get("/api/leads", requireAdmin, async (req, res) => {
  if (!pool) return res.json({ leads: [], warning: "NO_DATABASE" });
  const { rows } = await pool.query(
    "SELECT id, name, phone, car, service, preferred_date, comment, status, created_at FROM leads ORDER BY id DESC LIMIT 500",
  );
  res.json({ leads: rows.map((r) => ({ ...r, service_label: SERVICES[r.service] || r.service })) });
});

app.patch("/api/leads/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = clean((req.body || {}).status, 20);
  if (!Number.isInteger(id) || id < 1 || !STATUSES.includes(status)) return res.status(400).json({ error: "bad input" });
  if (!pool) return res.status(503).json({ error: "NO_DATABASE" });
  await pool.query("UPDATE leads SET status = $1 WHERE id = $2", [status, id]);
  res.json({ ok: true });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "7d", extensions: ["html"] }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "404.html")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Внутренняя ошибка" });
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`Hayanmi Detailing: порт ${PORT}`)))
  .catch((err) => {
    console.error("Не удалось подготовить базу", err);
    process.exit(1);
  });
