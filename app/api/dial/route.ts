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
    let twiml;

    if (strategy === "TWILIO_NATIVE") {
      // --- NATIVE STRATEGY (No change) ---
      twiml = `<Response><Say>Connecting your call</Say></Response>`;
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        machineDetection: "Enable",
        statusCallback: `${appUrl}/api/webhooks/twilio`, // The AMD result webhook
        statusCallbackEvent: ["completed"],
        statusCallbackMethod: "POST",
        twiml: twiml,
      });

    } else if (strategy === "HUGGINGFACE" || strategy === "GEMINI_FLASH") {
      // --- NEW <Record> STRATEGY ---
      
      // We tell Twilio to:
      // 1. Record 3 seconds of audio.
      // 2. When done, POST the recording URL to our new webhook.
      // 3. Hang up.
      twiml = `<Response>
                 <Record 
                   maxLength="3" 
                   action="${appUrl}/api/webhooks/recording?strategy=${strategy}" 
                   recordingStatusCallback="${appUrl}/api/webhooks/recording?strategy=${strategy}" 
                   recordingStatusCallbackMethod="POST"
                 />
                 <Hangup />
               </Response>`;
      
      call = await client.calls.create({
        to: phoneNumber,
        from: process.env.TWILIO_PHONE_NUMBER!,
        twiml: twiml,
      });
      
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
  } catch (error: any) {
    console.error("Twilio call failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}