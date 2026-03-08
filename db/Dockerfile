# db/Dockerfile
# Extends the official Apache AGE image with PostGIS spatial support
FROM apache/age:latest

# Install PostGIS for PostgreSQL 18 (match the PG version bundled in apache/age)
RUN apt-get update && apt-get install -y \
    postgresql-18-postgis-3 \
    postgresql-18-postgis-3-scripts \
  && rm -rf /var/lib/apt/lists/*

# Grant the app user superuser so it can LOAD 'age' and create extensions
# This runs as the postgres init process before the DB starts
COPY grant-superuser.sql /docker-entrypoint-initdb.d/01-grant-superuser.sql
