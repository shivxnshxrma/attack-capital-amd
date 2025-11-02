import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File, Body
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
import httpx # Add httpx for async requests
import os
from dotenv import load_dotenv

# --- Load .env file ---
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

# --- Prisma Setup ---
prisma = Prisma(datasource={"url": os.environ.get("DIRECT_URL")})

# --- Model Setup ---
MODEL_NAME = "jakeBland/wav2vec-vm-finetune"
model = AutoModelForAudioClassification.from_pretrained(MODEL_NAME)
feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_NAME)
labels = model.config.id2label

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

# --- Re-usable Prediction Function ---
def get_prediction(audio_bytes):
    try:
        audio, sample_rate = librosa.load(io.BytesIO(audio_bytes), sr=16000)
        inputs = feature_extractor(audio, sampling_rate=16000, return_tensors="pt", padding=True)
        with torch.no_grad():
            logits = model(**inputs).logits
        predicted_id = torch.argmax(logits, dim=-1).item()
        return {"label": labels[predicted_id]}
    except Exception as e:
        print(f"Error in get_prediction: {e}")
        return {"error": str(e)}

# --- Health Check ---
@app.get("/")
def read_root():
    return {"status": "AI service is running"}

# --- /predict endpoint (for curl testing) ---
@app.post("/predict")
async def predict(audio_file: bytes = File(...)):
    return get_prediction(audio_file)

# --- *** NEW ENDPOINT *** ---
# Vercel will call this endpoint
@app.post("/predict_from_url")
async def predict_from_url(data: dict = Body(...)):
    call_sid = data.get("callSid")
    recording_url = data.get("recordingUrl")

    if not call_sid or not recording_url:
        return {"error": "Missing callSid or recordingUrl"}
        
    print(f"Received job for {call_sid}. URL: {recording_url}")
    
    try:
        # 1. Download audio from Twilio (with auth)
        auth = get_twilio_auth()
        async with httpx.AsyncClient() as client:
            response = await client.get(recording_url, auth=auth)
            response.raise_for_status() # Raise error if not 200
        
        audio_bytes = response.content
        print(f"Audio downloaded for {call_sid}")
        
        # 2. Get AI prediction
        ai_result = get_prediction(audio_bytes)
        print(f"AI Result for {call_sid}: {ai_result}")
        
        detection_result = "UNKNOWN"
        if ai_result.get("label") == "human":
            detection_result = "HUMAN"
        elif ai_result.get("label") == "voicemail":
            detection_result = "MACHINE"
            
        # 3. Update the database
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