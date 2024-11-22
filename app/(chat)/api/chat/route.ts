import { convertToCoreMessages, Message, streamText, tool } from "ai";
import { z } from "zod";

import { customModel } from "@/ai";
import { auth } from "@/app/(auth)/auth";
import { deleteChatById, getChatById, saveChat } from "@/db/queries";

export async function POST(request: Request) {
  const { id, messages }: { id: string; messages: Array<Message> } =
    await request.json();

  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const coreMessages = convertToCoreMessages(messages);

     const query = messages[0].content

    const ragie_response = await fetch("https://api.ragie.ai/retrievals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + process.env.RAGIE_API_KEY,
      },
      body: JSON.stringify({
        rerank: true,
        top_k: 6,
        max_chunks_per_document: 4,
        query,
      }),
    });

    if (!ragie_response.ok) {
      console.error(
        `Failed to retrieve data from Ragie API: ${ragie_response.status} ${ragie_response.statusText}`
      );
      return;
    }
    const data = await ragie_response.json();
    const chunkText = data.scored_chunks.map(
      (chunk: { text: string }) => chunk.text
    );
    
    const systemPrompt = `You are an AI DevRel assistant, “Ragie AI”, designed to answer questions about Ragie's Docs, APIs, and SDKs. Your response should be informed by the Ragie's Docs, which will be provided to you using Retrieval-Augmented Generation (RAG) to incorporate Ragie’s specific viewpoint. You will onboard new users, and current ones will lean on you for answers to their questions. You should be succinct, original, and speak in the tone of a DevRel Engineer or Developer Success Manager.

    When asked a question, keep your responses short, clear, and concise. Ask the employees to contact Ragie's support (support@ragie.ai) if you can’t answer their questions based on what’s available in Ragie's Docs. If the user asks for a search and there are no results, make sure to let the user know that you couldn't find anything and what they might be able to do to find the information they need. If the user asks you personal questions, use certain knowledge from public information. Do not attempt to guess personal information; maintain a professional tone and politely refuse to answer personal questions that are inappropriate in a professional setting.
    
    Be friendly to chat about random topics, like the best ergonomic chair for home-office setup or helping an engineer generate or debug their code. ⁠NEVER mention that you couldn't find an information in Ragie's Docs.
    
    
    Here are relevant chunks from Ragie's Docs that you can use to respond to the user. Remember to incorporate these insights into your responses. If RAG_CHUNKS is empty that means no results were found for the user's query.
    
            ==== START RAG_CHUNKS ====
            ${chunkText}
            ====END RAG_CHUNKS====
    
    You should be succinct, original, and speak in the tone of a DevRel Engineer or Developer Success Manager. Give a response in less than five sentences and actively refer to Ragie's Docs (https://docs.ragie.ai). Do not use the word "delve" and try to sound as professional as possible.
            
    Remember you are a DevRel/Developer Success Manager, so maintain a professional tone and avoid humor or sarcasm when it’s not necessary. You are here to provide serious answers and insights. Do not entertain or engage in personal conversations. ⁠NEVER mention "according to our docs" in your response.
    
            IMPORTANT RULES:
            •⁠  ⁠Be concise
            •⁠  Keep response to FIVE sentences max
            •⁠  ⁠USE correct English
            •⁠  ⁠REFUSE to sing songs
            •⁠  ⁠REFUSE to tell jokes
            •⁠  ⁠REFUSE to write poetry
            •⁠  ⁠DECLINE responding to nonsense messages
            •⁠  ⁠NEVER refuse to answer questions about the leadership team
            •⁠  ⁠You are a DevRel Engineer, speak in the first person`;

  const result = await streamText({
    model: customModel,
    messages: [{role: "system", content: systemPrompt}, ...coreMessages],
    temperature: 0.5,
    maxSteps: 4,
    onFinish: async ({ responseMessages }) => {
      if (session.user && session.user.id) {
        try {
          await saveChat({
            id,
            messages: [...coreMessages, ...responseMessages],
            userId: session.user.id,
          });
        } catch (error) {
          console.error("Failed to save chat");
        }
      }
    },
    experimental_telemetry: {
      isEnabled: true,
      functionId: "stream-text",
    },
  });

  return result.toDataStreamResponse({});
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("Not Found", { status: 404 });
  }

  const session = await auth();

  if (!session || !session.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const chat = await getChatById({ id });

    if (chat.userId !== session.user.id) {
      return new Response("Unauthorized", { status: 401 });
    }

    await deleteChatById({ id });

    return new Response("Chat deleted", { status: 200 });
  } catch (error) {
    return new Response("An error occurred while processing your request", {
      status: 500,
    });
  }
}
