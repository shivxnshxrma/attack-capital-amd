import uvicorn
from fastapi import FastAPI, UploadFile, File
from transformers import AutoModelForAudioClassification, AutoFeatureExtractor
import torch
import librosa
import numpy as np
import io

# Initialize our FastAPI app
app = FastAPI()

# Load the AI model and feature extractor
# This will download the model the first time it's run
MODEL_NAME = "jakeBland/wav2vec-vm-finetune"
model = AutoModelForAudioClassification.from_pretrained(MODEL_NAME)
feature_extractor = AutoFeatureExtractor.from_pretrained(MODEL_NAME)

# Get the human-readable labels
labels = model.config.id2label

# --- Health Check Endpoint ---
@app.get("/")
def read_root():
    return {"status": "AI service is running"}

# --- The AI Prediction Endpoint ---
@app.post("/predict")
async def predict(audio_file: UploadFile = File(...)):
    try:
        # 1. Read the audio file from the request
        audio_bytes = await audio_file.read()
        
        # 2. Load the audio bytes into an audio processing library
        # We must resample it to 16kHz, which is what the model was trained on
        audio, sample_rate = librosa.load(io.BytesIO(audio_bytes), sr=16000)
        
        # 3. Process the audio to get "features"
        inputs = feature_extractor(
            audio, 
            sampling_rate=16000, 
            return_tensors="pt", 
            padding=True
        )
        
        # 4. Make the AI prediction
        with torch.no_grad():
            logits = model(**inputs).logits
            
        # 5. Get the most likely result
        predicted_id = torch.argmax(logits, dim=-1).item()
        predicted_label = labels[predicted_id]

        return {
            "label": predicted_label, # This will be "human" or "voicemail"
            "confidence": torch.nn.functional.softmax(logits, dim=-1).max().item()
        }
        
    except Exception as e:
        return {"error": str(e)}, 500

# --- Function to run the server ---
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)