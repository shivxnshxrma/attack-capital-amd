// File: app/api/webhooks/twilio/route.ts
import { NextResponse } from "next/server";
import { PrismaClient, Prisma, CallStatus } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

// Create a single, reusable Twilio client
const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Helper to create the Basic Auth header for 'fetch'
function getTwilioAuthHeader() {
  const credentials = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");
  return `Basic ${credentials}`;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const body = Object.fromEntries(formData);

  // 1. Validate the webhook
  const twilioSignature = request.headers.get("X-Twilio-Signature");
  const webhookUrl = request.url;
  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN!,
    twilioSignature!,
    webhookUrl,
    body
  );
  if (!isValid) {
    console.error("Invalid Twilio signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // 2. Get the CallSid
  const callSid = body.CallSid as string;
  if (!callSid) {
    return NextResponse.json({ error: "Missing CallSid" });
  }

  // 3. Find the call in our DB
  const call = await prisma.callLog.findUnique({
    where: { twilioCallSid: callSid },
  });

  if (!call) {
    console.error(`No call log found for ${callSid}`);
    return NextResponse.json({ error: "No call log found" });
  }

  // 4. Handle based on strategy
  try {
    if (call.strategyUsed === "TWILIO_NATIVE") {
      // --- STRATEGY 1: NATIVE AMD ---
      const amdStatus = body.AnsweredBy as string;
      let result: CallStatus = "UNKNOWN";

      if (amdStatus === "human") result = "HUMAN";
      if (amdStatus === "machine_start") result = "MACHINE";

      await prisma.callLog.update({
        where: { twilioCallSid: callSid },
        data: {
          detectionResult: result,
          rawCallback: body as Prisma.JsonObject,
        },
      });
    } else if (call.strategyUsed === "HUGGINGFACE") {
      // --- STRATEGY 3: HUGGING FACE ---
      
      // 4a. Make an authenticated API call to fetch the recording
      console.log(`Fetching recordings for ${callSid}...`);
      const recordings = await client.recordings.list({
        callSid: callSid,
        limit: 1,
      });

      if (!recordings || recordings.length === 0) {
        throw new Error(`No recordings found for ${callSid}`);
      }

      const recording = recordings[0];
      const mediaUrl = `https://api.twilio.com${recording.uri.replace(".json", ".wav")}`;
      console.log(`Found recording URL: ${mediaUrl}`);
      
      const pythonServerUrl = process.env.PYTHON_SERVICE_URL;

      // 4b. Download the .wav file (using 'fetch' with auth)
      const audioResponse = await fetch(mediaUrl, {
        headers: {
          Authorization: getTwilioAuthHeader(),
        },
      });

      if (!audioResponse.ok) {
        throw new Error(
          `Failed to download audio: ${audioResponse.statusText}`
        );
      }
      const audioBlob = await audioResponse.blob();

      // 4c. Send it to your local Python server
      const aiResponse = await fetch(`${pythonServerUrl}/predict`, {
        method: "POST",
        body: audioBlob,
        headers: { "Content-Type": "audio/wav" },
      });

      if (!aiResponse.ok) throw new Error("AI service failed");
      const aiResult = await aiResponse.json();

      let result: CallStatus = "UNKNOWN";
      if (aiResult.label === "human") result = "HUMAN";
      if (aiResult.label === "voicemail") result = "MACHINE";

      // 4d. Update the database
      await prisma.callLog.update({
        where: { twilioCallSid: callSid },
        data: {
          detectionResult: result,
          rawCallback: aiResult as Prisma.JsonObject,
        },
      });
    }

    return NextResponse.json({ status: "success" });
  } catch (error: any) {
    console.error(`Webhook failed for ${callSid}:`, error.message);
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