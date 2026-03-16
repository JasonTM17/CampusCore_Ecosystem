# CampusCore Load Testing Setup

This directory contains the load testing infrastructure for the CampusCore application using k6.

## Prerequisites

- [k6](https://k6.io/docs/getting-started/installation/) installed on your system
- Docker and Docker Compose (for running the application stack)
- Node.js (optional, for running seed data)

## Quick Start

### 1. Start the Application Stack

```bash
# Start all services
docker compose up -d

# Wait for services to be healthy
docker compose ps
```

### 2. Run Load Tests

#### Using PowerShell (Windows)
```powershell
# Run smoke test
.\load-tests\scripts\run-tests.ps1 smoke

# Run load test
.\load-tests\scripts\run-tests.ps1 load

# Run stress test
.\load-tests\scripts\run-tests.ps1 stress
```

#### Using Bash (Linux/Mac)
```bash
# Run smoke test
./load-tests/scripts/run-tests.sh smoke

# Run load test
./load-tests/scripts/run-tests.sh load

# Run stress test
./load-tests/scripts/run-tests.sh stress
```

## Test Profiles

| Profile | Description | VUs | Duration | Use Case |
|---------|-------------|-----|----------|----------|
| smoke | Basic functionality check | 1 | 30s | Validate system works |
| load | Baseline performance | 5-10 | 2min | Normal traffic simulation |
| stress | Breaking point identification | 10-50 | 4min | Find capacity limits |
| spike | Sudden traffic burst | 5-50 | 1min | Handle traffic spikes |
| soak | Extended duration | 10 | 5min | Memory leak detection |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | http://localhost | Application base URL |
| `API_BASE_URL` | http://localhost/api/v1 | API base URL |
| `K6_USERS_EMAIL` | student1@campuscore.edu | Test student email |
| `K6_USERS_PASSWORD` | (set in .env) | Test student password |
| `K6_ADMIN_EMAIL` | admin@campuscore.edu | Test admin email |
| `K6_ADMIN_PASSWORD` | (set in .env) | Test admin password |

## Project Structure

```
load-tests/
├── configs/              # Test configurations
│   └── base-config.js
├── helpers/              # Utility functions
│   ├── auth.js          # Authentication helpers
│   ├── config.js        # Configuration
│   └── requests.js      # HTTP request wrappers
├── scenarios/           # Business flow scenarios
│   ├── admin-portal-scenarios.js
│   ├── auth-scenarios.js
│   ├── common.js
│   └── student-portal-scenarios.js
├── scripts/             # Run scripts
│   ├── run-tests.ps1   # PowerShell script
│   └── run-tests.sh    # Bash script
├── src/                # Main test entry points
│   └── main.js
├── reports/            # Test output (generated)
│   └── *.json
└── README.md           # This file
```

## Test Scenarios

### Authentication Flow
- Login
- Get current user
- Logout

### Student Portal
- Get available sections
- Get my enrollments
- Get my grades
- Get my schedule
- Get my transcript
- Get my invoices

### Admin Portal
- Get analytics overview
- Get all sections
- Get all enrollments
- Get all students
- Get semesters
- Get announcements

## Thresholds

The tests use these default thresholds:

- **p95 latency**: < 500ms
- **p99 latency**: < 1000ms
- **Error rate**: < 1%
- **Throughput**: > 5 req/s (load), > 10 req/s (stress)

## Output

Test results are saved to JSON files in `load-tests/reports/`:

- `smoke-results.json`
- `load-results.json`
- `stress-results.json`
- `spike-results.json`
- `soak-results.json`

## Integration with Monitoring

### Prometheus + Grafana (Optional)

To enable metrics export:

```powershell
# Run with Prometheus output
k6 run load-tests\src\main.js `
    --out prometheus `
    --prometheus-labels "env=local,app=campuscore"
```

## Troubleshooting

### Test fails with "connection refused"
- Ensure Docker containers are running: `docker compose ps`
- Check if backend is healthy: `curl http://localhost/api/v1/health`

### Authentication failures
- Check test credentials in `.env` file
- Ensure users exist in database

### High error rates
- Check application logs: `docker logs campuscore-api`
- Check database connectivity
- Review k6 output for specific error messages

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: Load Tests

on:
  schedule:
    - cron: '0 2 * * *'  # Run daily at 2 AM
  workflow_dispatch:

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: grafana/k6-action@v0.2
        with:
          filename: load-tests/src/main.js
          flags: --duration 2m --vus 10
        env:
          API_BASE_URL: ${{ secrets.API_BASE_URL }}
```

## License

MIT License
