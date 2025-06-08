const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads"))); // Serve static files

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

// === User Auth (in-memory)
const users = [];

app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  const exists = users.find((u) => u.email === email);
  if (exists) return res.status(400).json({ error: "User already exists" });

  const hash = await bcrypt.hash(password, 10);
  users.push({ email, password: hash });
  res.status(201).json({ message: "User registered successfully" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ token });
});

app.get("/api/profile", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  const token = auth.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ message: "Welcome, " + decoded.email });
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
});

// === Articles (in-memory)
let articles = [];
let nextId = 1;

app.get("/api/articles", (req, res) => res.json(articles));

app.get("/api/articles/:id", (req, res) => {
  const article = articles.find((a) => a.id === parseInt(req.params.id));
  if (!article) return res.status(404).json({ error: "Not found" });
  res.json(article);
});

app.post("/api/articles", (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Missing fields" });

  const article = { id: nextId++, title, content };
  articles.push(article);
  res.status(201).json(article);
});

app.put("/api/articles/:id", (req, res) => {
  const article = articles.find((a) => a.id === parseInt(req.params.id));
  if (!article) return res.status(404).json({ error: "Not found" });

  const { title, content } = req.body;
  article.title = title || article.title;
  article.content = content || article.content;
  res.json(article);
});

app.delete("/api/articles/:id", (req, res) => {
  articles = articles.filter((a) => a.id !== parseInt(req.params.id));
  res.json({ message: "Deleted" });
});

// === Media Upload (Multer)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;
  res.status(200).json({ url: fileUrl });
});

// === Socket.io Chat
io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`Joined room: ${room}`);
  });

  socket.on("chatMessage", ({ room, message }) => {
    console.log(`[${room}] ${message}`);
    io.to(room).emit("chatMessage", message);
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});