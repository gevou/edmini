#!/bin/bash
echo "🚀 Ed Mini Hackathon Startup"
echo "============================"

# Start OpenClaw Gateway
echo "Starting OpenClaw Gateway..."
openclaw &
OPENCLAW_PID=$!
echo "OpenClaw started (PID: $OPENCLAW_PID) at http://localhost:18789"

# Wait for Gateway to be ready
sleep 5

# Start Cloudflare Tunnel
echo "Starting Cloudflare Tunnel..."
cloudflared tunnel run edmini &>/tmp/edmini-tunnel.log &
TUNNEL_PID=$!
sleep 3

echo ""
echo "✅ Ready!"
echo "OpenClaw Dashboard: http://localhost:18789"
echo "OpenClaw Public:    https://oc-8f7d.labkit.ai"
echo "Ed Mini Voice: https://edmini-voulgaris.vercel.app"
echo "Ed Mini Dashboard: https://edmini-voulgaris.vercel.app/dashboard"
echo ""
echo "To stop: kill $OPENCLAW_PID $TUNNEL_PID"
