ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

RUN apk add --no-cache bash python3 py3-pip

ENV VIRTUAL_ENV=/opt/venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

WORKDIR /opt/regal-addon

COPY app/ /opt/regal-addon/app/
COPY run.sh /opt/regal-addon/run.sh

RUN chmod a+x /opt/regal-addon/run.sh \
    && python3 -m venv "${VIRTUAL_ENV}" \
    && "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir --upgrade pip \
    && "${VIRTUAL_ENV}/bin/pip" install --no-cache-dir -r /opt/regal-addon/app/requirements.txt

CMD [ "/opt/regal-addon/run.sh" ]