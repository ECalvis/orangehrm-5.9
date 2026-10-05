FROM php:8.3-apache-bookworm@sha256:06df07e2e1d72581dde4fd97bc98d2d0b78686fc13d6a041c520da9a6ce73055

ENV OHRM_VERSION=5.9
ENV OHRM_SHA256=F6E640F8B59E8D09F15EDCD24AC3D42BB52DCC4839A7D83F964DD798BC793F79
ENV TZ=Asia/Manila

COPY orangehrm-5.9.zip /tmp/orangehrm.zip

RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
    && echo "date.timezone = ${TZ}" > /usr/local/etc/php/conf.d/timezone.ini

RUN printf '%s\n' \
    'Types: deb' \
    'URIs: http://snapshot.debian.org/archive/debian/20260918T000000Z' \
    'Suites: bookworm' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    '' \
    'Types: deb' \
    'URIs: http://snapshot.debian.org/archive/debian-security/20260918T000000Z' \
    'Suites: bookworm-security' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg' \
    > /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' \
    'Acquire::Check-Valid-Until "false";' \
    > /etc/apt/apt.conf.d/99snapshot

RUN set -ex; \
    savedAptMark="$(apt-mark showmanual)"; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        libfreetype6-dev \
        libjpeg-dev \
        libpng-dev \
        libzip-dev \
        libldap2-dev \
        libicu-dev \
        unzip \
	; \
	\
	cd .. && rm -r html; \
    echo "${OHRM_SHA256}  /tmp/orangehrm.zip" | sha256sum -c -; \
	unzip -q /tmp/orangehrm.zip "orangehrm-${OHRM_VERSION}/*"; \
	mv "orangehrm-${OHRM_VERSION}" html; \
	rm -f /tmp/orangehrm.zip; \
	chown www-data:www-data html; \
	chown -R www-data:www-data html/lib/confs html/src/cache html/src/log html/src/config; \
	chmod -R 775 html/lib/confs html/src/cache html/src/log html/src/config; \
	\
	docker-php-ext-configure gd --with-freetype --with-jpeg; \
	docker-php-ext-configure ldap \
	    --with-libdir=lib/$(uname -m)-linux-gnu/ \
	; \
	\
	docker-php-ext-install -j "$(nproc)" \
		gd \
		opcache \
		intl \
		pdo_mysql \
		zip \
		ldap \
	; \
	\
	apt-mark auto '.*' > /dev/null; \
	apt-mark manual $savedAptMark; \
	ldd "$(php -r 'echo ini_get("extension_dir");')"/*.so \
		| awk '/=>/ { so = $(NF-1); if (index(so, "/usr/local/") == 1) { next }; gsub("^/(usr/)?", "", so); print so }' \
		| sort -u \
		| xargs -r dpkg-query -S \
		| cut -d: -f1 \
		| sort -u \
		| xargs -rt apt-mark manual; \
	\
	apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false; \
	rm -rf /var/cache/apt/archives; \
	rm -rf /var/lib/apt/lists/*

RUN { \
		echo 'opcache.memory_consumption=128'; \
		echo 'opcache.interned_strings_buffer=8'; \
		echo 'opcache.max_accelerated_files=4000'; \
		echo 'opcache.revalidate_freq=60'; \
		echo 'opcache.fast_shutdown=1'; \
		echo 'opcache.enable_cli=1'; \
	} > /usr/local/etc/php/conf.d/opcache-recommended.ini; \
	\
	if command -v a2enmod; then \
		a2enmod rewrite; \
	fi;

VOLUME ["/var/www/html"] 
