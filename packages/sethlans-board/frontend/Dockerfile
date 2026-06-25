# syntax=docker/dockerfile:1
# --- Stage 1: build dei file statici con Vite ---
FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
# Disabilita update-notifier/fund/audit: girano dentro l'exit handler di npm e
# in Docker provocano il crash "Exit handler never called!" (npm/cli#7657) che
# fa fallire l'install lasciando node_modules incompleto (-> "vite: not found").
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
# Registry npm pubblico di default. Per un registry privato/proxy puoi passare un
# ~/.npmrc come BuildKit secret (id=npmrc): è OPZIONALE (required=false) e il token
# NON finisce nell'immagine. Es.: docker build --secret id=npmrc,src=$HOME/.npmrc ...
# `--include=dev` forza l'installazione delle devDependencies (vite, plugin-react):
# servono per `vite build` e in CI verrebbero altrimenti omesse.
RUN --mount=type=secret,id=npmrc,required=false,target=/root/.npmrc npm ci --include=dev

COPY . .

# URL del backend iniettato a build time (default: localhost dal browser dell'host).
# Sovrascrivibile a runtime anche dal campo in alto nell'interfaccia.
ARG VITE_API_URL=http://localhost:9955
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- Stage 2: servire la build con Nginx ---
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
