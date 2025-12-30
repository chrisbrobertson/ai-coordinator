# Resource Booking App - Docker Container Specification

---
specmas: v3
kind: FeatureSpec
id: feat-resource-booking-docker
name: Resource Booking Docker Container
version: 1.0.0
owners:
  - name: Chris
complexity: EASY
maturity: 3
tags: [docker, container, deployment, ai-evaluation]
related_specs: [feat-resource-booking, feat-resource-booking-testing]
---

## Overview

### Problem Statement
The Resource Booking App needs a containerized deployment option for consistent environments across development, testing, and production. Docker provides isolation, reproducibility, and easy distribution.

### Scope
**In Scope:**
- Multi-stage Dockerfile for optimized builds
- Docker Compose for local development
- Production-ready nginx configuration
- Health check endpoint
- Container configuration documentation

**Out of Scope:**
- Kubernetes deployment manifests
- CI/CD pipeline configuration
- Container registry setup
- SSL/TLS termination (handled by reverse proxy in production)
- Multi-container orchestration beyond nginx

### Success Metrics
- Container builds in < 2 minutes
- Container image size < 50MB (production)
- Container starts and serves traffic in < 5 seconds
- Health check passes within 10 seconds of container start

---

## Functional Requirements

### FR-1: Multi-Stage Dockerfile
A Dockerfile using multi-stage builds to optimize the final image size.

**Build Stages:**

| Stage | Base Image | Purpose |
|-------|------------|---------|
| builder | node:20-alpine | Install deps, run build |
| production | nginx:alpine | Serve static files |

**Builder Stage Requirements:**
- Use Node.js 20 Alpine for smaller size
- Copy package.json and package-lock.json first (layer caching)
- Run `npm ci` (not `npm install`) for reproducible builds
- Run `npm run build` to generate production assets
- Do NOT include dev dependencies in final output

**Production Stage Requirements:**
- Use nginx:alpine for minimal footprint
- Copy only built assets from builder stage
- Copy custom nginx configuration
- Expose port 80
- Set appropriate file permissions
- Run as non-root user

**Validation Criteria:**
- Build completes without errors
- Final image contains only production assets
- No node_modules in final image
- No source files (.ts, .tsx) in final image
- Image size < 50MB

### FR-2: Nginx Configuration
Custom nginx configuration optimized for single-page application serving.

**Configuration Requirements:**

```nginx
# nginx.conf requirements:

# 1. Serve static files from /usr/share/nginx/html
# 2. SPA routing: return index.html for all non-file routes
# 3. Gzip compression enabled for text assets
# 4. Cache headers for static assets
# 5. Security headers (X-Frame-Options, X-Content-Type-Options)
# 6. Health check endpoint at /health
```

**SPA Routing Logic:**
```
Request: /                    → serve index.html
Request: /booking/123         → serve index.html (SPA route)
Request: /assets/main.js      → serve actual file
Request: /assets/style.css    → serve actual file
Request: /favicon.ico         → serve actual file
Request: /nonexistent.js      → 404 error
```

**Cache Policy:**
| Asset Type | Cache Duration | Cache-Control Header |
|------------|----------------|---------------------|
| HTML files | No cache | `no-cache, no-store, must-revalidate` |
| JS/CSS with hash | 1 year | `public, max-age=31536000, immutable` |
| Images/fonts | 1 month | `public, max-age=2592000` |
| favicon.ico | 1 week | `public, max-age=604800` |

**Validation Criteria:**
- SPA routes return index.html with 200 status
- Static assets return correct content
- Missing files return 404
- Correct cache headers on all responses
- Gzip encoding on text responses

### FR-3: Health Check Endpoint
A dedicated health check endpoint for container orchestration.

**Endpoint:** `GET /health`

**Response (healthy):**
```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

**Response Codes:**
- `200 OK` - Container is healthy and serving requests
- `503 Service Unavailable` - Container is starting or unhealthy

**Implementation Options:**
1. Static file served by nginx (`/usr/share/nginx/html/health.json`)
2. Nginx location block with return directive
3. Lua script in nginx (overkill for this use case)

**Docker HEALTHCHECK:**
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1
```

