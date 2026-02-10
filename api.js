import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 画像(base64)を送る可能性があるので少し大きめに
app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// OpenAI互換エンドポイント対応（あなたの https://api.japan-peculiar.com 側でも使える想定）
// 例:
// OPENAI_BASE_URL=https://api.openai.com/v1
// または OPENAI_BASE_URL=https://api.japan-peculiar.com/v1 (あなたのproxy仕様に合わせて)
function getBaseUrl() {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

async function callChatCompletions({ messages, temperature = 0.2, max_tokens = 300 }) {
  const apiKey = mustEnv("OPENAI_API_KEY");
  const baseUrl = getBaseUrl();
  const model = getModel();

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg = data?.error?.message || `OpenAI error (${resp.status})`;
    throw new Error(msg);
  }

  const text = data?.choices?.[0]?.message?.content ?? "";
  return text;
}

/**
 * /api/chat : 既存サイトチャット用（壊さない）
 * input: { message: string }
 * output: { reply: string }
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message is required" });

    // APIキー必須
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }

    const system = "You are a helpful support chat assistant.";
    const content = await callChatCompletions({
      messages: [
        { role: "system", content: system },
        { role: "user", content: message },
      ],
      temperature: 0.6,
      max_tokens: 400,
    });

    return res.json({ reply: content });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

/**
 * /api/title : 拡張機能用（B方式：reply内JSON文字列）
 *
 * input (最低限):
 * {
 *   imageUrl?: string,
 *   imageDataUrl?: string,  // data:image/jpeg;base64,... でもOK（推奨）
 *   hintText?: string,
 *   highRes?: boolean
 * }
 *
 * output:
 * {
 *   reply: "{\"title\":\"...\",\"object_ranked\":[...],\"tail_ranked\":[...]}"
 * }
 */
app.post("/api/title", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not set" });
    }

    const {
      imageUrl,
      imageDataUrl,
      hintText = "",
      highRes = false,
    } = req.body || {};

    // 画像は URL でもいいが、運用安定は dataURL 推奨（CORSや403回避）
    const img = imageDataUrl || imageUrl;
    if (!img) {
      return res.status(400).json({ error: "imageUrl or imageDataUrl is required" });
    }

    const detailMode = highRes ? "high" : "low";

    // ---- B方式の中核：reply内にJSON文字列で返させる ----
    // 重要：曖昧語(possibly等)は出さない。候補は順位付きで出す。
    // object候補は最小セット中心（あなたのUI都合）＋必要なら追加OK
    const system = [
      "You are an eBay title assistant specialized in Japanese items.",
      "Return ONLY a JSON object (no markdown, no extra text).",
      "Output JSON schema:",
      "{",
      '  "title": "string (<= 80 chars preferred)",',
      '  "object_ranked": ["string", "... up to 4"],',
      '  "tail_ranked": ["string", "... up to 4"]',
      "}",
      "",
      "Rules:",
      "- object_ranked: rank the best object/type candidates (1st is best). Use singular nouns.",
      "- tail_ranked: rank optional tail keywords (e.g., Figure, Statue, Style, Period). Avoid vague words.",
      "- Do NOT include the user's hintText tokens inside object_ranked or tail_ranked if they already appear in hintText.",
      "- If low detail, focus mostly on object/type; keep tail_ranked conservative.",
      "- If high detail, you may include motif-like keywords in tail_ranked if clearly visible, but still keep it short.",
    ].join("\n");

    // 画像入力：OpenAI互換の "image_url" を使う形（あなたのproxyが対応してる前提）
    // ※ もしあなたのproxyが未対応なら、ここは後であなたの仕様に合わせて変更します。
    const userParts = [
      `hintText: ${hintText || ""}`,
      `detail: ${detailMode}`,
    ].join("\n");

    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: userParts },
          { type: "image_url", image_url: { url: img, detail: detailMode } },
        ],
      },
    ];

    const raw = await callChatCompletions({
      messages,
      temperature: 0.2,
      max_tokens: 260,
    });

    // 返答がJSONであることを期待しつつ、最低限のフォールバック
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      // JSONじゃない場合でも、replyとしてそのまま返して拡張側で確認できるようにする
      return res.json({ reply: raw });
    }

    // reply内JSON文字列に固定（B方式）
    return res.json({ reply: JSON.stringify(obj) });
  } catch (e) {
    return res.status(500).json({ error: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
