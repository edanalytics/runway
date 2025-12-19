FROM public.ecr.aws/docker/library/node:22-alpine

WORKDIR /usr/src/app

COPY . .

# RUN apk add --no-cache --virtual .build-deps python3 make g++ \
#   && npm ci \
#   && apk del .build-deps
RUN npm ci


RUN wget https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

ARG GIT_HASH=${GIT_HASH:-undefined_hash}

# symlink for prisma/openssl issue on alpine: https://github.com/nodejs/docker-node/issues/2175#issuecomment-2530130523
RUN ln -s /usr/lib/libssl.so.3 /lib/libssl.so.3 
RUN npm run prisma:generate-client
RUN npm run api:build

RUN adduser -H -D -s /bin/sh app && \
    chown -R app:app /usr/src/app
USER app

EXPOSE 5000
ENTRYPOINT [ "npm" ]
CMD ["run", "api:start-deployed"]
