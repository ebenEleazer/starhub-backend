const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

// === FRONTEND URL ===
const FRONTEND_URL = "https://starhub-2cmo.vercel.app";

// === Supabase Setup ===
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// === Socket.io Setup ===
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

// === Middleware ===
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

console.log("Loaded PORT from env:", process.env.PORT);
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

// === Multer Upload Setup ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage });

// === Register ===
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;

  const { data: existingUser } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hash = await bcrypt.hash(password, 10);

  const { error } = await supabase.from("users").insert([
    { email, password: hash }
  ]);

  if (error) {
    return res.status(500).json({ error: "Database error" });
  }

  res.status(201).json({ message: "User registered successfully" });
});

// === Login ===
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (error || !user) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ token });
});

// === Profile ===
app.get("/api/profile", (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ message: `Welcome, ${decoded.email}` });
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
});

// === In-memory Articles (will move to DB later) ===
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

// === Upload Route ===
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.status(200).json({ url });
});

// === Chat with Socket.io ===
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room ${room}`);
  });

  socket.on("chatMessage", ({ room, message }) => {
    io.to(room).emit("chatMessage", message);
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// === Start the Server ===
server.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});