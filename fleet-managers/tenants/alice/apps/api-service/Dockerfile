FROM 195748744911.dkr.ecr.eu-west-1.amazonaws.com/ssp-portal:830ac14ad9aaa0b970dda2932e8083f5683afaa2 AS base

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:da485c12f7b2f0a0dae9e6e1e9e1bcbaf8f42ee82b2c72ef4d8c72c3c3b1f5a0

COPY --from=base /app /app

WORKDIR /app

USER 10001

EXPOSE 3000

CMD ["server.js"]