import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";


function initializeOGServices() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const rpcUrl = process.env.NEXT_PUBLIC_OG_TESTNET_RPC_URL!;

  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  return { signer };
}

export async function POST(req: NextRequest) {
  try {
    const { userInterests, mood, context, type = "post" } = await req.json();

    const { signer } = initializeOGServices();
    const broker = await createZGComputeNetworkBroker(signer);
    const providerAddress = process.env.MEXT_PUBLIC_OG_PROVIDER_ADDRESS!;
    console.log("Using provider address:", providerAddress);

    try {
      await broker.inference.acknowledgeProviderSigner(providerAddress);
    } catch {
      console.log("Provider already acknowledged");
    }

    const { endpoint, model } = await broker.inference.getServiceMetadata(providerAddress);

    // Different prompts for different content types
    const prompts = {
      post: `
      You are a creative social media content generator. Create engaging social media content based on the user's interests and context.

      USER INTERESTS: ${userInterests?.join(', ') || 'general topics'}
      MOOD: ${mood || 'neutral'}
      CONTEXT: ${context || 'daily thoughts'}

      Generate a social media post that is:
      - Engaging and authentic
      - 1-3 sentences maximum
      - Relevant to user interests
      - Matches the specified mood
      - Includes relevant hashtags

      Return ONLY a JSON object with this structure:
      {
        "content": "The actual post content text",
        "hashtags": ["#tag1", "#tag2", "#tag3"],
        "mood": "detected mood",
        "type": "post"
      }
      `,

      meme: `
      You are a meme caption generator. Create hilarious meme captions based on the context.

      CONTEXT: ${context || 'internet culture'}
      MOOD: ${mood || 'funny'}

      Generate a meme caption that is:
      - Hilarious and relatable
      - 1-2 lines maximum
      - Perfect for image macros
      - Includes meme categories

      Return ONLY a JSON object with this structure:
      {
        "caption": "The meme caption text",
        "template_suggestion": "popular meme template suggestion",
        "categories": ["category1", "category2"],
        "type": "meme"
      }
      `,

      question: `
      Generate engaging discussion questions for social media.

      INTERESTS: ${userInterests?.join(', ') || 'general topics'}
      CONTEXT: ${context || 'community discussion'}

      Create a question that:
      - Sparks conversation
      - Is open-ended
      - Relates to user interests
      - Encourages community engagement

      Return ONLY a JSON object with this structure:
      {
        "question": "The engaging question",
        "discussion_prompt": "Why do you think that?",
        "hashtags": ["#discussion", "#community"],
        "type": "question"
      }
      `
    };

    const prompt = prompts[type as keyof typeof prompts] || prompts.post;
    const openai = new OpenAI({
      baseURL: endpoint,
      apiKey: "",
    });

    const headers = await broker.inference.getRequestHeaders(providerAddress, prompt);

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

    console.log("AI generated content:", content);
    // Validate the response format
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Fallback if JSON parsing fails
      parsed = {
        content: content.substring(0, 140),
        hashtags: ["#AI", "#Generated"],
        type: type
      };
    }

    // Verify the inference result
    const isValid = await broker.inference.processResponse(
      providerAddress,
      completion.id,
      content
    );

    return NextResponse.json({
      success: true,
      content: parsed,
      valid: isValid,
      model,
    });

  } catch (err: any) {
    console.error("AI generation error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || "AI service unavailable",
        fallback: generateFallbackContent()
      },
      { status: 500 }
    );
  }
}

function generateFallbackContent() {
  const fallbacks = [
    {
      content: "Just had an amazing thought about the future of technology! What's your take on AI advancements? 🤔",
      hashtags: ["#Technology", "#AI", "#Future"],
      type: "post"
    },
    {
      content: "When you finally fix that bug after 5 hours... 🎉",
      hashtags: ["#Programming", "#DeveloperLife", "#Success"],
      type: "post"
    },
    {
      question: "What's the most interesting thing you've learned this week?",
      hashtags: ["#Learning", "#Community", "#Discussion"],
      type: "question"
    }
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}