# Build context is this directory (tools/stored). Pure-Go SQLite driver, so a
# static CGO-free binary is enough.
FROM golang:1.21-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# -p=1 and a tighter GOGC keep the compiler's peak RSS down. modernc.org/libc
# (pulled in by the pure-Go SQLite driver) is a single enormous generated
# package, and compose builds every service at once — on a small VPS the
# default parallelism runs the box out of memory and the OOM killer takes the
# build with it, which Dokploy then reports as a cancelled deployment.
RUN GOFLAGS=-p=1 GOGC=50 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o /out/stored .

# Root (not :nonroot): writes /vault/.data (SQLite) on the shared root-owned volume.
FROM gcr.io/distroless/static-debian12
COPY --from=build /out/stored /stored
# STORED_DB lives under the shared vault volume so the SQLite database persists.
ENV STORED_ADDR=0.0.0.0:4323 VAULT_ROOT=/vault STORED_DB=/vault/.data/notes.db
EXPOSE 4323
ENTRYPOINT ["/stored"]
