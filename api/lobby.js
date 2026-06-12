const memoryStore = globalThis.__soundmatchLobbies || new Map();
globalThis.__soundmatchLobbies = memoryStore;

const TTL_SECONDS = 60 * 60 * 24 * 7;

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const code = normalizeCode(req.query.code);
  if (!code) {
    return res.status(400).json({ error: "Missing lobby code" });
  }

  try {
    if (req.method === "GET") {
      const lobby = await readLobby(code);
      if (!lobby) return res.status(404).json({ error: "Lobby not found" });
      return res.status(200).json(lobby);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
      const state = body && body.state;
      if (!state || state.lobbyCode !== code) {
        return res.status(400).json({ error: "Invalid lobby payload" });
      }
      const lobby = {
        code,
        state,
        updatedAt: Number(body.updatedAt || Date.now()),
      };
      await writeLobby(code, lobby);
      return res.status(200).json({ ok: true, updatedAt: lobby.updatedAt, storage: storageMode() });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Lobby API failed" });
  }
};

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

async function readLobby(code) {
  if (hasKv()) {
    const response = await fetch(`${process.env.KV_REST_API_URL}/get/${key(code)}`, {
      headers: kvHeaders(),
    });
    if (!response.ok) throw new Error(`KV read failed: ${response.status}`);
    const data = await response.json();
    return data.result ? JSON.parse(data.result) : null;
  }
  return memoryStore.get(code) || null;
}

async function writeLobby(code, lobby) {
  if (hasKv()) {
    const response = await fetch(process.env.KV_REST_API_URL, {
      method: "POST",
      headers: kvHeaders(),
      body: JSON.stringify(["SET", key(code), JSON.stringify(lobby), "EX", TTL_SECONDS]),
    });
    if (!response.ok) throw new Error(`KV write failed: ${response.status}`);
    return;
  }
  memoryStore.set(code, lobby);
}

function hasKv() {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function kvHeaders() {
  return {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function key(code) {
  return `soundmatch:lobby:${code}`;
}

function storageMode() {
  return hasKv() ? "kv" : "memory";
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
