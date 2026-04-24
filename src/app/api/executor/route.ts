import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { message, threadId } = await request.json();

  const executorUrl = process.env.OPENCLAW_URL || 'http://localhost:18789';

  try {
    const response = await fetch(`${executorUrl}/api/sessions/main/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.OPENCLAW_TOKEN ? { 'Authorization': `Bearer ${process.env.OPENCLAW_TOKEN}` } : {})
      },
      body: JSON.stringify({ content: message }),
    });

    const data = await response.json();
    return NextResponse.json({
      threadId,
      response: data.content || data.message || JSON.stringify(data),
      source: 'openclaw'
    });
  } catch (error) {
    return NextResponse.json({
      threadId,
      response: `[OpenClaw unreachable] Received: "${message}"`,
      source: 'mock'
    });
  }
}
