# Build context is this directory (tools/indexd). modernc.org/sqlite is pure Go,
# so CGO_ENABLED=0 still yields a static binary — no C toolchain, no libc needed.
FROM golang:1.21-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/indexd .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/indexd /indexd
# OLLAMA_URL points at the optional ollama service; without it indexd degrades
# to FTS5 keyword search automatically (no vector embeddings).
ENV INDEXD_ADDR=0.0.0.0:4322 VAULT_ROOT=/vault
EXPOSE 4322
ENTRYPOINT ["/indexd"]
