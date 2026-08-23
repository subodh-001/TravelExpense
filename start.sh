#!/usr/bin/env bash
# ==============================================================================
# 🚀 Monthly Travel Expense Log & Receipt Vault — Control Engine
# ==============================================================================

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

ACTION="${1:-start}"

function stop_server() {
    PID_ON_3000=$(lsof -ti:3000 2>/dev/null)
    if [ -n "$PID_ON_3000" ]; then
        echo -e "${YELLOW}🛑 Stopping server running on port 3000 (PID: $PID_ON_3000)...${NC}"
        kill -9 $PID_ON_3000 2>/dev/null || true
        sleep 1
        echo -e "${GREEN}✓ Server stopped successfully.${NC}"
    else
        echo -e "${CYAN}ℹ️ Server is not running on port 3000.${NC}"
    fi
}

function start_server() {
    echo -e "${CYAN}==============================================================================${NC}"
    echo -e "  🚀 TravelExpense — Mobile Travel Log & Cloudinary Receipt Vault"
    echo -e "${CYAN}==============================================================================${NC}"

    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Error: Node.js is not installed!${NC}"
        exit 1
    fi

    if [ ! -d "$SCRIPT_DIR/backend/node_modules" ]; then
        echo -e "${YELLOW}📦 Installing backend dependencies...${NC}"
        cd "$SCRIPT_DIR/backend" && npm install && cd "$SCRIPT_DIR"
    fi

    stop_server > /dev/null 2>&1

    echo -e "${BLUE}==============================================================================${NC}"
    echo -e "${GREEN}🌐 Web Dashboard & App UI : ${CYAN}http://localhost:3000${NC}"
    echo -e "${GREEN}📊 Backend REST API Endpoint : ${CYAN}http://localhost:3000/api/expenses${NC}"
    echo -e "${GREEN}📸 Receipt Cloud Storage   : ${PURPLE}Cloudinary (vrxb6o67 / expense_receipts)${NC}"
    echo -e "${BLUE}==============================================================================${NC}"
    echo -e "${YELLOW}⚡ Starting Server... (Press Ctrl+C or run ./start.sh stop to stop)${NC}\n"

    exec node backend/server.js
}

function stop_expo() {
    PID_8081=$(lsof -ti:8081 2>/dev/null)
    if [ -n "$PID_8081" ]; then
        kill -9 $PID_8081 2>/dev/null || true
    fi
    PID_8082=$(lsof -ti:8082 2>/dev/null)
    if [ -n "$PID_8082" ]; then
        kill -9 $PID_8082 2>/dev/null || true
    fi
}

function start_expo() {
    echo -e "${CYAN}==============================================================================${NC}"
    echo -e "  📱 Starting Expo Mobile Server for Expo Go (Instant Phone Testing)"
    echo -e "${CYAN}==============================================================================${NC}"

    stop_expo > /dev/null 2>&1

    if [ ! -d "$SCRIPT_DIR/mobile-expo/node_modules" ]; then
        echo -e "${YELLOW}📦 Installing Expo app dependencies...${NC}"
        cd "$SCRIPT_DIR/mobile-expo" && npm install && cd "$SCRIPT_DIR"
    fi

    echo -e "${GREEN}📲 Open the Expo Go app on your phone and scan the QR code below!${NC}"
    echo -e "${YELLOW}🌐 Tunnel mode active: Works across mobile data & any Wi-Fi network.${NC}"
    cd "$SCRIPT_DIR/mobile-expo" && (npx expo start --tunnel --clear || npx expo start --lan --clear)
}

function start_all() {
    echo -e "${CYAN}==============================================================================${NC}"
    echo -e "  🚀 Launching Backend REST API + Web Dashboard + Expo Mobile Server"
    echo -e "${CYAN}==============================================================================${NC}"

    stop_server > /dev/null 2>&1

    # Cleanup handler for Ctrl+C
    trap 'echo -e "\n${YELLOW}🛑 Shutting down server...${NC}"; stop_server > /dev/null 2>&1; exit 0' INT TERM EXIT

    # Start backend in background
    node "$SCRIPT_DIR/backend/server.js" &
    BACKEND_PID=$!

    echo -e "${GREEN}🟢 Backend REST API & Web Dashboard started (PID: $BACKEND_PID) on http://localhost:3000${NC}"
    sleep 2

    # Start Expo
    start_expo
}

function check_status() {
    PID_ON_3000=$(lsof -ti:3000 2>/dev/null)
    if [ -n "$PID_ON_3000" ]; then
        echo -e "${GREEN}🟢 Server is RUNNING on port 3000 (PID: $PID_ON_3000)${NC}"
        echo -e "🌐 Web Client: http://localhost:3000"
    else
        echo -e "${RED}🔴 Server is STOPPED.${NC}"
    fi
}

case "$ACTION" in
    stop)
        stop_server
        ;;
    status)
        check_status
        ;;
    restart)
        stop_server
        start_all
        ;;
    backend|web)
        start_server
        ;;
    expo|mobile)
        start_expo
        ;;
    start|all|*)
        start_all
        ;;
esac