**Validation Criteria:**
- `/health` returns 200 within 10 seconds of container start
- Health check runs every 30 seconds
- Container marked unhealthy after 3 failed checks
- Health endpoint doesn't require authentication

### FR-4: Docker Compose Configuration
Docker Compose file for local development and testing.

**Services:**

```yaml
# docker-compose.yml structure

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**Port Mapping:**
- Host port 3000 → Container port 80
- Allows local access at http://localhost:3000

**Named Configurations:**
```yaml
# docker-compose.yml should support:
docker compose up          # Start in foreground
docker compose up -d       # Start in background
docker compose down        # Stop and remove
docker compose build       # Rebuild image
docker compose logs -f     # Follow logs
```

**Validation Criteria:**
- `docker compose up` starts the app successfully
- App accessible at http://localhost:3000
- `docker compose down` cleans up all resources
- Rebuild works after code changes

### FR-5: Development vs Production Builds
Support for different build configurations.

**Development Build:**
- Includes source maps
- No minification
- Faster build time
- Larger output size (acceptable)

**Production Build:**
- Minified and optimized
- No source maps
- Tree-shaken dependencies
- Smallest possible size

**Build Arguments:**
```dockerfile
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
```

**Docker Compose Override:**
```yaml
# docker-compose.dev.yml
services:
  app:
    build:
      args:
        NODE_ENV: development
```

**Usage:**
```bash
# Production build (default)
docker compose build

# Development build
docker compose -f docker-compose.yml -f docker-compose.dev.yml build
```

**Validation Criteria:**
- Production build creates optimized, minified assets
- Development build includes source maps
- Build arg correctly switches behavior
- Both builds produce working containers

### FR-6: Container Security
Security hardening for the container.

**Security Requirements:**

1. **Non-Root User:**
   - Nginx runs as non-root user
   - Files owned by nginx user
   - No root processes in running container

2. **Read-Only Filesystem (where possible):**
   - Static assets mounted read-only
   - Only /var/cache/nginx and /var/run need write access

3. **Minimal Attack Surface:**
   - No shell in final image (optional, may break debugging)
   - No package manager in final image
   - No build tools in final image

4. **Security Headers in Nginx:**
   ```nginx
   add_header X-Frame-Options "SAMEORIGIN" always;
   add_header X-Content-Type-Options "nosniff" always;
   add_header X-XSS-Protection "1; mode=block" always;
   add_header Referrer-Policy "strict-origin-when-cross-origin" always;
   ```

**Validation Criteria:**
- `docker exec <container> whoami` returns non-root user
- Security headers present in all responses
- No unnecessary packages in final image
- Container runs with minimal capabilities

### FR-7: Build and Runtime Documentation
Documentation for building and running the container.

**Required in README (Docker section):**

```markdown
## Docker

### Building the Image

# Production build
docker build -t resource-booking:latest .

# Development build
docker build --build-arg NODE_ENV=development -t resource-booking:dev .

### Running the Container

# Run in foreground
docker run -p 3000:80 resource-booking:latest

# Run in background
docker run -d -p 3000:80 --name booking-app resource-booking:latest

# View logs
docker logs -f booking-app

# Stop and remove
docker stop booking-app && docker rm booking-app

### Using Docker Compose

# Start
docker compose up -d

# Stop
docker compose down

# Rebuild and start
docker compose up -d --build

### Health Check

# Check container health
docker inspect --format='{{.State.Health.Status}}' booking-app

# Manual health check
curl http://localhost:3000/health

### Troubleshooting

# Shell into running container (if shell available)
docker exec -it booking-app /bin/sh

# View nginx logs
docker logs booking-app

# Check nginx config syntax
docker exec booking-app nginx -t
```

**Validation Criteria:**
- All commands in documentation work as written
- No placeholders or TODOs
- Common troubleshooting scenarios covered

---

## Non-Functional Requirements

### Performance
- Image build time < 2 minutes (cached deps: < 30 seconds)
- Container startup time < 5 seconds
- First response after start < 1 second
- Memory usage < 50MB at idle

### Reliability & Scalability
- Container restarts cleanly after crash
- Health check detects nginx failures
- Multiple containers can run simultaneously (different ports)

### Observability
- Nginx access logs to stdout
- Nginx error logs to stderr
- Health check status visible via Docker

### Compliance & Privacy
- No secrets baked into image
- No sensitive data in build layers
- Build logs don't expose secrets

---

## Data Model

### Dockerfile Structure

```dockerfile
# Dockerfile

