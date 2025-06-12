const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { Server } = require("socket.io");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://starhub-2cmo.vercel.app",
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors({ origin: "https://starhub-2cmo.vercel.app" }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));


const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "yourSecretKey";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit (optional)
});

// === Authentication Routes ===

app.post("/api/register", upload.single("avatar"), async (req, res) => {
  try {
    const { email, name, username, bio } = req.body;
let { password } = req.body;


    if (!email || !password || !username) {
      return res.status(400).json({ error: "Email, password, and username are required" });
    }

    // Validate password length
if (password.length < 6) {
  return res.status(400).json({ error: "Password must be at least 6 characters long" });
}

// Hash the password
const hashedPassword = await bcrypt.hash(password, 10);
password = hashedPassword;


    // Handle optional avatar
    let avatarUrl = null;
    if (req.file) {
      const ext = path.extname(req.file.originalname);
      const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;

      // Upload to Supabase storage
      const { error: uploadError } = await supabase.storage
  .from("chat-uploads") // make sure this matches your actual bucket
  .upload(filename, req.file.buffer, {
    contentType: req.file.mimetype,
  });

if (uploadError) {
  console.error("🛑 Supabase avatar upload failed:");
  console.error("Message:", uploadError.message);
  console.error("Full error object:", uploadError);
  return res.status(500).json({ error: "Avatar upload failed" });
}

      const { data } = supabase.storage.from("media").getPublicUrl(filename);
avatarUrl = data.publicUrl;

    }

    // Insert user into Supabase
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          email,
          password,
          name,
          username,
          avatar_url: avatarUrl,
          bio,
        },
      ]);

    if (error) {
      console.error("Supabase insert error:", error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const { data: user, error } = await supabase.from("users").select("*").eq("email", email).maybeSingle();
  if (error || !user) return res.status(400).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: "1h" });
  res.json({ token, profile: { email: user.email, name: user.name, avatar: user.avatar_url, bio: user.bio, username: user.username } });
});

// === Profile Routes ===

app.get("/api/profile", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from("users").select("email, name, avatar_url, bio, username").eq("email", decoded.email).maybeSingle();
    res.json(user);
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
});

// Update profile (name, bio, avatar)
app.put("/api/profile", upload.single("avatar"), authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { name, bio } = req.body;
  let avatarUrl = null;

  if (req.file) {
    const filename = `avatar-${Date.now()}-${req.file.originalname}`;
    const filePath = path.join(__dirname, "uploads", filename);
    fs.writeFileSync(filePath, req.file.buffer);
    avatarUrl = `/uploads/${filename}`;
  }

  try {
    const updates = { name, bio };
    if (avatarUrl) updates.avatar_url = avatarUrl;

    const { error } = await supabase.from("users").update(updates).eq("id", userId);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// Delete account
app.delete("/api/account", authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const { error } = await supabase.from("users").delete().eq("id", userId);

    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});

app.put("/api/profile", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { name, bio, avatar } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (bio !== undefined) updates.bio = bio;
    if (avatar !== undefined) updates.avatar = avatar;

    const { error } = await supabase.from("users").update(updates).eq("email", decoded.email);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

app.delete("/api/profile", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing token" });

  try {
    const token = auth.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const { error } = await supabase.from("users").delete().eq("email", decoded.email);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// === Auth Middleware ===

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

app.post("/api/articles", authenticateToken, async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: "Title and content are required" });

  try {
    const { data, error } = await supabase.from("articles").insert([{ title, content, author_email: req.user.email }]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch {
    res.status(500).json({ error: "Failed to create article" });
  }
});

// === Likes ===

app.post("/api/articles/:id/like", authenticateToken, async (req, res) => {
  try {
    const { data: userData } = await supabase.from("users").select("id").eq("email", req.user.email).maybeSingle();
    if (!userData) throw new Error("User not found");

    const { data: existing } = await supabase.from("article_likes").select("*")
      .eq("user_id", userData.id).eq("article_id", req.params.id).maybeSingle();

    if (existing) {
      await supabase.from("article_likes").delete().eq("id", existing.id);
      res.json({ liked: false });
    } else {
      await supabase.from("article_likes").insert([{ user_id: userData.id, article_id: req.params.id }]);
      res.json({ liked: true });
    }
  } catch (err) {
    console.error("❌ Like error:", err.message);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

app.get("/api/articles/:id/likes", async (req, res) => {
  const articleId = req.params.id;
  let userLiked = false;
  try {
    const { count, error } = await supabase
      .from("article_likes")
      .select("*", { count: "exact", head: true })
      .eq("article_id", articleId);
    if (error) throw error;

    const auth = req.headers.authorization;
    if (auth) {
      const token = auth.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const { data: user } = await supabase.from("users").select("id").eq("email", decoded.email).maybeSingle();
      if (user) {
        const { data: like } = await supabase.from("article_likes")
          .select("id")
          .eq("user_id", user.id)
          .eq("article_id", articleId)
          .maybeSingle();
        userLiked = !!like;
      }
    }

    res.json({ count, liked: userLiked });
  } catch (err) {
    res.status(500).json({ error: "Failed to get likes" });
  }
});

// === Upload Route ===

app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const ext = path.extname(req.file.originalname);
  const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`;

  try {
    const { error } = await supabase.storage.from("media").upload(filename, req.file.buffer, {
      contentType: req.file.mimetype
    });
    if (error) throw error;

    const { data: { publicUrl } } = supabase.storage.from("media").getPublicUrl(filename);
    res.status(200).json({ url: publicUrl });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// === Comments ===

app.post("/api/posts/:postId/comments", authenticateToken, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "Comment text is required" });

  try {
    const { data: user } = await supabase.from("users").select("id").eq("email", req.user.email).maybeSingle();
    const { data, error } = await supabase.from("post_comments").insert([
      { post_id: req.params.postId, user_id: user.id, text }
    ]).select();
    if (error) throw error;
    res.status(201).json(data[0]);
  } catch {
    res.status(500).json({ error: "Failed to post comment" });
  }
});

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

// === Channels & Messages ===

app.get("/api/channels", async (req, res) => {
  try {
    const { data, error } = await supabase.from("rooms").select("id, name");
    if (error) throw error;
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to load channels" });
  }
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

// === Real-time Chat (Socket.io) ===

io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  socket.on("joinRoom", (room) => {
    socket.join(room);
  });

  socket.on("chatMessage", async ({ room, message, sender = "anonymous" }) => {
    const msg = { room, message, sender, created_at: new Date().toISOString() };
    try {
      await supabase.from("messages").insert([msg]);
      io.to(room).emit("chatMessage", msg);
    } catch (err) {
      console.error("❌ Chat message error:", err.message);
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