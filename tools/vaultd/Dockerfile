# Build context is this directory (tools/vaultd). vaultd is stdlib-only, so a
# static CGO-free binary drops into distroless/static with no runtime deps.
FROM golang:1.21-alpine AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/vaultd .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/vaultd /vaultd
# VAULTD_ADDR must bind 0.0.0.0 in a container so sibling services can reach it.
ENV VAULTD_ADDR=0.0.0.0:4321 VAULT_ROOT=/vault
EXPOSE 4321
ENTRYPOINT ["/vaultd"]
