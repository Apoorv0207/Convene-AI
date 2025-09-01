import express from "express";
import fetch from "node-fetch";


const router = express.Router();

router.post("/ask", async (req, res) => {
  try {
    const { prompt } = req.body;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + process.env.GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        }),
      }
    );

    const data = await response.json();
    const aiText =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "AI did not return a response.";

    res.json({ reply: aiText });
  } catch (error) {
    console.error("Gemini error:", error);
    res.status(500).json({ reply: "Error fetching AI response" });
  }
});

export default router;
