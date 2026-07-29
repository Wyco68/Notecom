# Build context is this directory (tools/indexd). modernc.org/sqlite is pure Go,
# so CGO_ENABLED=0 still yields a static binary — no C toolchain, no libc needed.
FROM golang:1.21-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Same memory guard as tools/stored: modernc.org/libc is one huge generated
# package, and both services compile it simultaneously under `compose --build`.
RUN GOFLAGS=-p=1 GOGC=50 CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o /out/indexd .

# Root (not :nonroot): writes /vault/.index on the shared root-owned volume.
FROM gcr.io/distroless/static-debian12
COPY --from=build /out/indexd /indexd
ENV INDEXD_ADDR=0.0.0.0:4322 VAULT_ROOT=/vault
EXPOSE 4322
ENTRYPOINT ["/indexd"]
