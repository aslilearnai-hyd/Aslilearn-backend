#!/bin/bash

# Update MongoDB URI in an environment file without storing or printing it.
# Usage:
#   NEW_MONGO_URI='mongodb+srv://...' ENV_FILE=/path/to/.env bash fix-mongo-uri.sh

ENV_FILE="${ENV_FILE:-/root/asli-backend/.env}"

if [ -z "${NEW_MONGO_URI:-}" ]; then
    echo "Error: NEW_MONGO_URI must be supplied in the environment." >&2
    exit 1
fi

case "$NEW_MONGO_URI" in
    mongodb://*|mongodb+srv://*) ;;
    *)
        echo "Error: NEW_MONGO_URI must be a MongoDB connection URI." >&2
        exit 1
        ;;
esac

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    exit 1
fi

echo "Updating MongoDB URI in environment file..."

umask 077
TEMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "$TEMP_FILE"' EXIT

FOUND=0
while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        MONGO_URI=*)
            printf 'MONGO_URI=%s\n' "$NEW_MONGO_URI" >> "$TEMP_FILE"
            FOUND=1
            ;;
        *) printf '%s\n' "$line" >> "$TEMP_FILE" ;;
    esac
done < "$ENV_FILE"

if [ "$FOUND" -eq 0 ]; then
    printf '\nMONGO_URI=%s\n' "$NEW_MONGO_URI" >> "$TEMP_FILE"
fi

mv "$TEMP_FILE" "$ENV_FILE"
trap - EXIT
unset NEW_MONGO_URI

echo "MongoDB URI updated without printing the credential."
echo "Restart the application through the approved deployment process."
