import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const OG_PROVIDER = process.env.MEXT_PUBLIC_OG_PROVIDER_ADDRESS!;

export async function POST(req: NextRequest) {
  try {
    const { postContent, postEngagement, userInterests, postTimestamp, authorHistory } = await req.json();

    const privateKey = process.env.PRIVATE_KEY!;
    const rpcUrl = process.env.NEXT_PUBLIC_OG_TESTNET_RPC_URL!;

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const broker = await createZGComputeNetworkBroker(signer);

    try {
      await broker.inference.acknowledgeProviderSigner(OG_PROVIDER);
    } catch {
      console.log("Provider already acknowledged");
    }

    const { endpoint, model } = await broker.inference.getServiceMetadata(OG_PROVIDER);

    const prompt = `
    Analyze social media content relevance for user personalization.

    POST CONTENT: ${postContent}
    POST ENGAGEMENT: ${postEngagement} interactions
    USER INTERESTS: ${userInterests.join(', ')}
    POST AGE: ${postTimestamp} 
    AUTHOR HISTORY: ${authorHistory} posts

    Calculate relevance score (0-1) considering:
    1. Engagement potential (0.3 weight)
    2. Timeliness (0.25 weight) 
    3. Personal interest alignment (0.3 weight)
    4. Community trust (0.15 weight)

    Return JSON:
    {
      "score": 0.85,
      "factors": {
        "engagement": 0.9,
        "timeliness": 0.7,
        "personalInterest": 0.8,
        "communityTrend": 0.9
      },
      "recommendations": ["Highly relevant", "Matches user interests"]
    }
    `;

    const openai = new OpenAI({
      baseURL: endpoint,
      apiKey: "",
    });
    const headers = await broker.inference.getRequestHeaders(OG_PROVIDER, prompt);
    const requestHeaders: Record<string, string> = {};
    Object.entries(headers).forEach(([k, v]) => {
      if (typeof v === "string") requestHeaders[k] = v;
    });


    const completion = await openai.chat.completions.create(
      {
        model,
        messages: [{ role: "user", content: prompt }],
      },
      {
        headers: requestHeaders,
      }
    );

    const content = completion.choices[0].message.content || "{}";

    const isValid = await broker.inference.processResponse(OG_PROVIDER, completion.id, content);

    const cleaned = extractJson(content);
    console.log("Relevance analysis result:", cleaned);

    return NextResponse.json({
      success: true,
      ...JSON.parse(cleaned),
      valid: isValid,
    });


  } catch (error: any) {
    console.error("Relevance analysis error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

function extractJson(text: string): string {
  // Remove ```json ... ``` or ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    return fenced[1];
  }

  // Fallback: try to find first JSON object
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }

  return text;
}
