FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our template
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80 443
