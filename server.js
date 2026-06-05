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

const users = new Map(); // socket.id -> { userId, name }

app.get("/", (req, res) => res.json({ status: "Halo signaling server running ✅" }));

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("register", ({ userId, name }) => {
    // Remove any previous socket for this userId
    for (const [sid, u] of users.entries()) {
      if (u.userId === userId && sid !== socket.id) {
        users.delete(sid);
      }
    }
    users.set(socket.id, { userId, name });
    socket.join(userId); // join room named by userId for direct routing
    // Notify others (not self) that this user is online
    socket.broadcast.emit("user-online", { userId, name });
    console.log(`Registered: ${name} (${userId})`);
  });

  // Caller sends offer to callee
  socket.on("call-user", ({ to, offer, callType, callerName }) => {
    const caller = users.get(socket.id);
    if (!caller) return;
    console.log(`Call from ${caller.userId} to ${to}`);
    io.to(to).emit("incoming-call", {
      from:       caller.userId,
      callerName: callerName || caller.name,
      offer,
      callType
    });
  });

  // Callee sends answer back to caller
  socket.on("answer-call", ({ to, answer }) => {
    console.log(`Answer from ${socket.id} to room ${to}`);
    io.to(to).emit("call-answered", { answer });
  });

  // Either side rejects
  socket.on("reject-call", ({ to }) => {
    io.to(to).emit("call-rejected");
  });

  // ICE candidates relay
  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { candidate });
  });

  // End call
  socket.on("end-call", ({ to }) => {
    io.to(to).emit("call-ended");
  });

  // Chat messages relay
  socket.on("send-message", ({ to, message, from, fromName, timestamp }) => {
    io.to(to).emit("receive-message", { message, from, fromName, timestamp });
  });

  // Cleanup on disconnect
  socket.on("disconnect", () => {
    const user = users.get(socket.id);
    if (user) {
      socket.broadcast.emit("user-offline", { userId: user.userId });
      users.delete(socket.id);
      console.log(`Disconnected: ${user.name} (${user.userId})`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`🚀 Halo server running on port ${PORT}`));
