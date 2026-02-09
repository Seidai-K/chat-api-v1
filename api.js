import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {  res.json({ status: "ok" });
});

app.post("/api/chat", async (req, res) => {
  try {  
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message is required" });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You are a helpful customer support assistant." },
          { role: "user", content: message }
        ],
        temperature: 0.7
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const reply = data?.choices?.[0]?.message?.content ?? "";
    res.json({ reply });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Chat API running on :${PORT}`);
});