#==========================================
# Stage 1: Build
#==========================================
FROM node:20-alpine AS builder

# Build arguments
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# Set working directory
WORKDIR /app

# Copy package files for layer caching
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

#==========================================
# Stage 2: Production
#==========================================
FROM nginx:alpine AS production

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy health check file
COPY health.json /usr/share/nginx/html/health.json

# Set ownership and permissions
RUN chown -R nginx:nginx /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
```

### Nginx Configuration Template

```nginx
# nginx.conf

worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/json application/xml;

    server {
        listen 80;
        server_name localhost;
        root /usr/share/nginx/html;
        index index.html;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        # Health check endpoint
        location /health {
            access_log off;
            default_type application/json;
            return 200 '{"status":"healthy","timestamp":"$time_iso8601"}';
        }

        # Static assets with long cache
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 1y;
            add_header Cache-Control "public, max-age=31536000, immutable";
            try_files $uri =404;
        }

        # HTML files - no cache
        location ~* \.html$ {
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            try_files $uri =404;
        }

        # SPA routing - all other routes serve index.html
        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
```

---

## Interfaces & Contracts

### Build Interface

```bash
# Standard Docker build commands

# Build with default settings
docker build -t resource-booking:latest .

# Build with custom tag
docker build -t resource-booking:v1.0.0 .

# Build for development
docker build --build-arg NODE_ENV=development -t resource-booking:dev .

# Build with no cache (clean build)
docker build --no-cache -t resource-booking:latest .
```

### Runtime Interface

```bash
# Environment variables (if needed in future)
# Currently none required - static SPA

# Port mapping
-p <host_port>:80

# Named container
--name <container_name>

# Detached mode
-d

