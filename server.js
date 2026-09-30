"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");
const { validateInitData, createBotApi } = require("./lib/telegram");

const PORT = process.env.PORT || 3000;
const { DATABASE_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(/[\s,]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const PUBLIC_URL = (
  process.env.PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
).replace(/\/+$/, "");

const SERVICES = {
  tint: "Тонировка",
  diag: "Диагностика",
  fog: "Сухой туман",
  other: "Другое / несколько услуг",
};
const STATUSES = {
  new: "🆕 Новая",
  called: "📞 Перезвонили",
  booked: "📅 Записан",
  done: "✅ Выполнено",
  rejected: "✖️ Отказ",
};

const isAdmin = (userId) => ADMIN_IDS.includes(String(userId));
const tg = TELEGRAM_BOT_TOKEN ? createBotApi(TELEGRAM_BOT_TOKEN) : null;

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
  await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS tg_username TEXT");
  await pool.query("ALTER TABLE leads ADD COLUMN IF NOT EXISTS tg_user_id BIGINT");
}

// ---------- helpers ----------
function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function leadText(lead) {
  return [
    `<b>Заявка №${lead.id || "-"}</b>  ${STATUSES[lead.status || "new"]}`,
    `Имя: ${escapeHtml(lead.name)}`,
    `Телефон: ${escapeHtml(lead.phone)}`,
    `Услуга: ${SERVICES[lead.service] || escapeHtml(lead.service)}`,
    lead.car && `Авто: ${escapeHtml(lead.car)}`,
    lead.preferred_date && `Дата: ${escapeHtml(lead.preferred_date)}`,
    lead.comment && `Комментарий: ${escapeHtml(lead.comment)}`,
    lead.tg_username && `Telegram: @${escapeHtml(lead.tg_username)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function statusKeyboard(id) {
  if (!id) return undefined;
  return {
    inline_keyboard: [
      [
        { text: "📞 Перезвонили", callback_data: `st:${id}:called` },
        { text: "📅 Записан", callback_data: `st:${id}:booked` },
      ],
      [
        { text: "✅ Выполнено", callback_data: `st:${id}:done` },
        { text: "✖️ Отказ", callback_data: `st:${id}:rejected` },
      ],
    ],
  };
}

async function notifyNewLead(lead) {
  if (!tg || !TELEGRAM_CHAT_ID) return;
  try {
    await tg("sendMessage", {
      chat_id: TELEGRAM_CHAT_ID,
      text: leadText(lead),
      parse_mode: "HTML",
      reply_markup: statusKeyboard(lead.id),
    });
  } catch (err) {
    console.error("Ошибка отправки в Telegram", err.message);
  }
}

function telegramUser(req) {
  return validateInitData(req.get("x-telegram-init-data") || "", TELEGRAM_BOT_TOKEN);
}

function requireAdmin(req, res, next) {
  if (!TELEGRAM_BOT_TOKEN) return res.status(503).json({ error: "NO_BOT" });
  const user = telegramUser(req);
  if (!user) return res.status(401).json({ error: "NOT_TELEGRAM" });
  if (!isAdmin(user.id)) return res.status(403).json({ error: "NOT_ADMIN", userId: user.id });
  req.tgUser = user;
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

// ---------- web app ----------
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

  const lead = {
    name: clean(body.name, 80),
    phone: clean(body.phone, 24),
    car: clean(body.car, 80),
    service: clean(body.service, 10),
    preferred_date: clean(body.preferredDate, 20),
    comment: clean(body.comment, 600),
    status: "new",
  };
  if (lead.name.length < 2) return res.status(400).json({ error: "Укажите имя" });
  if (!/^[+\d\s()-]{7,24}$/.test(lead.phone)) return res.status(400).json({ error: "Проверьте номер телефона" });
  if (!SERVICES[lead.service]) return res.status(400).json({ error: "Выберите услугу" });
  if (rateLimited(req.ip)) return res.status(429).json({ error: "Слишком много заявок, попробуйте позже" });

  // If the form was sent from inside Telegram, remember who sent it.
  const tgUser = telegramUser(req);
  lead.tg_username = tgUser && tgUser.username ? String(tgUser.username).slice(0, 64) : null;
  lead.tg_user_id = tgUser ? tgUser.id : null;

  try {
    if (pool) {
      const { rows } = await pool.query(
        `INSERT INTO leads (name, phone, car, service, preferred_date, comment, tg_username, tg_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [lead.name, lead.phone, lead.car, lead.service, lead.preferred_date, lead.comment, lead.tg_username, lead.tg_user_id],
      );
      lead.id = rows[0].id;
    }
  } catch (err) {
    console.error("Ошибка сохранения заявки", err);
    return res.status(500).json({ error: "Не удалось сохранить заявку" });
  }

  notifyNewLead(lead);
  res.json({ ok: true });
});

