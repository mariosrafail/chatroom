const {
  createSession,
  deleteSession,
  ensureAuthSchema,
  expiredCookie,
  getSession,
  getSql,
  verifyPassword,
} = require("../lib/auth");

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  Vary: "Cookie",
};

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  let db;
  try {
    db = getSql();
    await ensureAuthSchema(db);
  } catch (error) {
    console.error("Authentication setup failed", error);
    return json(500, { error: "Authentication is temporarily unavailable" });
  }

  if (event.httpMethod === "GET") {
    return (await getSession(event, db))
      ? json(200, { authenticated: true })
      : json(401, { authenticated: false });
  }

  if (event.httpMethod === "POST") {
    let payload;
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    if (!(await verifyPassword(db, payload.password))) {
      return json(401, { error: "Wrong password" });
    }

    const session = await createSession(db);
    return json(200, { authenticated: true }, { "Set-Cookie": session.cookie });
  }

  if (event.httpMethod === "DELETE") {
    await deleteSession(event, db);
    return json(200, { authenticated: false }, { "Set-Cookie": expiredCookie() });
  }

  return json(405, { error: "Method not allowed" }, { Allow: "GET, POST, DELETE, OPTIONS" });
};
