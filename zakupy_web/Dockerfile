ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}

RUN apk add --no-cache \
	bash \
	python3 \
	py3-pip \
	py3-virtualenv \
	gcc \
	musl-dev \
	linux-headers

WORKDIR /opt/zakupy-addon
ENV VIRTUAL_ENV=/opt/zakupy-addon/.venv
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY requirements-server.txt /opt/zakupy-addon/requirements-server.txt
RUN python3 -m venv "${VIRTUAL_ENV}" \
	&& pip install --upgrade pip setuptools wheel \
	&& pip install --no-cache-dir -r /opt/zakupy-addon/requirements-server.txt

COPY run.sh /opt/zakupy-addon/run.sh
RUN chmod a+x /opt/zakupy-addon/run.sh

CMD [ "/opt/zakupy-addon/run.sh" ]