app.get("/api/leads", requireAdmin, async (req, res) => {
  if (!pool) return res.json({ leads: [], warning: "NO_DATABASE" });
  const { rows } = await pool.query(
    `SELECT id, name, phone, car, service, preferred_date, comment, status, created_at, tg_username
     FROM leads ORDER BY id DESC LIMIT 500`,
  );
  res.json({ leads: rows.map((r) => ({ ...r, service_label: SERVICES[r.service] || r.service })) });
});

app.patch("/api/leads/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = clean((req.body || {}).status, 20);
  if (!Number.isInteger(id) || id < 1 || !STATUSES[status]) return res.status(400).json({ error: "bad input" });
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

// ---------- telegram bot (long polling) ----------
function startKeyboard(userId) {
  if (!PUBLIC_URL) return undefined;
  const rows = [[{ text: "🚗 Записаться", web_app: { url: `${PUBLIC_URL}/` } }]];
  if (isAdmin(userId)) rows.push([{ text: "📋 Заявки", web_app: { url: `${PUBLIC_URL}/admin` } }]);
  return { inline_keyboard: rows };
}

async function handleMessage(msg) {
  const text = (msg.text || "").trim();
  const chatId = msg.chat.id;
  const userId = msg.from && msg.from.id;
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  const isPrivate = msg.chat.type === "private";

  if (cmd === "/id") {
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        `Ваш ID: <code>${userId}</code>\n` +
        (isPrivate ? "" : `ID этого чата: <code>${chatId}</code>\n`) +
        "Нажмите на число, чтобы скопировать.",
    });
    return;
  }

  if (!isPrivate) return; // in groups the bot only answers /id

  if (cmd === "/start") {
    if (!PUBLIC_URL) {
      await tg("sendMessage", { chat_id: chatId, text: "Сайт ещё не настроен: задайте PUBLIC_URL." });
      return;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      parse_mode: "HTML",
      text:
        "<b>Hayanmi Detailing</b>\nТонировка, диагностика и сухой туман.\n\n" +
        "Нажмите «Записаться», оставьте номер, и мы перезвоним.",
      reply_markup: startKeyboard(userId),
    });
    return;
  }

  if (cmd === "/admin") {
    if (!isAdmin(userId)) {
      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: `Доступа нет. Ваш ID: <code>${userId}</code>. Добавьте его в ADMIN_IDS на Railway.`,
      });
      return;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: "Панель заявок:",
      reply_markup: { inline_keyboard: [[{ text: "📋 Открыть заявки", web_app: { url: `${PUBLIC_URL}/admin` } }]] },
    });
  }
}

async function handleCallback(cb) {
  const m = /^st:(\d+):(\w+)$/.exec(cb.data || "");
  if (!m) return tg("answerCallbackQuery", { callback_query_id: cb.id });
  if (!isAdmin(cb.from.id)) {
    return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Менять статус могут только админы", show_alert: true });
  }
  const [, id, status] = m;
  if (!STATUSES[status] || !pool) return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Не получилось" });

  const { rows } = await pool.query("UPDATE leads SET status = $1 WHERE id = $2 RETURNING *", [status, Number(id)]);
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: STATUSES[status] });
  if (rows[0] && cb.message) {
    const who = cb.from.username ? `@${cb.from.username}` : cb.from.first_name;
    await tg("editMessageText", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      parse_mode: "HTML",
      text: `${leadText(rows[0])}\n\n<i>Статус изменил: ${escapeHtml(who)}</i>`,
      reply_markup: statusKeyboard(rows[0].id),
    }).catch(() => {}); // "message is not modified" is fine
  }
}

async function startBot() {
  if (!tg) {
    console.warn("TELEGRAM_BOT_TOKEN не задан: бот выключен.");
    return;
  }
  try {
    await tg("deleteWebhook", { drop_pending_updates: false });
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "Записаться" },
        { command: "admin", description: "Заявки (для админов)" },
        { command: "id", description: "Узнать свой ID и ID чата" },
      ],
    });
    if (PUBLIC_URL) {
      await tg("setChatMenuButton", {
        menu_button: { type: "web_app", text: "Записаться", web_app: { url: `${PUBLIC_URL}/` } },
      });
    }
    console.log("Бот запущен");
  } catch (err) {
    console.error("Не удалось настроить бота:", err.message);
  }

  let offset = 0;
  for (;;) {
    try {
      const updates = await tg("getUpdates", {
        offset,
        timeout: 50,
        allowed_updates: ["message", "callback_query"],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        try {
          if (u.message) await handleMessage(u.message);
          else if (u.callback_query) await handleCallback(u.callback_query);
        } catch (err) {
          console.error("Ошибка обработки обновления", err.message);
        }
      }
    } catch (err) {
      console.error("getUpdates:", err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Hayanmi Detailing: порт ${PORT}`));
    startBot();
  })
  .catch((err) => {
    console.error("Не удалось подготовить базу", err);
    process.exit(1);
  });
