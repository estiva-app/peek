# Estiva Peek — production image.
#
# Unlike Estiva Ship, the build does **not** happen here. Peek's bundle is
# produced by `npx convex deploy --cmd 'npm run build'`, which pushes the Convex
# backend and injects the matching `VITE_CONVEX_URL` into the frontend in one
# step — so the two halves cannot drift. That needs `CONVEX_DEPLOY_KEY` and
# network access, neither of which belongs in a Dockerfile.
#
# So CI builds `dist/`, and this image is the delivery envelope for it. Building
# without a prior `convex deploy` produces a bundle pointed at nothing.

FROM nginx:1.27-alpine AS runtime

# Served at the document root: Peek's Vite build uses absolute asset paths
# (`/assets/...`), which is why it gets its own subdomain rather than a path
# under the relay's host.
COPY dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
