import os
from dotenv import load_dotenv

# Find the .env file (it's one directory up)
dotenv_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(dotenv_path=dotenv_path)

# --- All other imports go below this line ---
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File
# ... (rest of your imports)
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, File
from transformers import AutoModelForAudioClassification, AutoFeatureExtractor
import torch
import librosa
import numpy as np
import io
import json
import base64
import asyncio
from contextlib import asynccontextmanager # <-- NEW IMPORT
from generated_prisma_client import Prisma
# --- Prisma Database Setup ---
prisma = Prisma(datasource={"url": os.environ.get("DIRECT_URL")})

# --- Model Setup ---
MODEL_NAME = "jakeBland/wav2vec-vm-finetune"
model = AutoModelForAudioClassification.from_pretrained(MODEL_NAME)
feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_NAME)
labels = model.config.id2label

# --- NEW LIFESPAN FUNCTION ---
# This code runs on startup and shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup:
    print("Connecting to database...")
    await prisma.connect()
    print("Database connected.")
    yield
    # On shutdown:
    print("Disconnecting from database...")
    await prisma.disconnect()
    print("Database disconnected.")

# --- Pass the lifespan event to your app ---
app = FastAPI(lifespan=lifespan)


# --- Re-usable Prediction Function ---
def get_prediction(audio_bytes):
    try:
        audio, sample_rate = librosa.load(io.BytesIO(audio_bytes), sr=16000)
        
        inputs = feature_extractor(
            audio, 
            sampling_rate=16000, 
            return_tensors="pt", 
            padding=True
        )
        
        with torch.no_grad():
            logits = model(**inputs).logits
            
        predicted_id = torch.argmax(logits, dim=-1).item()
        predicted_label = labels[predicted_id]
        confidence = torch.nn.functional.softmax(logits, dim=-1).max().item()
        
        return {"label": predicted_label, "confidence": confidence}
        
    except Exception as e:
        print(f"Error in get_prediction: {e}")
        return {"error": str(e)}

# --- Health Check Endpoint ---
@app.get("/")
def read_root():
    return {"status": "AI service is running"}

# --- Old /predict endpoint (for curl testing) ---
@app.post("/predict")
async def predict(audio_file: bytes = File(...)):
    result = get_prediction(audio_file)
    return result

# File: python-service/app.py
# ... (all other code stays the same) ...

# --- NEW WEBSOCKET ENDPOINT ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("WebSocket client connected")
    
    # We don't have the CallSid yet. We'll get it from the "start" message.
    call_sid = None
    audio_stream = io.BytesIO()
    
    try:
        while True:
            message = await websocket.receive_text()
            data = json.loads(message)

            if data["event"] == "start":
                # --- THIS IS THE FIX ---
                # The stream has started. NOW we get the CallSid.
                call_sid = data["start"]["callSid"]
                print(f"Twilio stream started for {call_sid}")
                # -----------------------
                
            if data["event"] == "media":
                payload = data["media"]["payload"]
                audio_buffer = base64.b64decode(payload)
                audio_stream.write(audio_buffer)

            if data["event"] == "stop":
                print(f"Twilio stream stopped for {call_sid}")
                break
                
    except WebSocketDisconnect:
        print(f"WebSocket disconnected for {call_sid or 'Unknown Call'}")
    except Exception as e:
        print(f"Error in WebSocket: {e}")
    finally:
        if not call_sid:
            print("Stream ended but CallSid was never received.")
            audio_stream.close()
            return
            
        print("Processing full audio stream...")
        audio_stream.seek(0)
        full_audio_bytes = audio_stream.read()
        
        if len(full_audio_bytes) > 0:
            result = get_prediction(full_audio_bytes)
            print(f"AI Result for {call_sid}: {result}")
            
            detection_result = "UNKNOWN"
            if result.get("label") == "human":
                detection_result = "HUMAN"
            elif result.get("label") == "voicemail":
                detection_result = "MACHINE"

            await prisma.calllog.update(
                where={"twilioCallSid": call_sid},
                data={
                    "detectionResult": detection_result,
                    "rawCallback": json.dumps(result)
                }
            )
            print(f"Database updated for {call_sid}")
            
        else:
            print("No audio received.")

        audio_stream.close()
        print(f"Closed resources for {call_sid}")
# --- REMOVED the if __name__ == "__main__": block ---