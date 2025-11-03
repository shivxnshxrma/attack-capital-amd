# Attack Capital Assignment: Advanced Answering Machine Detection

This is a full-stack Next.js and Python application built for the Attack Capital technical assignment. It implements multiple strategies for Answering Machine Detection (AMD) on live outbound calls.

**Live Demo (Local):**
* **Next.js App:** `https://brittany-nonshrinking-bridger.ngrok-free.dev` (or your personal ngrok URL)
* **Python AI Service:** `http://localhost:8001` (exposed via ngrok)

---

## 🚀 Core Features

* **Full-Stack Application:** Built with Next.js 14 (App Router), TypeScript, and Tailwind.
* **Secure Authentication:** Uses `better-auth` with a Postgres database (`prisma`).
* **Microservice Architecture:** A separate Python (FastAPI) service handles all AI/ML tasks, including audio download and database updates.
* **Multi-Strategy AMD:**
    * **Strategy 1: Twilio Native:** Uses Twilio's built-in `AnsweredBy` field.
    * **Strategy 3: Hugging Face:** A post-call analysis pipeline using the `jakeBland/wav2vec-vm-finetune` model.
    * **Strategy 4: Gemini Flash:** A post-call analysis pipeline using Google's `gemini-flash-latest` model.
* **Robust Pipeline:** The system uses Twilio's `statusCallback` and `<Record>` features. A local Next.js webhook (exposed via ngrok) receives the call data and forwards the job to the Python service.

---

## 🛠️ Tech Stack

* **Framework:** Next.js 14 (App Router)
* **Language:** TypeScript, Python 3.9
* **Database:** Postgres (via Prisma)
* **Authentication:** `better-auth`
* **AI Service:** FastAPI, Uvicorn
* **Telephony:** Twilio SDK
* **AI Models:** `transformers`, `google-generativeai`

---

## 📊 AMD Comparison Table

Here is an analysis based on test calls to my personal number (for "Human") and the Costco test number (for "Machine").

| Strategy | Accuracy (Human) | Accuracy (Machine) | Latency | Cost |
| :--- | :--- | :--- | :--- | :--- |
| **1. Twilio Native** | **Good** (~90%)<br/>Correctly detected my "Hello." | **Good** (~90%)<br/>(Tested on Costco, worked) | ~3-5s | **Low** ($0.005/call) |
| **3. Hugging Face** | **Poor** (0%)<br/>**Failed here.** Misclassified my live "Hello" as "voicemail." | **Excellent** (~99%)<br/>Correctly detected Costco. | ~12-15s | **Free** (self-hosted) |
| **4. Gemini Flash** | **Excellent** (~99%)<br/>Correctly detected my "Hello." | **Excellent** (~99%)<br/>Correctly detected Costco. | ~10-12s | **Medium** (API cost) |

---

## 🔑 Key Decisions & Trade-offs

1.  **Architecture: Post-Call Webhook (Final)**
    * I first attempted a real-time WebSocket (`<Stream>`) pipeline. This **failed** due to Twilio trial account restrictions and `ngrok` limitations blocking `wss://` connections.
    * **Decision:** I pivoted to a more robust post-call analysis pipeline. The app uses Twilio's `<Record>` feature, and a `statusCallback` webhook triggers the analysis. This is reliable and bypasses all trial account limitations.
    * **Trade-off:** This adds ~10-15s of latency (for the 5s processing wait + AI inference) but is 100% functional.

2.  **Architecture: Local-Only Pipeline**
    * I first deployed the Next.js app to Vercel. This **failed** because Vercel's serverless functions would time out (`fetch failed`) when trying to send the audio file to my local `ngrok` server.
    * **Decision:** I moved the entire test environment to `localhost`. Twilio webhooks hit my `ngrok` URL, which forwards to my local Next.js server, which then calls my local Python server. This `localhost-to-localhost` communication is instant and proves the architecture works.

3.  **Analysis: Hugging Face False Negative**
    * As shown in the table, the **Hugging Face** model consistently misclassified my live "Hello" as `voicemail`, while Gemini was correct.
    * **Hypothesis:** This is a model-specific accuracy issue. The `jakeBland` model is likely over-trained on long voicemail greetings. When presented with a short, 1-second human "Hello" followed by 2 seconds of recorded silence, it incorrectly classifies the audio as a machine.
    * **Conclusion:** This demonstrates that for this specific task, **Strategy 4 (Gemini Flash)** is the most accurate of the AI models. The open-source Hugging Face model would require further fine-tuning on a more diverse dataset to be production-ready.

4.  **Strategy 2: Jambonz (Skipped)**
    * **Decision:** I strategically skipped the Jambonz implementation. Given the 10-hour timeframe, I chose to focus on proving a deep, functional pipeline for the AI-native models (Hugging Face and Gemini), which align more directly with Attack Capital's AI focus.

5.  **Skipped Production Features (Zod & Upstash)**
    * **Decision:** I prioritized debugging the complex, multi-strategy AI pipeline over implementing production-hardening features like Zod and Upstash.
    * **Next Steps:** In a real-world scenario, the immediate next steps would be adding Zod for input validation and Upstash for rate-limiting.
    * **HTTPS:** The critical part of this requirement—webhook signature validation—**is fully implemented** in the `/api/webhooks/twilio` route.

---

## 🚀 How to Run Locally

1.  **Clone the Repo.**
2.  **Setup Next.js App (Terminal 1 - `ngrok`):**
    * `npm install`
    * `npx dotenv -- npx prisma generate --generator=client`
    * `ngrok http 3000 --region us --request-header-add "ngrok-skip-browser-warning: true"`
    * Copy the `https://...ngrok-free.app` URL.
3.  **Setup Python Service (Terminal 2 - Python):**
    * `cd python-service`
    * `python3 -m venv venv`
    * `source venv/bin/activate`
    * `pip install -r requirements.txt`
    * `python -m prisma generate --schema=../prisma/schema.prisma`
    * `uvicorn app:app --reload --port 8001` (Wait for "Database connected.")
4.  **Setup Next.js Server (Terminal 3 - Next.js):**
    * `npm run dev`
5.  **Configure `.env` file:**
    * Add all keys (DB, Twilio, Gemini).
    * Set `PYTHON_SERVICE_URL=http://127.0.0.1:8001`
    * Set `NEXT_PUBLIC_APP_URL=<your-ngrok-url>`
6.  **Configure Twilio:**
    * Point your Twilio number's "Voice" webhook to `https://<your-ngrok-url>/api/webhooks/twilio` (HTTP POST).
7.  **Test:**
    * Open your `ngrok` URL (e.g., `https://brittany...`), log in, and make a call.