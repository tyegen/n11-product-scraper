# Specify the parent image from which we build
FROM apify/actor-node-playwright:20

# Copy just package.json and package-lock.json
# to speed up the build using Docker layer caching.
COPY package*.json ./

# Install all dependencies
RUN npm ci --include=dev \
    && echo "npm install completed"

# Copy the rest of the source code
COPY . ./

# Build the project
RUN npm run build

# Run the image.
CMD ["npm", "start"]
