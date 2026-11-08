# Build context: the platform/ folder (needs ../shared)
FROM node:24-alpine AS build
WORKDIR /src
COPY shared ./shared
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend ./frontend
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN cd frontend && npx vite build

FROM nginx:1.29-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/frontend/dist /usr/share/nginx/html
EXPOSE 80
