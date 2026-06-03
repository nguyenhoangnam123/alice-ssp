FROM docker.io/library/nginx:1.27.3-alpine AS base

RUN addgroup -S appgroup && adduser -S appuser -G appgroup -u 10001

RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx && \
    chown -R 10001:appgroup /var/cache/nginx /var/run /var/log/nginx

COPY nginx.conf /etc/nginx/nginx.conf
COPY public/ /usr/share/nginx/html/

RUN chown -R 10001:appgroup /usr/share/nginx/html

USER 10001

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]