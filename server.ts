import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini API client on server-side if key is present
let aiClient: GoogleGenAI | null = null;
function getGeminiClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
    }
  }
  return aiClient;
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "Mithaq Arabic Matchmaking API" });
});

// Google Sheets Submission Endpoint
import fs from "fs";

// Local storage backup directory
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}
const SUBMISSIONS_FILE = path.join(DATA_DIR, "submissions.json");

app.post("/api/submit-to-sheets", async (req, res) => {
  const formData = req.body;
  const timestamp = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const genderLabel = formData.gender === "male" ? "خاطب (رجل)" : "مخطوبة (امرأة)";

  const valuesRow = [
    timestamp,
    genderLabel,
    formData.fullName || formData.displayName || "",
    formData.age || "",
    formData.nationality || "",
    formData.country || "",
    formData.city || "",
    formData.maritalStatus || "",
    formData.educationLevel || formData.specialization || "",
    formData.jobTitle || "",
    formData.employmentSector || "",
    formData.monthlyIncomeRange || "",
    formData.religiousCommitment || "",
    formData.quranMemorization || "",
    formData.hijabNiqabStatus || formData.beardStatus || "",
    formData.height || "",
    formData.weight || "",
    formData.skinTone || "",
    formData.phone || "",
    formData.waliName || "",
    formData.waliPhone || "",
    formData.waliRelation || "",
    formData.email || "",
    formData.bio || "",
    formData.desiredQualities || ""
  ];

  // 1. Save locally to server backup JSON file
  let savedCount = 0;
  try {
    let currentSubmissions = [];
    if (fs.existsSync(SUBMISSIONS_FILE)) {
      try {
        currentSubmissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf-8"));
      } catch (e) {}
    }
    const newSubmission = { id: `sub-${Date.now()}`, timestamp, ...formData };
    currentSubmissions.push(newSubmission);
    fs.writeFileSync(SUBMISSIONS_FILE, JSON.stringify(currentSubmissions, null, 2), "utf-8");
    savedCount = currentSubmissions.length;
    console.log(`Submission #${savedCount} saved to local backup storage.`);
  } catch (err) {
    console.error("Local storage backup error:", err);
  }

  let sheetsSuccess = false;
  let sheetsErrorMsg = "";

  // 2. Try Google Apps Script WebApp / Webhook URL if provided
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL || process.env.GOOGLE_SCRIPT_URL;
  if (webhookUrl) {
    try {
      // Send as both JSON and URLSearchParams for max compatibility with Apps Script
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          timestamp,
          gender: genderLabel,
          fullName: formData.fullName || formData.displayName || "",
          age: formData.age,
          country: formData.country,
          city: formData.city,
          nationality: formData.nationality,
          maritalStatus: formData.maritalStatus,
          education: formData.educationLevel,
          job: formData.jobTitle,
          sector: formData.employmentSector,
          income: formData.monthlyIncomeRange,
          commitment: formData.religiousCommitment,
          quran: formData.quranMemorization,
          hijabOrBeard: formData.hijabNiqabStatus || formData.beardStatus,
          height: formData.height,
          weight: formData.weight,
          skinTone: formData.skinTone,
          phone: formData.phone,
          waliName: formData.waliName,
          waliPhone: formData.waliPhone,
          email: formData.email,
          bio: formData.bio,
          desiredQualities: formData.desiredQualities,
          valuesRow 
        })
      });
      if (response.ok || response.status === 302 || response.status === 200) {
        sheetsSuccess = true;
        console.log("Successfully sent row to Google Sheets Webhook.");
      }
    } catch (err: any) {
      console.error("Error sending to Google Sheets Webhook:", err.message || err);
    }
  }

  // 3. Try official Google Sheets API v4
  if (!sheetsSuccess) {
    try {
      const auth = new google.auth.GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      const sheets = google.sheets({ version: "v4", auth });
      const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "1clPuhjVoCMeKk5c2w5_TfWmb5yo5uiZQE4TYwGl3WdA";

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "A:Z",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [valuesRow],
        },
      });

      sheetsSuccess = true;
      console.log("Successfully appended row to Google Sheet:", spreadsheetId);
    } catch (error: any) {
      sheetsErrorMsg = error.message || String(error);
      console.log("Google Sheets API append log notice:", sheetsErrorMsg);
    }
  }

  res.json({
    success: true,
    sheetsSynced: sheetsSuccess,
    totalSaved: savedCount,
    message: "تم حفظ الطلب وتخزينه بنجاح."
  });
});