# Health check override (optional)
--health-cmd "curl -f http://localhost/health || exit 1"
--health-interval 30s
--health-timeout 5s
--health-retries 3
```

---

## Deterministic Tests

```json
{
  "id": "DT-DOCKER-001",
  "description": "Docker build completes successfully",
  "input": "docker build -t test-booking:latest .",
  "expected": "exit_code_0"
}
```

```json
{
  "id": "DT-DOCKER-002",
  "description": "Container starts and health check passes",
  "input": "docker run -d -p 3000:80 --name test test-booking:latest && sleep 15 && docker inspect --format='{{.State.Health.Status}}' test",
  "expected": "healthy"
}
```

```json
{
  "id": "DT-DOCKER-003",
  "description": "SPA routing returns index.html for unknown routes",
  "input": "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/some/spa/route",
  "expected": "200"
}
```

```json
{
  "id": "DT-DOCKER-004",
  "description": "Static assets have correct cache headers",
  "input": "curl -s -I http://localhost:3000/assets/index-abc123.js | grep -i cache-control",
  "expected": "contains_immutable"
}
```

```json
{
  "id": "DT-DOCKER-005",
  "description": "Final image size is under 50MB",
  "input": "docker images test-booking:latest --format '{{.Size}}'",
  "expected": "less_than_50MB"
}
```

```json
{
  "id": "DT-DOCKER-006",
  "description": "Container runs as non-root user",
  "input": "docker exec test whoami",
  "expected": "nginx"
}
```

---

## Acceptance Tests

### User Stories

**Story 1:** As a developer, I want to build a Docker image with one command, so that I can deploy the app consistently.

**Story 2:** As an operator, I want health checks to verify the container is serving traffic, so that orchestrators can manage container lifecycle.

**Story 3:** As a security engineer, I want the container to follow security best practices, so that we minimize attack surface.

### Acceptance Criteria

- [ ] Given I have Docker installed, When I run `docker build -t app .`, Then the image builds successfully
- [ ] Given the image is built, When I run `docker run -p 3000:80 app`, Then the app is accessible at localhost:3000
- [ ] Given the container is running, When I request `/health`, Then I receive a 200 response with JSON body
- [ ] Given the container is running, When I request `/some/random/path`, Then I receive index.html (SPA routing)
- [ ] Given the container is running, When I request `/assets/main.js`, Then I receive the JS file with cache headers
- [ ] Given I inspect the running container, When I check the user, Then it is NOT root
- [ ] Given I check the image size, When I run `docker images`, Then the size is under 50MB
- [ ] Given I have docker compose, When I run `docker compose up -d`, Then the app starts successfully

---

## Glossary & Definitions

- **Multi-stage build:** Dockerfile technique using multiple FROM statements to separate build and runtime environments
- **Alpine:** Minimal Linux distribution, often used as base image for small containers
- **SPA routing:** Serving index.html for all routes so client-side JavaScript can handle routing
- **Layer caching:** Docker optimization where unchanged layers are reused from cache
- **Health check:** Periodic command to verify container is functioning correctly

---

## Risks & Open Questions

### Risks
- **R-1:** Alpine-based Node.js may have compatibility issues with some npm packages
  - **Impact:** Low (most packages work fine)
  - **Mitigation:** Test build early, switch to slim-debian if needed

- **R-2:** nginx user permissions may cause issues on some host systems
  - **Impact:** Low
  - **Mitigation:** Document required host permissions

### Open Questions
None - spec is complete for testing purposes.

---

## AI Testing Notes ⚠️

### Trap 1: Layer Caching Order
**The Test:** Copy package*.json before source code for caching

**Common AI Mistakes:**
- Copying entire project first, then installing deps (breaks cache on every change)
- Not using `npm ci` (non-deterministic installs)
- Missing package-lock.json copy

**What to Check:** Make a source change, rebuild - do deps reinstall?

### Trap 2: SPA Routing vs Static Files
**The Test:** nginx must serve index.html for routes but 404 for missing files

**Common AI Mistakes:**
- `try_files $uri /index.html` without `$uri/` (breaks directory routes)
- Not distinguishing between routes and actual file requests
- Returning index.html for missing JS files (should 404)

**What to Check:** Request `/nonexistent.js` - should 404, not serve index.html.

### Trap 3: Cache Headers Logic
**The Test:** HTML = no cache, JS/CSS = long cache

**Common AI Mistakes:**
- Same cache policy for all files
- Cache headers not added to `add_header` block properly
- Missing `always` keyword (headers not sent on all response codes)

**What to Check:** Compare headers for `/index.html` vs `/assets/main.js`.

### Trap 4: Health Check Timing
**The Test:** `--start-period` must allow time for nginx to start

**Common AI Mistakes:**
- No start period (container marked unhealthy during startup)
- Start period too short
- Health check command wrong (curl vs wget, missing options)

**What to Check:** Watch container status immediately after start - does it briefly show "unhealthy"?

### Trap 5: Security Headers Location
**The Test:** Security headers should apply to all responses

**Common AI Mistakes:**
- Headers in server block but not inherited by location blocks
- Headers overwritten in location blocks
- Missing `always` (headers only sent on 2xx responses)

**What to Check:** Check security headers on 404 responses, not just 200s.

### Trap 6: Gzip MIME Types
**The Test:** Gzip should compress text-based assets

**Common AI Mistakes:**
- Missing `application/javascript` (only `text/javascript`)
- Missing JSON MIME type
- Gzip enabled but types not specified

**What to Check:** Request JS file with `Accept-Encoding: gzip` - check Content-Encoding header.

### Trap 7: Non-Root User
**The Test:** nginx process runs as non-root

**Common AI Mistakes:**
- Using `USER nginx` but file permissions prevent reading
- Master process runs as root, workers as nginx (acceptable but check!)
- Forgetting to chown copied files

**What to Check:** `docker exec <container> ps aux` - who owns the processes?

---

## File Checklist

Files that must be created:

```
├── Dockerfile                 # Multi-stage build definition
├── nginx.conf                 # Custom nginx configuration  
├── docker-compose.yml         # Standard compose file
├── docker-compose.dev.yml     # Development overrides (optional)
├── .dockerignore              # Exclude unnecessary files from build
└── health.json                # Static health check response (if not using nginx return)
```

**.dockerignore contents:**
```
node_modules
dist
.git
.gitignore
*.md
.env*
.vscode
coverage
tests
```

---

**Status:** 🟢 Complete - Level 3
**Agent Ready:** ✅ Yes
**Required Level:** 3 (EASY)
**Estimated Implementation Time:** 1-2 hours
