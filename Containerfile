# Belegt – ein Image für Server und Worker. Der Server wendet beim Start die Migrationen an und liefert die gebaute
# Oberfläche aus; der Worker (bun server/worker.ts) ruft Postfächer ab, stellt Webhooks zu und liest Text.
FROM docker.io/oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY bun.lock package.json ./
COPY project.inlang project.inlang
COPY messages messages
RUN bun install --frozen-lockfile
COPY . .
# Danach nur die Laufzeitabhängigkeiten; ohne Skripte, denn postinstall (Paraglide) braucht Entwicklungswerkzeuge
RUN bun run build \
 && rm -rf node_modules \
 && bun install --frozen-lockfile --production --ignore-scripts

FROM docker.io/oven/bun:1.4.4-slim
# tesseract-ocr mit Deutsch und Englisch: Texterkennung für Scans; poppler-utils: pdftoppm rastert gescannte PDFs.
# Beides läuft als eigener Prozess mit Zeitlimit (server/inhalt/ocr.ts).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-deu tesseract-ocr-eng poppler-utils tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    DOCUMENTS_DIR=/var/lib/belegt/dokumente \
    TZ=Europe/Berlin
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /var/lib/belegt/dokumente && chown -R bun:bun /var/lib/belegt
USER bun
VOLUME /var/lib/belegt
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "server/index.ts"]
