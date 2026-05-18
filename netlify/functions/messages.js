const { neon } = require("@neondatabase/serverless");

const allowedRooms = new Set(["General"]);

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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
  return String(value || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  return new Date().toISOString().slice(0, 10);
}

function cleanLimit(value) {
  const limit = Number(value);
  if (!Number.isSafeInteger(limit)) {
    return 5;
  }

  return Math.min(50, Math.max(1, limit));
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
    await db`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`;
    await db`UPDATE messages SET chat_date = (created_at AT TIME ZONE 'Europe/Athens')::date WHERE chat_date IS NULL`;
    await db`ALTER TABLE messages ALTER COLUMN chat_date SET DEFAULT CURRENT_DATE`;
    await db`ALTER TABLE messages ALTER COLUMN chat_date SET NOT NULL`;
    await db`CREATE INDEX IF NOT EXISTS messages_room_chat_date_created_at_idx ON messages (room, chat_date, created_at ASC)`;
    await db`
      CREATE TABLE IF NOT EXISTS message_edits (
        id BIGSERIAL PRIMARY KEY,
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        old_text TEXT NOT NULL,
        new_text TEXT NOT NULL,
        edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS message_edits_message_id_idx ON message_edits (message_id, edited_at ASC)`;
    await db`
      CREATE TABLE IF NOT EXISTS message_reads (
        message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        viewer TEXT NOT NULL,
        seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, viewer)
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS message_reads_viewer_idx ON message_reads (viewer)`;
    await db`
      CREATE TABLE IF NOT EXISTS typing_status (
        room TEXT NOT NULL,
        chat_date DATE NOT NULL,
        author TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (room, chat_date, author)
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS typing_status_active_idx ON typing_status (room, chat_date, updated_at DESC)`;
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
    const feed = event.queryStringParameters?.feed === "room";
    const limit = cleanLimit(event.queryStringParameters?.limit);
    const before = event.queryStringParameters?.before ? new Date(event.queryStringParameters.before) : null;
    const hasBefore = before instanceof Date && !Number.isNaN(before.getTime());

    if (viewer) {
      if (feed) {
        await db`
          INSERT INTO message_reads (message_id, viewer)
          SELECT id, ${viewer}
          FROM messages
          WHERE room = ${room}
            AND author <> ${viewer}
          ON CONFLICT (message_id, viewer)
          DO UPDATE SET seen_at = NOW()
        `;
      } else {
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
    }

    const days = await db`
      SELECT chat_date, COUNT(*)::int AS count
      FROM messages
      WHERE room = ${room}
      GROUP BY chat_date
      ORDER BY chat_date DESC
      LIMIT 90
    `;

    const typing = viewer
      ? await db`
          SELECT author
          FROM typing_status
          WHERE room = ${room}
            AND chat_date = ${chatDate}::date
            AND author <> ${viewer}
            AND updated_at > NOW() - INTERVAL '6 seconds'
          ORDER BY updated_at DESC
          LIMIT 3
        `
      : [];

    const queryLimit = limit + 1;
    const rows = feed
      ? await db`
      SELECT
        m.id,
        m.room,
        m.author,
        m.text,
        m.chat_date,
        m.created_at,
        m.edited_at,
        COALESCE(
          ARRAY_AGG(DISTINCT r.viewer)
            FILTER (WHERE r.viewer IS NOT NULL AND r.viewer <> m.author),
          ARRAY[]::TEXT[]
        ) AS seen_by,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'oldText', e.old_text,
              'newText', e.new_text,
              'editedAt', e.edited_at
            )
          ) FILTER (WHERE e.id IS NOT NULL),
          '[]'::JSONB
        ) AS edit_history
      FROM (
        SELECT id, room, author, text, chat_date, created_at, edited_at
        FROM messages
        WHERE room = ${room}
          AND (${hasBefore} = FALSE OR created_at < ${hasBefore ? before.toISOString() : new Date().toISOString()}::timestamptz)
        ORDER BY created_at DESC
        LIMIT ${queryLimit}
      ) m
      LEFT JOIN message_reads r ON r.message_id = m.id
      LEFT JOIN message_edits e ON e.message_id = m.id
      GROUP BY m.id, m.room, m.author, m.text, m.chat_date, m.created_at, m.edited_at
      ORDER BY m.created_at ASC
    `
      : await db`
      SELECT
        m.id,
        m.room,
        m.author,
        m.text,
        m.chat_date,
        m.created_at,
        m.edited_at,
        COALESCE(
          ARRAY_AGG(DISTINCT r.viewer)
            FILTER (WHERE r.viewer IS NOT NULL AND r.viewer <> m.author),
          ARRAY[]::TEXT[]
        ) AS seen_by,
        COALESCE(
          JSONB_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'oldText', e.old_text,
              'newText', e.new_text,
              'editedAt', e.edited_at
            )
          ) FILTER (WHERE e.id IS NOT NULL),
          '[]'::JSONB
        ) AS edit_history
      FROM (
        SELECT id, room, author, text, chat_date, created_at, edited_at
        FROM messages
        WHERE room = ${room}
          AND chat_date = ${chatDate}::date
        ORDER BY created_at DESC
        LIMIT 100
      ) m
      LEFT JOIN message_reads r ON r.message_id = m.id
      LEFT JOIN message_edits e ON e.message_id = m.id
      GROUP BY m.id, m.room, m.author, m.text, m.chat_date, m.created_at, m.edited_at
      ORDER BY m.created_at ASC
    `;
    const hasMore = rows.length > limit;
    const visibleRows = hasMore ? rows.slice(1) : rows;

    return json(200, {
      days: days.map((day) => ({
        chatDate: day.chat_date,
        count: day.count,
      })),
      typing: typing.map((row) => row.author),
      hasMore,
      messages: visibleRows.map((row) => ({
        id: row.id,
        room: row.room,
        author: row.author,
        text: row.text,
        chatDate: row.chat_date,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        editHistory: row.edit_history,
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

    if (payload.action === "typing") {
      if (!author) {
        return json(400, { error: "Author is required" });
      }

      if (payload.typing === false) {
        await db`
          DELETE FROM typing_status
          WHERE room = ${room}
            AND chat_date = ${chatDate}::date
            AND author = ${author}
        `;
        return json(200, { typing: false });
      }

      await db`
        INSERT INTO typing_status (room, chat_date, author, updated_at)
        VALUES (${room}, ${chatDate}::date, ${author}, NOW())
        ON CONFLICT (room, chat_date, author)
        DO UPDATE SET updated_at = NOW()
      `;

      return json(200, { typing: true });
    }

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
        editedAt: null,
        editHistory: [],
        seenBy: [],
      },
    });
  }

  if (event.httpMethod === "PUT") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const id = Number(payload.id);
    const room = cleanRoom(payload.room);
    const author = cleanText(payload.author, 24);
    const text = cleanText(payload.text, 1000);

    if (!Number.isSafeInteger(id) || id <= 0 || !author || !text) {
      return json(400, { error: "Invalid edit request" });
    }

    const [existing] = await db`
      SELECT id, text
      FROM messages
      WHERE id = ${id}
        AND room = ${room}
        AND author = ${author}
        AND chat_date = (NOW() AT TIME ZONE 'Europe/Athens')::date
      LIMIT 1
    `;

    if (!existing) {
      return json(403, { error: "Message cannot be edited" });
    }

    if (existing.text !== text) {
      await db`
        INSERT INTO message_edits (message_id, old_text, new_text)
        VALUES (${id}, ${existing.text}, ${text})
      `;
    }

    const [message] = await db`
      UPDATE messages
      SET text = ${text}, edited_at = CASE WHEN text <> ${text} THEN NOW() ELSE edited_at END
      WHERE id = ${id}
      RETURNING id, room, chat_date, author, text, created_at, edited_at
    `;

    return json(200, {
      message: {
        id: message.id,
        room: message.room,
        chatDate: message.chat_date,
        author: message.author,
        text: message.text,
        createdAt: message.created_at,
        editedAt: message.edited_at,
      },
    });
  }

  if (event.httpMethod === "DELETE") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const id = Number(payload.id);
    const room = cleanRoom(payload.room);
    const author = cleanText(payload.author, 24);

    if (!Number.isSafeInteger(id) || id <= 0 || !author) {
      return json(400, { error: "Invalid delete request" });
    }

    const rows = await db`
      DELETE FROM messages
      WHERE id = ${id}
        AND room = ${room}
        AND author = ${author}
        AND chat_date = (NOW() AT TIME ZONE 'Europe/Athens')::date
      RETURNING id
    `;

    if (rows.length === 0) {
      return json(403, { error: "Message cannot be deleted" });
    }

    return json(200, { deleted: true });
  }

  return json(405, { error: "Method not allowed" });
};