// Endpoint to view all saved submissions
app.get("/api/admin/submissions", (req, res) => {
  try {
    if (fs.existsSync(SUBMISSIONS_FILE)) {
      const submissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf-8"));
      return res.json({ success: true, count: submissions.length, submissions });
    }
    res.json({ success: true, count: 0, submissions: [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// CSV Export Endpoint for direct import into Google Sheets
app.get("/api/admin/submissions/csv", (req, res) => {
  try {
    let submissions: any[] = [];
    if (fs.existsSync(SUBMISSIONS_FILE)) {
      submissions = JSON.parse(fs.readFileSync(SUBMISSIONS_FILE, "utf-8"));
    }

    const headers = [
      "تاريخ الطلب",
      "نوع الطلب",
      "الاسم الكامل",
      "العمر",
      "الجنسية",
      "بلد الإقامة",
      "المدينة",
      "الحالة الاجتماعية",
      "التعليم والتخصص",
      "المسمى الوظيفي",
      "قطاع العمل",
      "نطاق الدخل",
      "الالتزام الديني",
      "حفظ القرآن",
      "الحجاب / اللحية",
      "الطول",
      "الوزن",
      "لون البشرة",
      "رقم الجوال",
      "اسم ولي الأمر",
      "رقم ولي الأمر",
      "صلة القرابة",
      "البريد الإلكتروني",
      "النبذة الشخصية",
      "مواصفات الشريك"
    ];

    const csvRows = [headers.join(",")];

    submissions.forEach(sub => {
      const row = [
        sub.timestamp || "",
        sub.gender === "male" ? "خاطب" : "مخطوبة",
        sub.fullName || sub.displayName || "",
        sub.age || "",
        sub.nationality || "",
        sub.country || "",
        sub.city || "",
        sub.maritalStatus || "",
        sub.educationLevel || sub.specialization || "",
        sub.jobTitle || "",
        sub.employmentSector || "",
        sub.monthlyIncomeRange || "",
        sub.religiousCommitment || "",
        sub.quranMemorization || "",
        sub.hijabNiqabStatus || sub.beardStatus || "",
        sub.height || "",
        sub.weight || "",
        sub.skinTone || "",
        sub.phone || "",
        sub.waliName || "",
        sub.waliPhone || "",
        sub.waliRelation || "",
        sub.email || "",
        sub.bio || "",
        sub.desiredQualities || ""
      ].map(field => `"${String(field).replace(/"/g, '""')}"`);

      csvRows.push(row.join(","));
    });

    // UTF-8 BOM for Arabic text in Excel / Google Sheets
    const csvContent = "\uFEFF" + csvRows.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="mithaq_submissions.csv"');
    res.status(200).send(csvContent);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI Marriage Advisor Endpoint (Compatibility Analysis)
app.post("/api/ai/compatibility", async (req, res) => {
  try {
    const { userProfile, targetProfile, calcScore } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        advisorText: `بناءً على المعطيات المدخلة، تُظهر خوارزمية ميثاق توافقًا بنسبة ${calcScore}%. يوصى بتبادل الأسئلة الشرعية والاطلاع على نبذة الطرف الآخر لمزيد من التفاهم.`
      });
    }

    const prompt = `أنت مستشار زواج ومصلح أسري خبير في منصة "ميثاق" الفاخرة للزواج الشرعي بالوطن العربي والخليج.
يرجى قراءة المواصفات التالية لطرفين يبحثان عن الزواج الشرعي وتقديم تحليل مستشار لطيف، راقٍ وموجز باللغة العربية الفصحى الأنيقة (في حدود 3-4 أسطر):

الطرف الأول (${userProfile.gender === 'male' ? 'خاطب' : 'مخطوبة'}):
- العمر: ${userProfile.age}
- البلد والجنسية: ${userProfile.country} (${userProfile.nationality})
- التعليم والعمل: ${userProfile.educationLevel}، ${userProfile.jobTitle}
- الالتزام: ${userProfile.religiousCommitment}
- نبذة: ${userProfile.bio}

الطرف الثاني (${targetProfile.displayName} - ${targetProfile.gender === 'male' ? 'خاطب' : 'مخطوبة'}):
- العمر: ${targetProfile.age}
- البلد والجنسية: ${targetProfile.country} (${targetProfile.nationality})
- التعليم والعمل: ${targetProfile.educationLevel}، ${targetProfile.jobTitle}
- الالتزام: ${targetProfile.religiousCommitment}
- نبذة: ${targetProfile.bio}
- المواصفات المطلوبة: ${targetProfile.desiredQualities}

نسبة التوافق المحسوبة: ${calcScore}%

صغ نصيحة وتوجيهاً أسرياً مباركاً ومحفزاً للطرفين يركز على النقاط المشتركة.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt
    });

    res.json({
      advisorText: response.text || `توافق ممتاظ بنسبة ${calcScore}%. نسأل الله أن يبارك في الخطوات.`
    });
  } catch (err: any) {
    console.error("Gemini API Error:", err);
    res.json({
      advisorText: `تقارب مبارك يظهر من خلال الاهتمامات المشتركة والالتزام والتقارب العمرائي والثقافي.`
    });
  }
});

// AI Bio Polish Endpoint
app.post("/api/ai/enhance-bio", async (req, res) => {
  try {
    const { rawBio, gender } = req.body;
    const ai = getGeminiClient();

    if (!ai || !rawBio) {
      return res.json({
        enhancedBio: rawBio || "إنسان محافظ، أبحث عن الاستقرار والمودة وبناء أسرة طيبة مباركة."
      });
    }

    const prompt = `أعد صياغة النبذة الشخصية التالية المكتوبة لخاطب/مخطوبة في منصة زواج شرعي راقية ("ميثاق").
الجنس: ${gender === 'male' ? 'رجل (خاطب)' : 'امرأة (مخطوبة)'}
النبذة الأصلية: "${rawBio}"

المطلوب: صياغتها بلغة عربية فصحى راقية، حشمة، متزنة، ومؤثرة دون مبالغة أو تصنّع، وفي غضون فقرة واحدة قصيرة.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt
    });

    res.json({
      enhancedBio: response.text?.trim() || rawBio
    });
  } catch (err: any) {
    console.error("Bio Enhance Error:", err);
    res.json({ enhancedBio: req.body.rawBio || "" });
  }
});

// Start Express Server with Vite Middleware or Static Production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Mithaq Server running on http://localhost:${PORT}`);
  });
}

startServer();
