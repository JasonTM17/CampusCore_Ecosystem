#!/bin/bash

# CampusCore Load Testing Scripts
# Run from project root: ./load-tests/scripts/run-smoke.sh

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
BASE_URL="${BASE_URL:-http://localhost}"
API_BASE_URL="${API_BASE_URL:-http://localhost/api/v1}"

echo -e "${GREEN}=== CampusCore Load Testing ===${NC}"
echo "Base URL: $BASE_URL"
echo "API URL: $API_BASE_URL"
echo ""

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}k6 is not installed. Please install from: https://k6.io/docs/getting-started/installation/${NC}"
    exit 1
fi

# Smoke Test
run_smoke() {
    echo -e "${YELLOW}Running Smoke Test...${NC}"
    k6 run \
        --out json=load-tests/reports/smoke-results.json \
        --duration 30s \
        --vus 1 \
        load-tests/src/main.js \
        -e BASE_URL="$BASE_URL" \
        -e API_BASE_URL="$API_BASE_URL" \
        -e SCENARIO=smoke
}

# Load Test
run_load() {
    echo -e "${YELLOW}Running Load Test...${NC}"
    k6 run \
        --out json=load-tests/reports/load-results.json \
        --duration 2m \
        --vus 10 \
        load-tests/src/main.js \
        -e BASE_URL="$BASE_URL" \
        -e API_BASE_URL="$API_BASE_URL" \
        -e SCENARIO=load
}

# Stress Test
run_stress() {
    echo -e "${YELLOW}Running Stress Test...${NC}"
    k6 run \
        --out json=load-tests/reports/stress-results.json \
        --duration 4m \
        --vus 50 \
        load-tests/src/main.js \
        -e BASE_URL="$BASE_URL" \
        -e API_BASE_URL="$API_BASE_URL" \
        -e SCENARIO=stress
}

# Spike Test
run_spike() {
    echo -e "${YELLOW}Running Spike Test...${NC}"
    k6 run \
        --out json=load-tests/reports/spike-results.json \
        --duration 1m \
        --vus 50 \
        load-tests/src/main.js \
        -e BASE_URL="$BASE_URL" \
        -e API_BASE_URL="$API_BASE_URL" \
        -e SCENARIO=spike
}

# Soak Test
run_soak() {
    echo -e "${YELLOW}Running Soak Test...${NC}"
    k6 run \
        --out json=load-tests/reports/soak-results.json \
        --duration 5m \
        --vus 10 \
        load-tests/src/main.js \
        -e BASE_URL="$BASE_URL" \
        -e API_BASE_URL="$API_BASE_URL" \
        -e SCENARIO=soak
}

# Create reports directory if not exists
mkdir -p load-tests/reports

# Parse command
case "${1:-smoke}" in
    smoke)
        run_smoke
        ;;
    load)
        run_load
        ;;
    stress)
        run_stress
        ;;
    spike)
        run_spike
        ;;
    soak)
        run_soak
        ;;
    all)
        run_smoke
        run_load
        ;;
    *)
        echo "Usage: $0 {smoke|load|stress|spike|soak|all}"
        exit 1
        ;;
esac
