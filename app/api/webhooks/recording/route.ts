// File: app/api/webhooks/recording/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma, CallStatus } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const strategy = searchParams.get("strategy");

  const formData = await request.formData();
  const body = Object.fromEntries(formData);
  
  // 1. Get data from Twilio's webhook
  const callSid = body.CallSid as string;
  const recordingUrl = body.RecordingUrl as string;

  if (!recordingUrl) {
    console.log(`Recording webhook called for ${callSid}, but no RecordingUrl.`);
    return NextResponse.json({ status: "no recording" });
  }
  
  // Add ".wav" to the URL to get the audio file
  const audioUrl = `${recordingUrl}.wav`;
  
  const pythonServerUrl = process.env.PYTHON_SERVICE_URL;
  if (!pythonServerUrl) {
    console.error("PYTHON_SERVICE_URL not configured");
    return NextResponse.json({ error: "Server config error" }, { status: 500 });
  }
  
  let detectionResult: CallStatus = "UNKNOWN";
  let aiResponse: any = { error: "No strategy" };

  try {
    // 2. Download the audio file from Twilio
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) throw new Error("Failed to download audio");
    
    // We get the audio as a "blob"
    const audioBlob = await audioResponse.blob();

    if (strategy === "HUGGINGFACE") {
      // 3. Forward the audio blob to your local Python server
      const aiServerResponse = await fetch(`${pythonServerUrl}/predict`, {
        method: "POST",
        body: audioBlob,
        headers: {
          "Content-Type": "audio/wav",
        },
      });

      if (!aiServerResponse.ok) throw new Error("AI service failed");
      
      aiResponse = await aiServerResponse.json();
      
      // 4. Translate the result
      if (aiResponse.label === "human") {
        detectionResult = "HUMAN";
      } else if (aiResponse.label === "voicemail") {
        detectionResult = "MACHINE";
      }
    } else {
      console.log(`Strategy ${strategy} not implemented in webhook`);
    }

    // 5. Update the database
    await prisma.callLog.update({
      where: { twilioCallSid: callSid },
      data: {
        detectionResult: detectionResult,
        rawCallback: aiResponse as Prisma.JsonObject,
      },
    });

    return NextResponse.json({ status: "success" });
  } catch (error: any) {
    console.error(`Recording webhook failed for ${callSid}:`, error.message);
    
    // Log the error to the database
    await prisma.callLog.update({
      where: { twilioCallSid: callSid },
      data: {
        detectionResult: "FAILED",
        rawCallback: { error: error.message } as Prisma.JsonObject,
      },
    });
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}