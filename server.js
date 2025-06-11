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

const FRONTEND_URL = "https://starhub-2cmo.vercel.app";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
    cb(null, name);
  }
});
const upload = multer({ storage });

app.post("/api/register", async (req, res) => {
  const { email, password, name, avatar, bio } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: "Missing required fields" });

  const { data: existingUser } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
  if (existingUser) return res.status(400).json({ error: "User already exists" });

  const hash = await bcrypt.hash(password, 10);
  const { error } = await supabase.from("users").insert([{ email, password: hash, name, avatar, bio }]);
  if (error) return res.status(500).json({ error: "Database error" });

  res.status(201).json({ message: "User registered successfully" });
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const { data: user, error } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
  if (error || !user) return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ token, profile: { email: user.email, name: user.name, avatar: user.avatar, bio: user.bio } });
});

app.get("/api/profile", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from("users").select("email, name, avatar, bio").eq("email", decoded.email).maybeSingle();
    res.json(user);
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
});

app.get("/api/articles", async (req, res) => {
  try {
    const { data, error } = await supabase.from("articles").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch articles" });
  }
});

app.get("/api/articles/:id", async (req, res) => {
  try {
    const { data, error } = await supabase.from("articles").select("*").eq("id", req.params.id).maybeSingle();
    if (error || !data) return res.status(404).json({ error: "Article not found" });
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch article" });
  }
});

app.post("/api/articles", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: "Title and content are required" });

    const { data, error } = await supabase
      .from("articles")
      .insert([{ title, content, author_email: decoded.email }])
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch {
    res.status(500).json({ error: "Failed to create article" });
  }
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
  res.status(200).json({ url });
});

app.get("/api/messages/:room", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("room", req.params.room)
      .order("created_at", { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to load messages" });
  }
});

app.get("/api/channels", async (req, res) => {
  try {
    const { data, error } = await supabase.from("rooms").select("id, name");
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to load channels" });
  }
});

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`User ${socket.id} joined room ${room}`);
  });

  socket.on("chatMessage", async ({ room, message, sender = "anonymous" }) => {
    const msgObj = {
      room,
      message,
      sender,
      created_at: new Date().toISOString()
    };

    try {
      const { error } = await supabase.from("messages").insert([msgObj]);
      if (error) throw error;

      io.to(room).emit("chatMessage", msgObj);
      console.log("📨 Broadcasted:", msgObj);
    } catch (err) {
      console.error("❌ Error saving message:", err.message);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});