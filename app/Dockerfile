FROM public.ecr.aws/docker/library/node:22-alpine

RUN adduser -D -s /bin/sh app && mkdir -p /usr/src/app
# symlink for prisma/openssl issue on alpine: https://github.com/nodejs/docker-node/issues/2175#issuecomment-2530130523
RUN ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

ARG GIT_HASH=${GIT_HASH:-undefined_hash}

RUN npm run prisma:generate-client
RUN npm run api:build

USER app

EXPOSE 5000
ENTRYPOINT [ "npm" ]
CMD ["run", "api:start-deployed"]
