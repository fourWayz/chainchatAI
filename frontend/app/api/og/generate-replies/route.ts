import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { ethers } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

const OG_PROVIDER = process.env.MEXT_PUBLIC_OG_PROVIDER_ADDRESS!;

interface GenerateRepliesRequest {
    postContent: string;
    context?: string;
    maxReplies?: number;
    userInterests?: string[];
    tonePreferences?: string[];
}

interface SmartReply {
    id: string;
    text: string;
    tone: 'friendly' | 'supportive' | 'questioning' | 'agreeing' | 'enthusiastic' | 'thoughtful';
    confidence: number;
}

export async function POST(req: NextRequest) {
    try {
        const { postContent, context, maxReplies = 3, userInterests = [], tonePreferences = [] }: GenerateRepliesRequest = await req.json();

        if (!postContent) {
            return NextResponse.json(
                { success: false, error: "Post content is required" },
                { status: 400 }
            );
        }

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

        // Build the prompt for generating smart replies
        const prompt = `
Generate 3-5 smart, contextual replies for a social media post. Consider the context and user interests.

POST CONTENT: "${postContent}"

ADDITIONAL CONTEXT: ${context || "No additional context provided"}

USER INTERESTS: ${userInterests.length > 0 ? userInterests.join(', ') : "General interests"}

TONE PREFERENCES: ${tonePreferences.length > 0 ? tonePreferences.join(', ') : "Mix of friendly, supportive, and thoughtful"}

GUIDELINES:
- Generate diverse reply types: questions, agreements, supportive comments, thoughtful insights
- Keep replies natural and conversational (1-2 sentences max)
- Match the tone and style of the original post
- Consider the user's interests when relevant
- Ensure replies are engaging and encourage conversation
- Avoid generic or spammy responses

TONE OPTIONS:
- friendly: Warm, casual, approachable
- supportive: Encouraging, understanding, helpful  
- questioning: Curious, seeking clarification or more information
- agreeing: Showing agreement and shared perspective
- enthusiastic: Excited, positive, energetic
- thoughtful: Reflective, insightful, considerate

Return ONLY valid JSON array with this structure:
[
  {
    "id": "1",
    "text": "The actual reply text here",
    "tone": "friendly",
    "confidence": 0.85
  }
]

Requirements:
- Return ${maxReplies} replies maximum
- Confidence score (0.1-1.0) based on relevance and quality
- Mix of different tones
- Replies should be directly related to the post content
- Make them feel personal and authentic
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
                temperature: 0.7, // Slightly creative but focused
                max_tokens: 800,
            },
            {
                headers: requestHeaders,
            }
        );

        const content = completion.choices[0].message.content || "[]";

        const isValid = await broker.inference.processResponse(OG_PROVIDER,completion.id,content);

        let replies: SmartReply[] = [];

        try {
            replies = JSON.parse(content);

            // Validate and clean the response
            if (!Array.isArray(replies)) {
                throw new Error("Invalid response format");
            }

            // Ensure we have the correct number of replies and they're valid
            replies = replies.slice(0, maxReplies).map((reply, index) => ({
                id: reply.id || `reply-${index + 1}`,
                text: reply.text || "",
                tone: (['friendly', 'supportive', 'questioning', 'agreeing', 'enthusiastic', 'thoughtful'].includes(reply.tone)
                    ? reply.tone
                    : 'friendly') as SmartReply['tone'],
                confidence: Math.min(Math.max(reply.confidence || 0.5, 0.1), 1.0)
            })).filter(reply => reply.text.length > 0);

        } catch (parseError) {
            console.error("Failed to parse AI response:", parseError);
            // Fallback to generating basic replies
            replies = generateFallbackReplies(postContent, maxReplies);
        }

        return NextResponse.json({
            success: true,
            replies,
            valid: isValid,
        });

    } catch (error: any) {
        console.error("Smart replies generation error:", error);

        // Fallback for when AI service is unavailable
        const { postContent, maxReplies = 3 } = await req.json().catch(() => ({ postContent: "", maxReplies: 3 }));
        const fallbackReplies = generateFallbackReplies(postContent, maxReplies);

        return NextResponse.json({
            success: true,
            replies: fallbackReplies,
            fallback: true,
            error: error.message
        });
    }
}

// Enhanced fallback reply generator
function generateFallbackReplies(postContent: string, maxReplies: number = 3): SmartReply[] {
    const contentLower = postContent.toLowerCase();
    const replies: SmartReply[] = [];

    // Question detection
    if (contentLower.includes('?')) {
        replies.push({
            id: '1',
            text: "That's an interesting question! I'd love to hear more about your thoughts on this.",
            tone: 'questioning',
            confidence: 0.8
        });
    }

    // Positive sentiment
    if (contentLower.includes('amazing') || contentLower.includes('great') || contentLower.includes('love') || contentLower.includes('awesome')) {
        replies.push({
            id: '2',
            text: "This is fantastic! Thanks for sharing such positive energy.",
            tone: 'enthusiastic',
            confidence: 0.7
        });
    }

    // Problem/challenge detection
    if (contentLower.includes('problem') || contentLower.includes('issue') || contentLower.includes('challenge') || contentLower.includes('struggle')) {
        replies.push({
            id: '3',
            text: "I understand where you're coming from. Have you found any approaches that help with this?",
            tone: 'supportive',
            confidence: 0.6
        });
    }

    // Tech-related content
    if (contentLower.includes('blockchain') || contentLower.includes('web3') || contentLower.includes('ai') || contentLower.includes('technology')) {
        replies.push({
            id: '4',
            text: "Interesting perspective on this technology! How do you see this evolving in the future?",
            tone: 'thoughtful',
            confidence: 0.75
        });
    }

    // Learning/education content
    if (contentLower.includes('learn') || contentLower.includes('study') || contentLower.includes('education') || contentLower.includes('knowledge')) {
        replies.push({
            id: '5',
            text: "Great insights! I always appreciate learning from different perspectives on this topic.",
            tone: 'agreeing',
            confidence: 0.65
        });
    }

    // Default friendly replies
    if (replies.length < maxReplies) {
        replies.push({
            id: '6',
            text: "Thanks for sharing this! It really got me thinking about the topic.",
            tone: 'friendly',
            confidence: 0.5
        });
    }

    if (replies.length < maxReplies) {
        replies.push({
            id: '7',
            text: "I appreciate you posting this. It's given me a new perspective to consider.",
            tone: 'thoughtful',
            confidence: 0.5
        });
    }

    // Sort by confidence and return requested number
    return replies
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxReplies);
}