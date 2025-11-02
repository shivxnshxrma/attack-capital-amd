// File: app/api/dial/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth"; // Your auth config
import { PrismaClient } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  // 1. Get user and Twilio client
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  // 2. Get form data
  const { phoneNumber, strategy } = await request.json();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  try {
    let call;

    if (strategy === "TWILIO_NATIVE") {
      // --- NATIVE STRATEGY (No change) ---
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        machineDetection: "Enable",
        statusCallback: `${appUrl}/api/webhooks/twilio`,
        statusCallbackEvent: ["completed"],
        statusCallbackMethod: "POST",
        twiml: `<Response><Say>Connecting your call</Say></Response>`,
      });
    } else if (strategy === "HUGGINGFACE" || strategy === "GEMINI_FLASH") {
      
      // --- NEW STREAMING STRATEGY ---
      
      // 1. Create the call with dummy TwiML
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        twiml: `<Response><Say>Please wait one moment.</Say><Pause length="60"/></Response>`,
      });
      
      // 2. Get the ngrok URL and build the stream URL
      const pythonServerUrl = process.env.PYTHON_SERVICE_URL;
      if (!pythonServerUrl) throw new Error("PYTHON_SERVICE_URL not set");
      
      const pythonHost = pythonServerUrl.replace("https://", "wss://");
      const streamUrl = `${pythonHost}/ws?callSid=${call.sid}&strategy=${strategy}`;
      
      // 3. Immediately UPDATE the call with the *real* TwiML
      await client.calls(call.sid).update({
        twiml: `<Response><Connect><Stream url="${streamUrl}" /></Connect></Response>`,
      });
      
      console.log(`Updated call ${call.sid} to stream to ${streamUrl}`);
      
    } else {
      throw new Error("Invalid strategy");
    }

    // 4. Log to our database
    await prisma.callLog.create({
      data: {
        toNumber: phoneNumber,
        fromNumber: process.env.TWILIO_PHONE_NUMBER!,
        twilioCallSid: call.sid,
        strategyUsed: strategy as any,
        detectionResult: "INITIATED",
      },
    });

    return NextResponse.json({ status: "dialed", callSid: call.sid });
  } catch (error: any) {
    console.error("Twilio call failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}