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
const io = new Server(server, {
  cors: {
    origin: "https://starhub-2cmo.vercel.app",
    methods: ["GET", "POST"]
  }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors({ origin: "https://starhub-2cmo.vercel.app" }));
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

// Multer with memoryStorage for Supabase Storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// === Auth Routes ===

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

// === Article Routes ===

app.get("/api/articles", async (req, res) => {
  try {
    const { data, error } = await supabase.from("articles").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch {
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

// === Post Like Route ===

function authenticateToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
}

// Like or unlike a post
app.post("/api/posts/:id/like", authenticateToken, async (req, res) => {
  const userEmail = req.user.email;
  const postId = req.params.id;

  try {
    // Get user ID from email
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("email", userEmail)
      .maybeSingle();

    if (userError || !userData) throw userError || new Error("User not found");

    const userId = userData.id;

    // Check if user already liked this post
    const { data: existingLike, error } = await supabase
      .from("post_likes")
      .select("*")
      .eq("user_id", userId)
      .eq("post_id", postId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") throw error;

    if (existingLike) {
      // Unlike
      await supabase.from("post_likes").delete().eq("id", existingLike.id);
      res.json({ liked: false });
    } else {
      // Like
      await supabase.from("post_likes").insert([{ user_id: userId, post_id: postId }]);
      res.json({ liked: true });
    }
  } catch (err) {
    console.error("❌ Like error:", err.message);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

// === Supabase Storage Upload Route ===

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const file = req.file;
  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(filename, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(filename);
    res.status(200).json({ url: publicUrl });
  } catch (err) {
    console.error("Upload failed:", err.message);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// === Comments ===

// Create a comment on a post
app.post("/api/posts/:postId/comments", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Comment text is required" });

    const { data, error } = await supabase
      .from("post_comments")
      .insert([{ post_id: req.params.postId, user_id: decoded.email, text }])
      .select();

    if (error) throw error;
    res.status(201).json(data[0]);
  } catch {
    res.status(500).json({ error: "Failed to post comment" });
  }
});

// Get comments for a post
app.get("/api/posts/:postId/comments", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("post_comments")
      .select("id, text, created_at, user_id")
      .eq("post_id", req.params.postId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to load comments" });
  }
});

// === Messages and Chat ===

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

// === Socket.IO ===

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

// === Start Server ===

server.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});