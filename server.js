const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] },
  pingTimeout: 60000,
  pingInterval: 25000
});

const TURN_KEY_ID = "869e929bce3ea9842d26ef104162a47b";
const TURN_API_TOKEN = "e9ae96c2433df8e27f97ed12fadf4842e0e0201d2d7bef032176941e7f7a192e";

let cachedICE = null;
let cacheExpiry = 0;

async function getFreshICE() {
  const now = Date.now();
  if (cachedICE && now < cacheExpiry) return cachedICE;
  
  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${TURN_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ ttl: 86400 })
      }
    );
    const data = await res.json();
    cachedICE = data.iceServers;
    cacheExpiry = now + (23 * 60 * 60 * 1000); // cache for 23 hours
    console.log("Fresh TURN credentials generated");
    return cachedICE;
  } catch(e) {
    console.error("Failed to get TURN credentials:", e);
    return null;
  }
}

const users = new Map();

app.get("/", (req, res) => res.json({ status: "Halo signaling server running ✅" }));

// Endpoint for app to get fresh ICE servers
app.get("/ice", async (req, res) => {
  const ice = await getFreshICE();
  if (ice) res.json({ iceServers: ice });
  else res.status(500).json({ error: "Could not get TURN credentials" });
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register", ({ userId, name }) => {
    for (const [sid, u] of users.entries()) {
      if (u.userId === userId && sid !== socket.id) users.delete(sid);
    }
    users.set(socket.id, { userId, name });
    socket.join(userId);
    socket.broadcast.emit("user-online", { userId, name });
    console.log(`Registered: ${name} (${userId})`);
  });

  socket.on("call-user", ({ to, offer, callType, callerName }) => {
    const caller = users.get(socket.id);
    if (!caller) return;
    io.to(to).emit("incoming-call", {
      from: caller.userId,
      callerName: callerName || caller.name,
      offer,
      callType
    });
  });

  socket.on("answer-call", ({ to, answer }) => {
    io.to(to).emit("call-answered", { answer });
  });

  socket.on("reject-call", ({ to }) => {
    io.to(to).emit("call-rejected");
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { candidate });
  });

  socket.on("end-call", ({ to }) => {
    io.to(to).emit("call-ended");
  });

  socket.on("send-message", ({ to, message, from, fromName, timestamp }) => {
    io.to(to).emit("receive-message", { message, from, fromName, timestamp });
  });

  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit("user-offline", { userId: user.userId });
      users.delete(socket.id);
      console.log(`Disconnected: ${user.name}`);
    }
  });
});

// Pre-fetch credentials on startup
getFreshICE();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Halo server running on port ${PORT}`));
