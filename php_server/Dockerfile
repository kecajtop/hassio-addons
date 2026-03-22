ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

RUN apk add --no-cache bash php84 php84-session php84-mysqli php84-pdo php84-pdo_mysql php84-json

WORKDIR /opt/php-server-addon

COPY run.sh /opt/php-server-addon/run.sh
RUN chmod a+x /opt/php-server-addon/run.sh

CMD [ "/opt/php-server-addon/run.sh" ]