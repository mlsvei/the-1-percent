FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
ARG VITE_API_BASE=https://api.the1percent.app/api
ENV VITE_API_BASE=${VITE_API_BASE}
COPY tsconfig.json ./
COPY tsconfig.app.json ./
COPY tsconfig.node.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY <<'EOF_NGINX' /etc/nginx/conf.d/default.conf
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri /index.html;
  }
}
EOF_NGINX
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
