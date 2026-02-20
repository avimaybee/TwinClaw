FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Expose gateway port
EXPOSE 18789

# Start the application
CMD ["npm", "start"]
