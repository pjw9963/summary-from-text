FROM node:14

WORKDIR /app

COPY package.json /app

RUN npm install

COPY . /app

# RUN curl 169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI

CMD node index.js

EXPOSE 3000