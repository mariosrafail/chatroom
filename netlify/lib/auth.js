const crypto = require("node:crypto");
const { neon } = require("@neondatabase/serverless");

const cookieName = "soulmate_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 365;
const passwordIterations = 310000;

// PBKDF2-SHA256 record for the initial password. The plaintext password is
// intentionally never stored in the repository or sent back to the browser.
const initialPasswordSalt = "4226715eb5888613ff3c466496f6aa54";
const initialPasswordHash = "2135e0a30453793cfd2fb5c3776d131e343ef0a3563eb60aa4dc80c71c8548bb";

let sql;
let schemaReady;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  sql ??= neon(process.env.DATABASE_URL);
  return sql;
}

async function ensureAuthSchema(db) {
  schemaReady ??= (async () => {
    await db`
      CREATE TABLE IF NOT EXISTS site_auth (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        password_iterations INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await db`
      INSERT INTO site_auth (id, password_hash, password_salt, password_iterations)
      VALUES (1, ${initialPasswordHash}, ${initialPasswordSalt}, ${passwordIterations})
      ON CONFLICT (id) DO NOTHING
    `;
    await db`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL
      )
    `;
    await db`CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at)`;
    await db`DELETE FROM auth_sessions WHERE expires_at <= NOW()`;
  })();

  return schemaReady;
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator === -1) {
      return cookies;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) {
      cookies[name] = value;
    }
    return cookies;
  }, {});
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function derivePasswordHash(password, salt, iterations) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), iterations, 32, "sha256");
}

async function verifyPassword(db, password) {
  const [record] = await db`
    SELECT password_hash, password_salt, password_iterations
    FROM site_auth
    WHERE id = 1
  `;

  if (!record) {
    return false;
  }

  const expected = Buffer.from(record.password_hash, "hex");
  const actual = derivePasswordHash(String(password || ""), record.password_salt, record.password_iterations);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function createSession(db) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000).toISOString();

  await db`
    INSERT INTO auth_sessions (token_hash, expires_at)
    VALUES (${tokenHash}, ${expiresAt}::timestamptz)
  `;

  return {
    token,
    cookie: `${cookieName}=${token}; Max-Age=${sessionMaxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`,
  };
}

async function getSession(event, db) {
  const token = parseCookies(event.headers?.cookie || event.headers?.Cookie || "")[cookieName];
  if (!token || token.length > 100) {
    return null;
  }

  const [session] = await db`
    SELECT created_at, expires_at
    FROM auth_sessions
    WHERE token_hash = ${hashToken(token)}
      AND expires_at > NOW()
  `;

  return session || null;
}

async function deleteSession(event, db) {
  const token = parseCookies(event.headers?.cookie || event.headers?.Cookie || "")[cookieName];
  if (token && token.length <= 100) {
    await db`DELETE FROM auth_sessions WHERE token_hash = ${hashToken(token)}`;
  }
}

function expiredCookie() {
  return `${cookieName}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

module.exports = {
  createSession,
  deleteSession,
  ensureAuthSchema,
  expiredCookie,
  getSession,
  getSql,
  verifyPassword,
};
