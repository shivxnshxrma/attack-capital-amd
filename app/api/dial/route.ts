// File: app/api/dial/route.ts
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth"; // Your auth config
import { PrismaClient } from "@prisma/client";
import twilio from "twilio";

const prisma = new PrismaClient();

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

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
      
      // --- THE NEW, SIMPLER PIPELINE ---
      const pythonServerUrl = process.env.PYTHON_SERVICE_URL;
      if (!pythonServerUrl) throw new Error("PYTHON_SERVICE_URL not set");

      // 1. Build the *static* wss:// URL to your ngrok server
      const streamUrl = `${pythonServerUrl.replace(
        "https://",
        "wss://"
      )}/ws?strategy=${strategy}`; // No CallSid!
      
      console.log(`Using static TwiML with stream URL: ${streamUrl}`);

      // 2. Create the call and pass the TwiML directly
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        // We provide the TwiML directly, which trial accounts allow.
        twiml: `<Response>
                  <Connect>
                    <Stream url="${streamUrl}" />
                  </Connect>
                </Response>`,
      });
      // ------------------------------------

    } else {
      throw new Error("Invalid strategy");
    }

    // Log to our database
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
  } catch (error: any){
    console.error("Twilio call failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}