FROM docker.io/library/nginx:1.27-alpine AS base

RUN addgroup -g 10001 appgroup && \
    adduser -u 10001 -G appgroup -D -H appuser

RUN mkdir -p /var/cache/nginx /var/run /var/log/nginx && \
    chown -R 10001:10001 /var/cache/nginx /var/run /var/log/nginx

COPY <<'EOF' /etc/nginx/nginx.conf
worker_processes auto;
pid /var/run/nginx.pid;
events { worker_connections 1024; }
http {
    server {
        listen 80;
        location / {
            return 200 '{"status":"ok"}';
            default_type application/json;
        }
        location /healthz {
            return 200 'healthy';
            default_type text/plain;
        }
    }
}
EOF

RUN chown -R 10001:10001 /etc/nginx

USER 10001

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]