import { NextRequest } from "next/server";
import { handleMcpPost, methodNotAllowed } from "@/lib/mcp/http";

// Model Context Protocol endpoint for agents (Streamable HTTP, stateless).
// Auth: the personal "yolo_..." token from Settings -> Credentials.
// See docs/MCP.md for client setup and the tool contract.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  return handleMcpPost(req);
}

export async function GET() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
