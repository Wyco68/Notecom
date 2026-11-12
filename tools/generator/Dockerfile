# The generator (tools/generator): one static Go binary plus the four template
# docs its prompts are built from. Build from the repository root, so the
# docs can be copied in:
#
#   docker build -f tools/generator/Dockerfile -t notecom-generator .
#
# Dockerfile.dockerignore (next to this file) keeps the context to exactly
# that. Built in CI and pushed to GHCR; the VPS only pulls it (a 1 GB box
# shouldn't compile).

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY tools/generator/go.mod tools/generator/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY tools/generator/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/generator ./cmd/generator

# No shell, no package manager, runs as an unprivileged user; CA certificates
# for the AI services and Supabase are included.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/generator /generator
COPY docs/teaching-guidelines.md docs/html-output-contract.md docs/lesson-template.md docs/quiz-guidelines.md /app/docs/
ENV DOCS_DIR=/app/docs HEALTH_ADDR=:8080
USER nonroot:nonroot
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 CMD ["/generator", "-healthcheck"]
ENTRYPOINT ["/generator"]
