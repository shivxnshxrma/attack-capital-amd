// File: app/api/audiostream/route.ts
import { NextResponse } from "next/server";
import { PassThrough } from "stream";
import { PrismaClient, CallStatus, Prisma } from "@prisma/client";

// This is a special Next.js setting to handle streaming
export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

// We use a Map to hold audio streams, keyed by the CallSid
const streams = new Map<string, PassThrough>();

// --- 1. The HTTP GET Request ---
// This runs first when Twilio tries to connect its WebSocket
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const callSid = searchParams.get("callSid");
  const strategy = searchParams.get("strategy");

  if (!callSid || !strategy) {
    console.error("audiostream GET: Missing callSid or strategy");
    return new NextResponse("Missing callSid or strategy", { status: 400 });
  }

  // Create a new pass-through stream to hold the audio chunks
  const stream = new PassThrough();
  streams.set(callSid, stream);

  // Start the AI processing in the background
  // We don't wait for this to finish
  forwardAudioToAI(stream, callSid, strategy);

  // This is a special Next.js way to "hijack" the request
  // and upgrade it to a WebSocket
  // @ts-ignore
  const response = NextResponse.next();
  response.headers.set("x-custom-websocket", "true");
  return response;
}

// --- 2. The WebSocket Logic ---
// This runs *after* the GET request
// @ts-ignore
export async function SOCKET(client, request) {
  console.log("WebSocket client connected");

  const { searchParams } = new URL(request.url, `https:${request.headers.host}`);
  const callSid = searchParams.get("callSid");

  if (!callSid) {
    console.error("WebSocket: Missing callSid, closing socket");
    client.close();
    return;
  }

  // Find the audio stream we created in the GET request
  const stream = streams.get(callSid);
  if (!stream) {
    console.error(`WebSocket: No stream found for callSid ${callSid}, closing`);
    client.close();
    return;
  }

  // When we receive a message from Twilio...
  client.on("message", (msg: string) => {
    try {
      const data = JSON.parse(msg);

      // We only care about "media" events
      if (data.event === "media") {
        // Get the raw audio (it's base64 encoded)
        const audioPayload = data.media.payload;
        // Convert from base64 to a Buffer
        const audioBuffer = Buffer.from(audioPayload, "base64");
        // Write the audio chunk to our stream
        stream.write(audioBuffer);
      }
      
      // Twilio sends a "stop" message when the stream ends
      if (data.event === "stop") {
        console.log(`WebSocket: Twilio sent stop for ${callSid}`);
        stream.end(); // Close the stream
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e);
    }
  });

  client.on("close", () => {
    console.log(`WebSocket client disconnected for ${callSid}`);
    stream.end();
    streams.delete(callSid);
  });
}


// --- 3. The AI Forwarding Function ---
async function forwardAudioToAI(audioStream: PassThrough, callSid: string, strategy: string) {
  let apiUrl = "";
  
  if (strategy === "HUGGINGFACE") {
    apiUrl = `${process.env.PYTHON_SERVICE_URL}/predict`;
  } else if (strategy === "GEMINI_FLASH") {
    // We'll implement this later
    console.log(`GEMINI_FLASH strategy not yet implemented for ${callSid}`);
    return;
  } else {
    console.log(`Unknown strategy ${strategy} for ${callSid}`);
    return;
  }

  try {
    console.log(`Forwarding audio for ${callSid} to ${apiUrl}`);

    const response = await fetch(apiUrl, {
      method: "POST",
      body: audioStream as any, // Stream the audio directly
      // @ts-ignore
      duplex: "half", // Required for streaming a request body
      headers: {
        // We're sending raw audio, let the Python server know
        "Content-Type": "audio/wav", 
      },
    });

    if (!response.ok) {
      throw new Error(`AI service responded with ${response.status}`);
    }

    const result = await response.json();
    console.log(`AI Result for ${callSid}:`, result);

    // --- We got a result! Now update the database ---
    let detectionResult: CallStatus = "UNKNOWN";
    if (result.label === "human") {
      detectionResult = "HUMAN";
    } else if (result.label === "voicemail") {
      detectionResult = "MACHINE";
    }
    
    await prisma.callLog.update({
      where: { twilioCallSid: callSid },
      data: {
        detectionResult: detectionResult,
        rawCallback: result as Prisma.JsonObject, // Log the AI's response
      },
    });

    // TODO: Update the live Twilio call (e.g., hang up)

  } catch (error) {
    console.error(`Error forwarding audio for ${callSid}:`, error);
  }
}