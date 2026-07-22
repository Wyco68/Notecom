# Build context is this directory (tools/stored). Pure-Go SQLite driver, so a
# static CGO-free binary is enough.
FROM golang:1.21-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/stored .

# Root (not :nonroot): writes /vault/.data (SQLite) on the shared root-owned volume.
FROM gcr.io/distroless/static-debian12
COPY --from=build /out/stored /stored
# STORED_DB lives under the shared vault volume so the SQLite database persists.
ENV STORED_ADDR=0.0.0.0:4323 VAULT_ROOT=/vault STORED_DB=/vault/.data/notes.db
EXPOSE 4323
ENTRYPOINT ["/stored"]
