FROM ubuntu:20.04

ENV DEBIAN_FRONTEND=noninteractive
ENV SDK_ROOT=/opt/pocketbook-sdk
ENV SDK_PATH=/opt/pocketbook-sdk/SDK-A13

RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y \
        git \
        cmake \
        make \
        gcc \
        g++ \
        libc6:i386 \
        libstdc++6:i386 \
        zlib1g:i386 \
        libtinfo5 \
        libtinfo5:i386 \
        libgmp10 \
        wget \
        ca-certificates \
        file && \
    rm -rf /var/lib/apt/lists/*

# The PocketBook GCC 6.3 compiler was built against the older
# MPFR ABI and specifically requires libmpfr.so.4.
RUN wget -O /tmp/libmpfr4.deb \
        http://archive.ubuntu.com/ubuntu/pool/main/m/mpfr4/libmpfr4_3.1.4-1_amd64.deb && \
    dpkg -i /tmp/libmpfr4.deb && \
    rm /tmp/libmpfr4.deb && \
    ldconfig

RUN git clone \
    --branch 5.19 \
    --depth 1 \
    https://github.com/pocketbook/SDK_6.3.0.git \
    ${SDK_ROOT}

WORKDIR /project

CMD ["bash"]
