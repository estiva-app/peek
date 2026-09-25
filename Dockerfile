# Estiva Peek — production image.
#
# The build does **not** happen here (nor, since PER-16, in Ship's). CI builds
# `dist/` with `npm run build`, its `VITE_*` values set in
# `.github/workflows/deploy.yml`, and this image is the delivery envelope for
# it. Building without `VITE_RELAY_URL` produces a bundle in mock mode.

FROM nginx:1.27-alpine AS runtime

# Served at the document root: Peek's Vite build uses absolute asset paths
# (`/assets/...`), which is why it gets its own subdomain rather than a path
# under the relay's host.
COPY dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
