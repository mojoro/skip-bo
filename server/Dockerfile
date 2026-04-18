# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY src/lib/game ./src/lib/game
COPY server ./server
RUN cd server && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
RUN npm install -g pm2@5
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/pm2.config.cjs ./pm2.config.cjs
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787
CMD ["pm2-runtime", "pm2.config.cjs"]
