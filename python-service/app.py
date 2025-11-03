import tempfile
import uvicorn
from fastapi import FastAPI, File, Body
from transformers import AutoModelForAudioClassification, AutoFeatureExtractor
import torch
import librosa
import numpy as np
import io
import json
import base64
import asyncio
from contextlib import asynccontextmanager
from generated_prisma_client import Prisma
import httpx
import os
from dotenv import load_dotenv
# --- Google Gemini ---
import google.generativeai as genai

# --- Load .env file ---
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

# --- Configure Gemini ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found. Strategy 4 will fail.")

# --- Prisma Setup ---
prisma = Prisma(datasource={"url": os.environ.get("DIRECT_URL")})

# --- Hugging Face Model Setup ---
HF_MODEL_NAME = "jakeBland/wav2vec-vm-finetune"
hf_model = AutoModelForAudioClassification.from_pretrained(HF_MODEL_NAME)
hf_feature_extractor = AutoFeatureExtractor.from_pretrained(HF_MODEL_NAME)
hf_labels = hf_model.config.id2label

# --- Lifespan for DB connection ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Connecting to database...")
    await prisma.connect()
    print("Database connected.")
    yield
    print("Disconnecting from database...")
    await prisma.disconnect()
    print("Database disconnected.")

app = FastAPI(lifespan=lifespan)

# --- Helper: Get Twilio Auth Header ---
def get_twilio_auth():
    return (os.environ.get("TWILIO_ACCOUNT_SID"), os.environ.get("TWILIO_AUTH_TOKEN"))

# --- Hugging Face Prediction Function ---
def get_hf_prediction(audio_bytes):
    try:
        audio, sample_rate = librosa.load(io.BytesIO(audio_bytes), sr=16000)
        inputs = hf_feature_extractor(audio, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = hf_model(**inputs).logits
        predicted_id = torch.argmax(logits, dim=-1).item()
        return {"label": hf_labels[predicted_id]}
    except Exception as e:
        print(f"Error in HF prediction: {e}")
        return {"error": str(e)}

# File: python-service/app.py

# ... (keep all other code and imports the same) ...

# --- *** CORRECTED Gemini Prediction Function (Synchronous) *** ---

def get_gemini_prediction(audio_bytes):  # 1. REMOVED 'async'
    try:
        if not GEMINI_API_KEY:
            return {"error": "Gemini API key not configured"}

        print("Asking Gemini to analyze audio bytes...")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
            temp_file.write(audio_bytes)
            temp_file_path = temp_file.name

        print(f"Temporary audio file created at: {temp_file_path}")

        audio_file = genai.upload_file(path=temp_file_path, mime_type="audio/wav")
        print("Audio file uploaded to Gemini.")

        model = genai.GenerativeModel(model_name="models/gemini-flash-latest")
        prompt = (
            "You are an answering machine detection (AMD) system. "
            "Analyze this audio file. The audio is the first 3 seconds of a phone call. "
            "Respond with only one word: 'human' if you hear a human greeting like 'hello', "
            "or 'voicemail' if you hear a machine greeting or a beep."
        )

        # 2. Call the SYNCHRONOUS function (no 'await', no '_async')
        response = model.generate_content([prompt, audio_file])

        # 3. Call the SYNCHRONOUS function (no 'await')
        genai.delete_file(audio_file.name)

        os.remove(temp_file_path)

        label = response.text.strip().lower()
        if "human" in label:
            return {"label": "human"}
        else:
            return {"label": "voicemail"}

    except Exception as e:
        print(f"Error in Gemini prediction: {e}")
        if 'temp_file_path' in locals() and os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        return {"error": str(e)}
# --- Health Check ---
@app.get("/")
def read_root():
    return {"status": "AI service is running"}

# --- /predict endpoint (for curl testing) ---
@app.post("/predict")
async def predict(audio_file: bytes = File(...)):
    # This endpoint will now default to Hugging Face
    return get_hf_prediction(audio_file)

# File: python-service/app.py

# --- Main Endpoint (Corrected) ---
@app.post("/predict_from_url")
async def predict_from_url(data: dict = Body(...)):
    call_sid = data.get("callSid")
    recording_url = data.get("recordingUrl")
    strategy = data.get("strategy")

    if not call_sid or not recording_url or not strategy:
        return {"error": "Missing callSid, recordingUrl, or strategy"}

    print(f"Received job for {call_sid} (Strategy: {strategy})")

    try:
        print("Waiting 5 seconds for recording to process...")
        await asyncio.sleep(5)

        auth = get_twilio_auth()
        async with httpx.AsyncClient() as client:
            response = await client.get(recording_url, auth=auth)
            response.raise_for_status()

        audio_bytes = response.content
        print(f"Audio downloaded for {call_sid}")

        ai_result = {}
        if strategy == "HUGGINGFACE":
            print("Using Hugging Face model...")
            ai_result = get_hf_prediction(audio_bytes) # This was already synchronous
        elif strategy == "GEMINI_FLASH":
            print("Using Gemini Flash model...")
            # 4. REMOVED 'await' from this function call
            ai_result = get_gemini_prediction(audio_bytes) 
        else:
            ai_result = {"error": "Unknown strategy"}

        print(f"AI Result for {call_sid}: {ai_result}")

        detection_result = "UNKNOWN"
        if ai_result.get("label") == "human":
            detection_result = "HUMAN"
        elif ai_result.get("label") == "voicemail":
            detection_result = "MACHINE"

        await prisma.calllog.update(
            where={"twilioCallSid": call_sid},
            data={
                "detectionResult": detection_result,
                "rawCallback": json.dumps(ai_result)
            }
        )
        print(f"Database updated for {call_sid}")
        return {"status": "success", "result": ai_result}

    except Exception as e:
        print(f"Error processing {call_sid}: {e}")
        await prisma.calllog.update(
            where={"twilioCallSid": call_sid},
            data={
                "detectionResult": "FAILED",
                "rawCallback": json.dumps({"error": str(e)})
            }
        )
        return {"error": str(e)}