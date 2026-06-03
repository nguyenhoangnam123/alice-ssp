FROM docker.io/library/nginx:1.27-alpine AS base

RUN addgroup -g 10001 appgroup && \
    adduser -u 10001 -G appgroup -D -H appuser && \
    chown -R appuser:appgroup /usr/share/nginx/html && \
    chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown appuser:appgroup /var/run/nginx.pid

COPY <<'EOF' /etc/nginx/conf.d/default.conf
server {
    listen 8080;
    server_name _;
    location / {
        root   /usr/share/nginx/html;
        index  index.html index.htm;
    }
    location /healthz {
        return 200 'ok';
        add_header Content-Type text/plain;
    }
}
EOF

USER 10001
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]