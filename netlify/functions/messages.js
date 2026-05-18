const { neon } = require("@neondatabase/serverless");

const allowedRooms = new Set(["General"]);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json",
};

let sql;
let schemaReady;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  sql ??= neon(process.env.DATABASE_URL);
  return sql;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
}

function cleanRoom(room) {
  return allowedRooms.has(room) ? room : "General";
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  return new Date().toISOString().slice(0, 10);
}

async function ensureSchema(db) {
  schemaReady ??= (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        room TEXT NOT NULL,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        chat_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS messages_room_created_at_idx ON messages (room, created_at DESC)`;
    await db`ALTER TABLE messages ADD COLUMN IF NOT EXISTS chat_date DATE`;
    await db`UPDATE messages SET chat_date = (created_at AT TIME ZONE 'Europe/Athens')::date WHERE chat_date IS NULL`;
    await db`ALTER TABLE messages ALTER COLUMN chat_date SET DEFAULT CURRENT_DATE`;
    await db`ALTER TABLE messages ALTER COLUMN chat_date SET NOT NULL`;
    await db`CREATE INDEX IF NOT EXISTS messages_room_chat_date_created_at_idx ON messages (room, chat_date, created_at ASC)`;
    await db`
      CREATE TABLE IF NOT EXISTS message_reads (
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        viewer TEXT NOT NULL,
        seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, viewer)
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS message_reads_viewer_idx ON message_reads (viewer)`;
  })();

  return schemaReady;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  let db;
  try {
    db = getSql();
    await ensureSchema(db);
  } catch (error) {
    return json(500, { error: error.message });
  }

  if (event.httpMethod === "GET") {
    const room = cleanRoom(event.queryStringParameters?.room);
    const chatDate = cleanDate(event.queryStringParameters?.date);
    const viewer = cleanText(event.queryStringParameters?.viewer, 24);

    if (viewer) {
      await db`
        INSERT INTO message_reads (message_id, viewer)
        SELECT id, ${viewer}
        FROM messages
        WHERE room = ${room}
          AND chat_date = ${chatDate}::date
          AND author <> ${viewer}
        ON CONFLICT (message_id, viewer)
        DO UPDATE SET seen_at = NOW()
      `;
    }

    const days = await db`
      SELECT chat_date, COUNT(*)::int AS count
      FROM messages
      WHERE room = ${room}
      GROUP BY chat_date
      ORDER BY chat_date DESC
      LIMIT 90
    `;

    const rows = await db`
      SELECT
        m.id,
        m.room,
        m.author,
        m.text,
        m.chat_date,
        m.created_at,
        COALESCE(
          ARRAY_AGG(r.viewer ORDER BY r.seen_at)
            FILTER (WHERE r.viewer IS NOT NULL AND r.viewer <> m.author),
          ARRAY[]::TEXT[]
        ) AS seen_by
      FROM (
        SELECT id, room, author, text, chat_date, created_at
        FROM messages
        WHERE room = ${room}
          AND chat_date = ${chatDate}::date
        ORDER BY created_at DESC
        LIMIT 100
      ) m
      LEFT JOIN message_reads r ON r.message_id = m.id
      GROUP BY m.id, m.room, m.author, m.text, m.chat_date, m.created_at
      ORDER BY m.created_at ASC
    `;

    return json(200, {
      days: days.map((day) => ({
        chatDate: day.chat_date,
        count: day.count,
      })),
      messages: rows.map((row) => ({
        id: row.id,
        room: row.room,
        author: row.author,
        text: row.text,
        chatDate: row.chat_date,
        createdAt: row.created_at,
        seenBy: row.seen_by,
      })),
    });
  }

  if (event.httpMethod === "POST") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const room = cleanRoom(payload.room);
    const chatDate = cleanDate(payload.chatDate);
    const author = cleanText(payload.author, 24) || "User";
    const text = cleanText(payload.text, 1000);

    if (!text) {
      return json(400, { error: "Message text is required" });
    }

    const [message] = await db`
      INSERT INTO messages (room, chat_date, author, text)
      VALUES (${room}, ${chatDate}::date, ${author}, ${text})
      RETURNING id, room, chat_date, author, text, created_at
    `;

    return json(201, {
      message: {
        id: message.id,
        room: message.room,
        chatDate: message.chat_date,
        author: message.author,
        text: message.text,
        createdAt: message.created_at,
        seenBy: [],
      },
    });
  }

  return json(405, { error: "Method not allowed" });
};
