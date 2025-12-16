import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import OpenAI from "openai";

const OG_PROVIDER = process.env.MEXT_PUBLIC_OG_PROVIDER_ADDRESS!;

export async function POST(req: NextRequest) {
    try {
        const { content } = await req.json();

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
    Analyze social media content for safety and appropriateness.

    CONTENT: "${content}"

    Analyze for:
    1. Spam characteristics (commercial intent, repetitive content)
    2. Harmful content (hate speech, harassment, violence)
    3. NSFW material (explicit content, adult themes)
    4. Misinformation (false claims, conspiracy theories)

    Return JSON:
    {
      "isSafe": true,
      "confidence": 0.95,
      "categories": {
        "spam": 0.1,
        "harmful": 0.05,
        "nsfw": 0.02,
        "misinformation": 0.1
      },
      "flags": [],
      "suggestedActions": []
    }

    Consider content safe if all categories < 0.7.
    `;

        const headers = await broker.inference.getRequestHeaders(OG_PROVIDER, prompt);
        const requestHeaders: Record<string, string> = {};
        Object.entries(headers).forEach(([k, v]) => {
            if (typeof v === "string") requestHeaders[k] = v;
        });

        const openai = new OpenAI({
            baseURL: endpoint,
            apiKey: "",
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

        const result = completion.choices[0].message.content || "{}";

        const isValid = await broker.inference.processResponse(OG_PROVIDER,completion.id,result);

         const cleaned = extractJson(result);
            console.log("Relevance analysis result:", cleaned);
        
            return NextResponse.json({
              success: true,
              ...JSON.parse(cleaned),
              valid: isValid,
            });

    } catch (error: any) {
        console.error("Content safety analysis error:", error);
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