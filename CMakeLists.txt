cmake_minimum_required(VERSION 3.10)

project(PB641Frame LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 11)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(POCKETBOOK_SYSROOT
    "/opt/pocketbook-sdk/SDK-A13/usr/arm-obreey-linux-gnueabi/sysroot"
)

add_executable(PB641Frame.app
    src/main.cpp
)

target_include_directories(PB641Frame.app
    PRIVATE
        "${POCKETBOOK_SYSROOT}/usr/local/include"
        "${POCKETBOOK_SYSROOT}/usr/include"
        "${POCKETBOOK_SYSROOT}/usr/include/freetype2"
)

target_link_directories(PB641Frame.app
    PRIVATE
        "${POCKETBOOK_SYSROOT}/usr/local/lib"
        "${POCKETBOOK_SYSROOT}/usr/lib"
)

target_link_libraries(PB641Frame.app
    PRIVATE
        inkview
        freetype
)
